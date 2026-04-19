const prisma = require('../../lib/prisma');
const CONFIRMATION_TEXT = 'RESET OPERATIONAL DATA';

const countSafely = async (delegate, where) => {
    if (!delegate?.count) return 0;
    return where ? delegate.count({ where }) : delegate.count();
};

const buildCleanupPreview = async () => {
    const [
        forms,
        formAttachments,
        formHistory,
        tickets,
        bookings,
        schedules,
        borrowItems,
        borrowingComputers,
        notifications,
        notificationReads,
        reports,
        heartbeatSessions,
        rooms,
        computers,
        borrowedItems,
        users,
        inventoryItems
    ] = await Promise.all([
        countSafely(prisma.Form),
        countSafely(prisma.FormAttachment),
        countSafely(prisma.FormHistory),
        countSafely(prisma.Ticket || prisma.ticket),
        countSafely(prisma.Booked_Room),
        countSafely(prisma.Schedule),
        countSafely(prisma.Borrow_Item || prisma.borrow_Item),
        countSafely(prisma.Borrowing_Comp || prisma.borrowing_Comp),
        countSafely(prisma.Audit_Log || prisma.audit_Log),
        countSafely(prisma.NotificationRead || prisma.notificationRead),
        countSafely(prisma.Weekly_Report || prisma.weekly_Report),
        countSafely(prisma.ComputerHeartbeat || prisma.computerHeartbeat),
        countSafely(prisma.Room || prisma.room),
        countSafely(prisma.Computer || prisma.computer),
        countSafely(prisma.item, { Status: 'BORROWED' }),
        countSafely(prisma.User || prisma.user),
        countSafely(prisma.item)
    ]);

    return {
        confirmationText: CONFIRMATION_TEXT,
        willDelete: {
            forms,
            formAttachments,
            formHistory,
            tickets,
            bookings,
            schedules,
            borrowItems,
            borrowingComputers,
            notifications,
            notificationReads,
            reports,
            heartbeatSessions
        },
        willReset: {
            rooms,
            computers,
            borrowedItems
        },
        willPreserve: {
            users,
            rooms,
            inventoryItems,
            computers
        }
    };
};

const getCleanupPreview = async (_req, res) => {
    try {
        const preview = await buildCleanupPreview();
        res.json({ success: true, data: preview });
    } catch (error) {
        console.error('Error building cleanup preview:', error);
        res.status(500).json({ success: false, error: 'Failed to build cleanup preview' });
    }
};

const runCleanup = async (req, res) => {
    try {
        const confirmation = String(req.body?.confirmation || '').trim();
        if (confirmation !== CONFIRMATION_TEXT) {
            return res.status(400).json({
                success: false,
                error: `Confirmation text must exactly match: ${CONFIRMATION_TEXT}`
            });
        }

        const before = await buildCleanupPreview();
        const userId = req.user?.User_ID || null;

        const result = await prisma.$transaction(async (tx) => {
            const delegates = {
                notificationRead: tx.NotificationRead || tx.notificationRead,
                auditLog: tx.Audit_Log || tx.audit_Log,
                form: tx.Form || tx.form,
                ticket: tx.Ticket || tx.ticket,
                borrowingComp: tx.Borrowing_Comp || tx.borrowing_Comp,
                borrowItem: tx.Borrow_Item || tx.borrow_Item,
                bookedRoom: tx.Booked_Room || tx.booked_Room,
                schedule: tx.Schedule || tx.schedule,
                computerHeartbeat: tx.ComputerHeartbeat || tx.computerHeartbeat,
                weeklyReport: tx.Weekly_Report || tx.weekly_Report,
                room: tx.Room || tx.room,
                computer: tx.Computer || tx.computer,
                item: tx.Item || tx.item
            };

            const deleted = {};
            deleted.notificationReads = (await delegates.notificationRead.deleteMany({})).count;
            deleted.notifications = (await delegates.auditLog.deleteMany({})).count;
            deleted.forms = (await delegates.form.deleteMany({})).count;
            deleted.tickets = (await delegates.ticket.deleteMany({})).count;
            deleted.borrowingComputers = (await delegates.borrowingComp.deleteMany({})).count;
            deleted.borrowItems = (await delegates.borrowItem.deleteMany({})).count;
            deleted.bookings = (await delegates.bookedRoom.deleteMany({})).count;
            deleted.schedules = (await delegates.schedule.deleteMany({})).count;
            deleted.heartbeatSessions = (await delegates.computerHeartbeat.deleteMany({})).count;
            deleted.reports = (await delegates.weeklyReport.deleteMany({})).count;

            const reset = {};
            reset.rooms = (await delegates.room.updateMany({
                data: {
                    Status: 'AVAILABLE',
                    Current_Use_Type: null,
                    Opened_By: null,
                    Opened_At: null,
                    Closed_At: null
                }
            })).count;

            reset.computers = (await delegates.computer.updateMany({
                data: {
                    Status: 'AVAILABLE',
                    Is_Online: false,
                    Current_User_ID: null,
                    Last_Seen: null
                }
            })).count;

            reset.borrowedItems = (await delegates.item.updateMany({
                where: { Status: 'BORROWED' },
                data: { Status: 'AVAILABLE' }
            })).count;

            await delegates.auditLog.create({
                data: {
                    User_ID: userId,
                    Action: 'DATABASE_CLEANUP',
                    Log_Type: 'SYSTEM',
                    Is_Notification: false,
                    Details: 'Operational data reset by admin'
                }
            });

            return { deleted, reset };
        });

        res.json({
            success: true,
            data: {
                message: 'Operational data cleanup completed',
                before,
                result
            }
        });
    } catch (error) {
        console.error('Error running cleanup:', error);
        res.status(500).json({ success: false, error: 'Failed to run cleanup' });
    }
};

module.exports = {
    CONFIRMATION_TEXT,
    getCleanupPreview,
    runCleanup
};
