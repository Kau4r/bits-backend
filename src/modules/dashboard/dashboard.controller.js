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

            // 4. Form Stats — split Completed (Department=COMPLETED) from Approved (in-flight)
            const [pendingForms, approvedForms, inReviewForms, completedForms, cancelledForms, submittedReports] = await Promise.all([
                countSafely(prisma.form, { where: { Status: 'PENDING', Department: { not: 'COMPLETED' } } }),
                countSafely(prisma.form, { where: { Status: 'APPROVED', Department: { not: 'COMPLETED' } } }),
                countSafely(prisma.form, { where: { Status: 'IN_REVIEW', Department: { not: 'COMPLETED' } } }),
                countSafely(prisma.form, { where: { Department: 'COMPLETED' } }),
                countSafely(prisma.form, { where: { Status: 'CANCELLED' } }),
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
                completedForms,
                cancelledForms,
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
                forms: {
                    pending: pendingForms,
                    inReview: inReviewForms,
                    approved: approvedForms,
                    completed: completedForms,
                    cancelled: cancelledForms
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

            // 4. Pending Forms (Laboratory) — Completed (Department=COMPLETED) is split out from Approved.
            const [pendingForms, inReviewForms, approvedForms, completedForms, cancelledForms, draftReports, submittedReports] = await Promise.all([
                countSafely(prisma.form, {
                    where: {
                        Status: 'PENDING',
                        Department: { not: 'COMPLETED' },
                        Is_Archived: false
                    }
                }),
                countSafely(prisma.form, {
                    where: {
                        Status: 'IN_REVIEW',
                        Department: { not: 'COMPLETED' },
                        Is_Archived: false
                    }
                }),
                countSafely(prisma.form, {
                    where: {
                        Status: 'APPROVED',
                        Department: { not: 'COMPLETED' },
                        Is_Archived: false
                    }
                }),
                countSafely(prisma.form, {
                    where: {
                        Department: 'COMPLETED',
                        Is_Archived: false
                    }
                }),
                countSafely(prisma.form, {
                    where: {
                        Status: 'CANCELLED',
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
                completedForms,
                cancelledForms,
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
                    approved: approvedForms,
                    completed: completedForms,
                    cancelled: cancelledForms
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
};

// Actions that count as "requests handled" by a lab tech. We attribute work to
// whoever performed the action (Audit_Log.User_ID), not the request owner.
const HANDLED_ACTIONS = {
    borrowings: ['BORROW_APPROVED', 'BORROW_REJECTED'],
    bookings: ['BOOKING_APPROVED', 'BOOKING_REJECTED'],
    tickets: ['TICKET_ASSIGNED', 'TICKET_RESOLVED']
};

// GET /api/dashboard/leaderboard
// Volume leaderboard for lab techs (and lab heads, who also handle requests).
// Optional query params: ?from=ISO&to=ISO to scope by time.
const getLabTechLeaderboard = async (req, res) => {
    const { from, to } = req.query;
    const timeFilter = {};
    if (from) timeFilter.gte = new Date(from);
    if (to) timeFilter.lte = new Date(to);

    const allActions = [...HANDLED_ACTIONS.borrowings, ...HANDLED_ACTIONS.bookings, ...HANDLED_ACTIONS.tickets];

    const techs = await prisma.user.findMany({
        where: { User_Role: { in: ['LAB_TECH', 'LAB_HEAD'] }, Is_Active: true },
        select: { User_ID: true, First_Name: true, Last_Name: true, User_Role: true }
    });
    const techIds = techs.map(t => t.User_ID);

    if (techIds.length === 0) {
        return res.json({ success: true, data: { entries: [] } });
    }

    const logs = await prisma.audit_Log.groupBy({
        by: ['User_ID', 'Action'],
        where: {
            User_ID: { in: techIds },
            Action: { in: allActions },
            ...(Object.keys(timeFilter).length > 0 && { Timestamp: timeFilter })
        },
        _count: { _all: true }
    });

    const tally = new Map();
    for (const t of techs) {
        tally.set(t.User_ID, {
            User_ID: t.User_ID,
            Name: `${t.First_Name} ${t.Last_Name}`.trim(),
            User_Role: t.User_Role,
            borrowings: 0,
            bookings: 0,
            tickets: 0,
            total: 0
        });
    }

    for (const row of logs) {
        const entry = tally.get(row.User_ID);
        if (!entry) continue;
        const count = row._count?._all ?? 0;
        if (HANDLED_ACTIONS.borrowings.includes(row.Action)) entry.borrowings += count;
        else if (HANDLED_ACTIONS.bookings.includes(row.Action)) entry.bookings += count;
        else if (HANDLED_ACTIONS.tickets.includes(row.Action)) entry.tickets += count;
        entry.total += count;
    }

    const entries = Array.from(tally.values()).sort((a, b) => b.total - a.total);

    res.json({ success: true, data: { entries, range: { from: from || null, to: to || null } } });
};

module.exports = {
    getDashboardMetrics,
    getLabTechLeaderboard
};
