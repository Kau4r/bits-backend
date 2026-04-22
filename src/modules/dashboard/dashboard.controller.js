const prisma = require('../../lib/prisma');

const groupByCount = async (delegate, by, where = {}) => {
    try {
        if (!delegate?.groupBy) return {};
        const rows = await delegate.groupBy({
            by: [by],
            where,
            _count: { _all: true }
        });

        return rows.reduce((acc, row) => {
            const key = row[by] || 'UNSPECIFIED';
            acc[key] = row._count?._all || 0;
            return acc;
        }, {});
    } catch (error) {
        console.error(`[Dashboard] Failed to group by ${by}:`, error.message);
        return {};
    }
};

const countSafely = async (delegate, args = undefined, fallback = 0) => {
    try {
        if (!delegate?.count) return fallback;
        return args ? await delegate.count(args) : await delegate.count();
    } catch (error) {
        console.error('[Dashboard] Count failed:', error.message);
        return fallback;
    }
};

const findManySafely = async (delegate, args = {}, fallback = []) => {
    try {
        if (!delegate?.findMany) return fallback;
        return await delegate.findMany(args);
    } catch (error) {
        console.error('[Dashboard] Recent activity failed:', error.message);
        return fallback;
    }
};

const getDashboardMetrics = async (req, res) => {
    try {
        const { User_Role, User_ID } = req.user;

        // Response structure based on role
        let metrics = {
            role: User_Role,
            counts: {},
            distributions: {},
            summaries: {},
            recentActivity: [],
        };

        if (User_Role === 'LAB_HEAD' || User_Role === 'ADMIN') {
            // --- LAB HEAD METRICS ---

            // 1. Pending Tickets (Needs Approval/Assignment)
            const [pendingTickets, completedTickets, unassignedTickets] = await Promise.all([
                countSafely(prisma.ticket, { where: { Status: 'PENDING' } }),
                countSafely(prisma.ticket, { where: { Status: 'RESOLVED' } }),
                countSafely(prisma.ticket, { where: { Technician_ID: null, Status: { not: 'RESOLVED' } } })
            ]);

            // 2. Active Bookings Today
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            const [activeBookings, pendingBookings, rejectedBookings] = await Promise.all([
                countSafely(prisma.booked_Room, {
                    where: {
                        Status: 'APPROVED',
                        Start_Time: { gte: startOfDay },
                        End_Time: { lte: endOfDay }
                    }
                }),
                countSafely(prisma.booked_Room, { where: { Status: 'PENDING' } }),
                countSafely(prisma.booked_Room, { where: { Status: { in: ['REJECTED', 'CANCELLED'] } } })
            ]);

            // 3. Low Inventory (Example threshold < 5)
            // Note: Assuming 'Quantity' field exists or counting items by status
            const [totalItems, brokenItems, availableItems, borrowedItems, disposedItems, roomsInMaintenance] = await Promise.all([
                countSafely(prisma.item),
                countSafely(prisma.item, { where: { Status: 'DEFECTIVE' } }),
                countSafely(prisma.item, { where: { Status: 'AVAILABLE' } }),
                countSafely(prisma.item, { where: { Status: 'BORROWED' } }),
                countSafely(prisma.item, { where: { Status: 'DISPOSED' } }),
                countSafely(prisma.room, { where: { Status: 'MAINTENANCE' } })
            ]);

            // 4. Form Stats
            const [pendingForms, approvedForms, inReviewForms, submittedReports] = await Promise.all([
                countSafely(prisma.form, { where: { Status: 'PENDING' } }),
                countSafely(prisma.form, { where: { Status: 'APPROVED' } }),
                countSafely(prisma.form, { where: { Status: 'IN_REVIEW' } }),
                countSafely(prisma.weekly_Report, { where: { Status: 'SUBMITTED' } })
            ]);

            const [itemTypes, itemStatuses, bookingStatuses] = await Promise.all([
                groupByCount(prisma.item, 'Item_Type'),
                groupByCount(prisma.item, 'Status'),
                groupByCount(prisma.booked_Room, 'Status')
            ]);

            metrics.counts = {
                pendingTickets,
                completedTickets,
                unassignedTickets,
                activeBookings,
                pendingBookings,
                rejectedBookings,
                totalItems,
                brokenItems,
                availableItems,
                borrowedItems,
                disposedItems,
                roomsInMaintenance,
                pendingForms,
                approvedForms,
                inReviewForms,
                submittedReports
            };

            metrics.distributions = {
                itemTypes,
                itemStatuses,
                bookingStatuses
            };

            metrics.summaries = {
                bookings: {
                    activeToday: activeBookings,
                    pending: pendingBookings,
                    rejectedOrCancelled: rejectedBookings
                },
                tickets: {
                    pending: pendingTickets,
                    completed: completedTickets,
                    unassigned: unassignedTickets
                },
                inventory: {
                    total: totalItems,
                    available: availableItems,
                    borrowed: borrowedItems,
                    defective: brokenItems,
                    disposed: disposedItems
                },
                rooms: {
                    maintenance: roomsInMaintenance
                },
                reports: {
                    submitted: submittedReports
                }
            };

            // 5. Recent Activity (System-wide)
            metrics.recentActivity = await findManySafely(prisma.audit_Log, {
                take: 5,
                orderBy: { Timestamp: 'desc' },
                include: { User: { select: { First_Name: true, Last_Name: true } } }
            });

        } else if (User_Role === 'LAB_TECH') {
            // --- LAB TECH METRICS ---

            // 1. My Assigned Tickets
            const [myTickets, myCompletedTickets, pendingTickets, unassignedTickets] = await Promise.all([
                countSafely(prisma.ticket, {
                    where: {
                        Technician_ID: User_ID,
                        Status: { not: 'RESOLVED' }
                    }
                }),
                countSafely(prisma.ticket, {
                    where: {
                        Technician_ID: User_ID,
                        Status: 'RESOLVED'
                    }
                }),
                countSafely(prisma.ticket, { where: { Status: 'PENDING' } }),
                countSafely(prisma.ticket, { where: { Technician_ID: null, Status: { not: 'RESOLVED' } } })
            ]);

            // 2. Room and hardware queue
            const [maintenanceTasks, roomsInMaintenance] = await Promise.all([
                countSafely(prisma.ticket, {
                    where: {
                        Category: 'HARDWARE',
                        Status: 'IN_PROGRESS'
                    }
                }),
                countSafely(prisma.room, { where: { Status: 'MAINTENANCE' } })
            ]);

            // 3. Borrowed Items (Active)
            const [borrowedItems, totalItems, defectiveItems, availableItems, disposedItems] = await Promise.all([
                countSafely(prisma.borrow_Item, { where: { Status: 'BORROWED' } }),
                countSafely(prisma.item),
                countSafely(prisma.item, { where: { Status: 'DEFECTIVE' } }),
                countSafely(prisma.item, { where: { Status: 'AVAILABLE' } }),
                countSafely(prisma.item, { where: { Status: 'DISPOSED' } })
            ]);

            // 4. Pending Forms (Laboratory)
            const [pendingForms, inReviewForms, approvedForms, draftReports, submittedReports] = await Promise.all([
                countSafely(prisma.form, {
                    where: {
                        Status: 'PENDING',
                        Is_Archived: false
                    }
                }),
                countSafely(prisma.form, {
                    where: {
                        Status: 'IN_REVIEW',
                        Is_Archived: false
                    }
                }),
                countSafely(prisma.form, {
                    where: {
                        Status: 'APPROVED',
                        Is_Archived: false
                    }
                }),
                countSafely(prisma.weekly_Report, { where: { User_ID, Status: 'DRAFT' } }),
                countSafely(prisma.weekly_Report, { where: { User_ID, Status: 'SUBMITTED' } })
            ]);

            const [itemTypes, itemStatuses] = await Promise.all([
                groupByCount(prisma.item, 'Item_Type'),
                groupByCount(prisma.item, 'Status')
            ]);

            metrics.counts = {
                myAssignedTickets: myTickets,
                myCompletedTickets,
                pendingTickets,
                unassignedTickets,
                activeMaintenance: maintenanceTasks,
                roomsInMaintenance,
                activeBorrowings: borrowedItems,
                pendingForms,
                inReviewForms,
                approvedForms,
                totalItems,
                defectiveItems,
                availableItems,
                disposedItems,
                draftReports,
                submittedReports
            };

            metrics.distributions = {
                itemTypes,
                itemStatuses
            };

            metrics.summaries = {
                tickets: {
                    assignedToMe: myTickets,
                    completedByMe: myCompletedTickets,
                    pending: pendingTickets,
                    unassigned: unassignedTickets
                },
                rooms: {
                    maintenance: roomsInMaintenance,
                    hardwareTasks: maintenanceTasks
                },
                reports: {
                    drafts: draftReports,
                    submitted: submittedReports
                },
                forms: {
                    pending: pendingForms,
                    inReview: inReviewForms,
                    approved: approvedForms
                },
                inventory: {
                    total: totalItems,
                    available: availableItems,
                    defective: defectiveItems,
                    borrowed: borrowedItems,
                    disposed: disposedItems
                }
            };

            // 4. My Recent Activity
            metrics.recentActivity = await findManySafely(prisma.audit_Log, {
                where: { User_ID: User_ID },
                take: 5,
                orderBy: { Timestamp: 'desc' }
            });
        }

        res.json({ success: true, data: metrics });
    } catch (error) {
        console.error('Dashboard Metrics Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch dashboard metrics' });
    }
};

module.exports = {
    getDashboardMetrics
};
