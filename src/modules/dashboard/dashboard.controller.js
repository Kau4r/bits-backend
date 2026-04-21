const prisma = require('../../lib/prisma');

const groupByCount = async (delegate, by, where = {}) => {
    try {
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
                prisma.ticket.count({ where: { Status: 'PENDING' } }),
                prisma.ticket.count({ where: { Status: 'RESOLVED' } }),
                prisma.ticket.count({ where: { Technician_ID: null, Status: { not: 'RESOLVED' } } })
            ]);

            // 2. Active Bookings Today
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            const [activeBookings, pendingBookings, rejectedBookings] = await Promise.all([
                prisma.booked_Room.count({
                    where: {
                        Status: 'APPROVED',
                        Start_Time: { gte: startOfDay },
                        End_Time: { lte: endOfDay }
                    }
                }),
                prisma.booked_Room.count({ where: { Status: 'PENDING' } }),
                prisma.booked_Room.count({ where: { Status: { in: ['REJECTED', 'CANCELLED'] } } })
            ]);

            // 3. Low Inventory (Example threshold < 5)
            // Note: Assuming 'Quantity' field exists or counting items by status
            const [totalItems, brokenItems, availableItems, borrowedItems, roomsInMaintenance] = await Promise.all([
                prisma.item.count(),
                prisma.item.count({ where: { Status: 'DEFECTIVE' } }),
                prisma.item.count({ where: { Status: 'AVAILABLE' } }),
                prisma.item.count({ where: { Status: 'BORROWED' } }),
                prisma.room.count({ where: { Status: 'MAINTENANCE' } })
            ]);

            // 4. Form Stats
            const [pendingForms, approvedForms, inReviewForms, submittedReports] = await Promise.all([
                prisma.form.count({ where: { Status: 'PENDING' } }),
                prisma.form.count({ where: { Status: 'APPROVED' } }),
                prisma.form.count({ where: { Status: 'IN_REVIEW' } }),
                prisma.weekly_Report.count({ where: { Status: 'SUBMITTED' } })
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
                    defective: brokenItems
                },
                rooms: {
                    maintenance: roomsInMaintenance
                },
                reports: {
                    submitted: submittedReports
                }
            };

            // 5. Recent Activity (System-wide)
            metrics.recentActivity = await prisma.audit_Log.findMany({
                take: 5,
                orderBy: { Timestamp: 'desc' },
                include: { User: { select: { First_Name: true, Last_Name: true } } }
            });

        } else if (User_Role === 'LAB_TECH') {
            // --- LAB TECH METRICS ---

            // 1. My Assigned Tickets
            const [myTickets, myCompletedTickets, pendingTickets, unassignedTickets] = await Promise.all([
                prisma.ticket.count({
                    where: {
                        Technician_ID: User_ID,
                        Status: { not: 'RESOLVED' }
                    }
                }),
                prisma.ticket.count({
                    where: {
                        Technician_ID: User_ID,
                        Status: 'RESOLVED'
                    }
                }),
                prisma.ticket.count({ where: { Status: 'PENDING' } }),
                prisma.ticket.count({ where: { Technician_ID: null, Status: { not: 'RESOLVED' } } })
            ]);

            // 2. Scheduled Maintenance Today (Placeholder logic based on Ticket Category)
            const [maintenanceTasks, roomsInMaintenance] = await Promise.all([
                prisma.ticket.count({
                    where: {
                        Category: 'HARDWARE',
                        Status: 'IN_PROGRESS'
                    }
                }),
                prisma.room.count({ where: { Status: 'MAINTENANCE' } })
            ]);

            // 3. Borrowed Items (Active)
            const [borrowedItems, totalItems, defectiveItems, availableItems] = await Promise.all([
                prisma.borrow_Item.count({ where: { Status: 'BORROWED' } }),
                prisma.item.count(),
                prisma.item.count({ where: { Status: 'DEFECTIVE' } }),
                prisma.item.count({ where: { Status: 'AVAILABLE' } })
            ]);

            // 4. Pending Forms (Laboratory)
            const [pendingForms, draftReports, submittedReports] = await Promise.all([
                prisma.form.count({
                    where: {
                        Status: 'PENDING',
                        Is_Archived: false
                    }
                }),
                prisma.weekly_Report.count({ where: { User_ID, Status: 'DRAFT' } }),
                prisma.weekly_Report.count({ where: { User_ID, Status: 'SUBMITTED' } })
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
                totalItems,
                defectiveItems,
                availableItems,
                draftReports,
                submittedReports
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
                inventory: {
                    total: totalItems,
                    available: availableItems,
                    defective: defectiveItems,
                    borrowed: borrowedItems
                }
            };

            // 4. My Recent Activity
            metrics.recentActivity = await prisma.audit_Log.findMany({
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
