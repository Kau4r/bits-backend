const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getDashboardMetrics = async (req, res) => {
    try {
        const { User_Role, User_ID } = req.user;

        // Response structure based on role
        let metrics = {
            role: User_Role,
            counts: {},
            recentActivity: [],
        };

        if (User_Role === 'LAB_HEAD' || User_Role === 'ADMIN') {
            // --- LAB HEAD METRICS ---

            // 1. Pending Tickets (Needs Approval/Assignment)
            const pendingTickets = await prisma.ticket.count({
                where: { Status: 'PENDING' }
            });

            // 2. Active Bookings Today
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            const activeBookings = await prisma.booked_Room.count({
                where: {
                    Status: 'APPROVED',
                    Start_Time: { gte: startOfDay },
                    End_Time: { lte: endOfDay }
                }
            });

            // 3. Low Inventory (Example threshold < 5)
            // Note: Assuming 'Quantity' field exists or counting items by status
            const totalItems = await prisma.item.count();
            const brokenItems = await prisma.item.count({
                where: { Status: 'DEFECTIVE' }
            });

            // 4. Form Stats
            const pendingForms = await prisma.form.count({
                where: { Status: 'PENDING' }
            });
            const approvedForms = await prisma.form.count({
                where: { Status: 'APPROVED' }
            });
            const inReviewForms = await prisma.form.count({
                where: { Status: 'IN_REVIEW' }
            });

            metrics.counts = {
                pendingTickets,
                activeBookings,
                brokenItems,
                pendingForms,
                approvedForms,
                inReviewForms
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
            const myTickets = await prisma.ticket.count({
                where: {
                    Technician_ID: User_ID,
                    Status: { not: 'RESOLVED' }
                }
            });

            // 2. Scheduled Maintenance Today (Placeholder logic based on Ticket Category)
            const maintenanceTasks = await prisma.ticket.count({
                where: {
                    Category: 'HARDWARE',
                    Status: 'IN_PROGRESS'
                }
            });

            // 3. Borrowed Items (Active)
            const borrowedItems = await prisma.borrow_Item.count({
                where: { Status: 'BORROWED' }
            });

            // 4. Pending Forms (Laboratory)
            const pendingForms = await prisma.form.count({
                where: {
                    Status: 'PENDING',
                    Department: 'LABORATORY'
                }
            });

            metrics.counts = {
                myAssignedTickets: myTickets,
                activeMaintenance: maintenanceTasks,
                activeBorrowings: borrowedItems,
                pendingForms
            };

            // 4. My Recent Activity
            metrics.recentActivity = await prisma.audit_Log.findMany({
                where: { User_ID: User_ID },
                take: 5,
                orderBy: { Timestamp: 'desc' }
            });
        }

        res.json(metrics);
    } catch (error) {
        console.error('Dashboard Metrics Error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
    }
};

module.exports = {
    getDashboardMetrics
};
