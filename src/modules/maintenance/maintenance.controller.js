const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const prisma = require('../../lib/prisma');

const CONFIRMATION_TEXT = 'RESET OPERATIONAL DATA';
const ARCHIVE_CONFIRMATION_TEXT = 'ARCHIVE AND RESET SCHOOL YEAR';
const gzip = promisify(zlib.gzip);
const archiveDir = path.join(__dirname, '../../../archives');

const getDelegate = (client, ...names) => {
    for (const name of names) {
        if (client[name]) return client[name];
    }
    return null;
};

const countSafely = async (delegate, where) => {
    if (!delegate?.count) return 0;
    return where ? delegate.count({ where }) : delegate.count();
};

const findManySafely = async (delegate, args) => {
    if (!delegate?.findMany) return [];
    return delegate.findMany(args);
};

const deleteManySafely = async (delegate, args) => {
    if (!delegate?.deleteMany) return 0;
    return (await delegate.deleteMany(args)).count;
};

const updateManySafely = async (delegate, args) => {
    if (!delegate?.updateMany) return 0;
    return (await delegate.updateMany(args)).count;
};

const parseSchoolYear = (schoolYear) => {
    const value = String(schoolYear || '').trim();
    const match = value.match(/^(\d{4})\s*[-/]\s*(\d{4})$/);

    if (!match) {
        const error = new Error('School year must use the format YYYY-YYYY');
        error.statusCode = 400;
        throw error;
    }

    const startYear = Number(match[1]);
    const endYear = Number(match[2]);
    if (endYear !== startYear + 1) {
        const error = new Error('School year end must be the next calendar year');
        error.statusCode = 400;
        throw error;
    }

    return {
        label: `${startYear}-${endYear}`,
        start: new Date(Date.UTC(startYear, 6, 1, 0, 0, 0, 0)),
        end: new Date(Date.UTC(endYear, 5, 30, 23, 59, 59, 999))
    };
};

const rangeWhere = (field, range) => ({
    [field]: {
        gte: range.start,
        lte: range.end
    }
});

const scheduleRangeWhere = (range) => ({
    OR: [
        rangeWhere('Created_At', range),
        rangeWhere('Start_Time', range)
    ]
});

const formAttachmentRangeWhere = (range) => ({
    OR: [
        rangeWhere('Uploaded_At', range),
        { Form: rangeWhere('Created_At', range) }
    ]
});

const formHistoryRangeWhere = (range) => ({
    OR: [
        rangeWhere('Changed_At', range),
        { Form: rangeWhere('Created_At', range) }
    ]
});

const notificationReadRangeWhere = (range) => ({
    Audit_Log: rangeWhere('Timestamp', range)
});

const delegatesFor = (client) => ({
    notificationRead: getDelegate(client, 'NotificationRead', 'notificationRead'),
    auditLog: getDelegate(client, 'Audit_Log', 'audit_Log'),
    formAttachment: getDelegate(client, 'FormAttachment', 'formAttachment'),
    formHistory: getDelegate(client, 'FormHistory', 'formHistory'),
    form: getDelegate(client, 'Form', 'form'),
    ticket: getDelegate(client, 'Ticket', 'ticket'),
    borrowingComp: getDelegate(client, 'Borrowing_Comp', 'borrowing_Comp'),
    borrowItem: getDelegate(client, 'Borrow_Item', 'borrow_Item'),
    bookedRoom: getDelegate(client, 'Booked_Room', 'booked_Room'),
    schedule: getDelegate(client, 'Schedule', 'schedule'),
    computerHeartbeat: getDelegate(client, 'ComputerHeartbeat', 'computerHeartbeat'),
    weeklyReport: getDelegate(client, 'Weekly_Report', 'weekly_Report'),
    room: getDelegate(client, 'Room', 'room'),
    computer: getDelegate(client, 'Computer', 'computer'),
    item: getDelegate(client, 'Item', 'item'),
    user: getDelegate(client, 'User', 'user')
});

const buildCleanupPreview = async () => {
    const delegates = delegatesFor(prisma);
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
        countSafely(delegates.form),
        countSafely(delegates.formAttachment),
        countSafely(delegates.formHistory),
        countSafely(delegates.ticket),
        countSafely(delegates.bookedRoom),
        countSafely(delegates.schedule),
        countSafely(delegates.borrowItem),
        countSafely(delegates.borrowingComp),
        countSafely(delegates.auditLog),
        countSafely(delegates.notificationRead),
        countSafely(delegates.weeklyReport),
        countSafely(delegates.computerHeartbeat),
        countSafely(delegates.room),
        countSafely(delegates.computer),
        countSafely(delegates.item, { Status: 'BORROWED' }),
        countSafely(delegates.user),
        countSafely(delegates.item)
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

const buildSchoolYearArchivePreview = async (schoolYear) => {
    const range = parseSchoolYear(schoolYear);
    const delegates = delegatesFor(prisma);
    const [
        users,
        rooms,
        computers,
        inventoryItems,
        forms,
        formAttachments,
        formHistory,
        tickets,
        bookings,
        borrowItems,
        borrowingComputers,
        reports,
        heartbeatSessions,
        auditLogs,
        notifications,
        notificationReads,
        schedules
    ] = await Promise.all([
        countSafely(delegates.user),
        countSafely(delegates.room),
        countSafely(delegates.computer),
        countSafely(delegates.item),
        countSafely(delegates.form, rangeWhere('Created_At', range)),
        countSafely(delegates.formAttachment, formAttachmentRangeWhere(range)),
        countSafely(delegates.formHistory, formHistoryRangeWhere(range)),
        countSafely(delegates.ticket, rangeWhere('Created_At', range)),
        countSafely(delegates.bookedRoom, rangeWhere('Start_Time', range)),
        countSafely(delegates.borrowItem, rangeWhere('Created_At', range)),
        countSafely(delegates.borrowingComp, rangeWhere('Created_At', range)),
        countSafely(delegates.weeklyReport, rangeWhere('Week_Start', range)),
        countSafely(delegates.computerHeartbeat, rangeWhere('Timestamp', range)),
        countSafely(delegates.auditLog, {
            Is_Notification: false,
            ...rangeWhere('Timestamp', range)
        }),
        countSafely(delegates.auditLog, {
            Is_Notification: true,
            ...rangeWhere('Timestamp', range)
        }),
        countSafely(delegates.notificationRead, notificationReadRangeWhere(range)),
        countSafely(delegates.schedule, scheduleRangeWhere(range))
    ]);

    return {
        confirmationText: ARCHIVE_CONFIRMATION_TEXT,
        schoolYear: range.label,
        archiveName: `BITS-Archive-SY-${range.label}.json.gz`,
        dateRange: {
            start: range.start.toISOString(),
            end: range.end.toISOString()
        },
        willArchive: {
            users,
            rooms,
            computers,
            inventoryItems,
            forms,
            formAttachments,
            formHistory,
            tickets,
            bookings,
            borrowItems,
            borrowingComputers,
            reports,
            heartbeatSessions,
            auditLogs,
            notifications,
            notificationReads,
            schedules
        },
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
            computers
        },
        willPreserve: {
            users,
            rooms,
            inventoryItems,
            computers
        },
        excludedFromArchive: {}
    };
};

const collectArchivePayload = async (schoolYear, createdBy) => {
    const range = parseSchoolYear(schoolYear);
    const delegates = delegatesFor(prisma);
    const [
        users,
        rooms,
        computers,
        inventoryItems,
        forms,
        formAttachments,
        formHistory,
        tickets,
        bookings,
        schedules,
        borrowItems,
        borrowingComputers,
        reports,
        heartbeatSessions,
        auditLogs,
        notifications,
        notificationReads
    ] = await Promise.all([
        findManySafely(delegates.user, {
            select: {
                User_ID: true,
                Username: true,
                First_Name: true,
                Middle_Name: true,
                Last_Name: true,
                Email: true,
                Created_At: true,
                Updated_At: true,
                Is_Active: true,
                User_Role: true
            }
        }),
        findManySafely(delegates.room, {}),
        findManySafely(delegates.computer, {}),
        findManySafely(delegates.item, {}),
        findManySafely(delegates.form, { where: rangeWhere('Created_At', range) }),
        findManySafely(delegates.formAttachment, { where: formAttachmentRangeWhere(range) }),
        findManySafely(delegates.formHistory, { where: formHistoryRangeWhere(range) }),
        findManySafely(delegates.ticket, { where: rangeWhere('Created_At', range) }),
        findManySafely(delegates.bookedRoom, { where: rangeWhere('Start_Time', range) }),
        findManySafely(delegates.schedule, { where: scheduleRangeWhere(range) }),
        findManySafely(delegates.borrowItem, { where: rangeWhere('Created_At', range) }),
        findManySafely(delegates.borrowingComp, { where: rangeWhere('Created_At', range) }),
        findManySafely(delegates.weeklyReport, { where: rangeWhere('Week_Start', range) }),
        findManySafely(delegates.computerHeartbeat, { where: rangeWhere('Timestamp', range) }),
        findManySafely(delegates.auditLog, {
            where: {
                Is_Notification: false,
                ...rangeWhere('Timestamp', range)
            }
        }),
        findManySafely(delegates.auditLog, {
            where: {
                Is_Notification: true,
                ...rangeWhere('Timestamp', range)
            }
        }),
        findManySafely(delegates.notificationRead, { where: notificationReadRangeWhere(range) })
    ]);

    return {
        manifest: {
            application: 'BITS',
            archiveType: 'school-year-operational-data',
            schoolYear: range.label,
            createdAt: new Date().toISOString(),
            createdBy,
            dateRange: {
                start: range.start.toISOString(),
                end: range.end.toISOString()
            },
            excludedFromArchive: [],
            format: 'json-gzip'
        },
        data: {
            users,
            rooms,
            computers,
            inventoryItems,
            forms,
            formAttachments,
            formHistory,
            tickets,
            bookings,
            schedules,
            borrowItems,
            borrowingComputers,
            reports,
            heartbeatSessions,
            auditLogs,
            notifications,
            notificationReads
        }
    };
};

const writeArchiveFile = async (payload, archiveName) => {
    await fs.mkdir(archiveDir, { recursive: true });
    const compressed = await gzip(Buffer.from(JSON.stringify(payload, null, 2), 'utf8'));
    const filePath = path.join(archiveDir, archiveName);
    await fs.writeFile(filePath, compressed);
    return filePath;
};

const resetOperationalData = async (tx, userId, details) => {
    const delegates = delegatesFor(tx);
    const deleted = {};
    deleted.notificationReads = await deleteManySafely(delegates.notificationRead, {});
    deleted.notifications = await deleteManySafely(delegates.auditLog, {});
    deleted.formAttachments = await deleteManySafely(delegates.formAttachment, {});
    deleted.formHistory = await deleteManySafely(delegates.formHistory, {});
    deleted.forms = await deleteManySafely(delegates.form, {});
    deleted.tickets = await deleteManySafely(delegates.ticket, {});
    deleted.borrowingComputers = await deleteManySafely(delegates.borrowingComp, {});
    deleted.borrowItems = await deleteManySafely(delegates.borrowItem, {});
    deleted.bookings = await deleteManySafely(delegates.bookedRoom, {});
    deleted.schedules = await deleteManySafely(delegates.schedule, {});
    deleted.heartbeatSessions = await deleteManySafely(delegates.computerHeartbeat, {});
    deleted.reports = await deleteManySafely(delegates.weeklyReport, {});

    const reset = {};
    reset.rooms = await updateManySafely(delegates.room, {
        data: {
            Status: 'AVAILABLE',
            Current_Use_Type: null,
            Opened_By: null,
            Opened_At: null,
            Closed_At: null
        }
    });

    reset.computers = await updateManySafely(delegates.computer, {
        data: {
            Status: 'AVAILABLE',
            Is_Online: false,
            Current_User_ID: null,
            Last_Seen: null
        }
    });

    reset.borrowedItems = await updateManySafely(delegates.item, {
        where: { Status: 'BORROWED' },
        data: { Status: 'AVAILABLE' }
    });

    if (delegates.auditLog) {
        await delegates.auditLog.create({
            data: {
                User_ID: userId,
                Action: details.action,
                Log_Type: 'SYSTEM',
                Is_Notification: false,
                Details: details.message
            }
        });
    }

    return { deleted, reset };
};

const resetSchoolYearOperationalData = async (tx, userId, schoolYear, details) => {
    const range = parseSchoolYear(schoolYear);
    const delegates = delegatesFor(tx);
    const deleted = {};

    deleted.notificationReads = await deleteManySafely(delegates.notificationRead, { where: notificationReadRangeWhere(range) });
    deleted.notifications = await deleteManySafely(delegates.auditLog, { where: rangeWhere('Timestamp', range) });
    deleted.formAttachments = await deleteManySafely(delegates.formAttachment, { where: formAttachmentRangeWhere(range) });
    deleted.formHistory = await deleteManySafely(delegates.formHistory, { where: formHistoryRangeWhere(range) });
    deleted.forms = await deleteManySafely(delegates.form, { where: rangeWhere('Created_At', range) });
    deleted.tickets = await deleteManySafely(delegates.ticket, { where: rangeWhere('Created_At', range) });
    deleted.borrowingComputers = await deleteManySafely(delegates.borrowingComp, { where: rangeWhere('Created_At', range) });
    deleted.borrowItems = await deleteManySafely(delegates.borrowItem, { where: rangeWhere('Created_At', range) });
    deleted.bookings = await deleteManySafely(delegates.bookedRoom, { where: rangeWhere('Start_Time', range) });
    deleted.schedules = await deleteManySafely(delegates.schedule, { where: scheduleRangeWhere(range) });
    deleted.heartbeatSessions = await deleteManySafely(delegates.computerHeartbeat, { where: rangeWhere('Timestamp', range) });
    deleted.reports = await deleteManySafely(delegates.weeklyReport, { where: rangeWhere('Week_Start', range) });

    const reset = {};
    reset.rooms = await updateManySafely(delegates.room, {
        data: {
            Status: 'AVAILABLE',
            Current_Use_Type: null,
            Opened_By: null,
            Opened_At: null,
            Closed_At: null
        }
    });

    reset.computers = await updateManySafely(delegates.computer, {
        data: {
            Status: 'AVAILABLE',
            Is_Online: false,
            Current_User_ID: null,
            Last_Seen: null
        }
    });

    reset.borrowedItems = await updateManySafely(delegates.item, {
        where: { Status: 'BORROWED' },
        data: { Status: 'AVAILABLE' }
    });

    if (delegates.auditLog) {
        await delegates.auditLog.create({
            data: {
                User_ID: userId,
                Action: details.action,
                Log_Type: 'SYSTEM',
                Is_Notification: false,
                Details: details.message
            }
        });
    }

    return { deleted, reset };
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

const getSchoolYearArchivePreview = async (req, res) => {
    try {
        const preview = await buildSchoolYearArchivePreview(req.query.schoolYear);
        res.json({ success: true, data: preview });
    } catch (error) {
        console.error('Error building school-year archive preview:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || 'Failed to build school-year archive preview'
        });
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
        const result = await prisma.$transaction((tx) => resetOperationalData(tx, userId, {
            action: 'DATABASE_CLEANUP',
            message: 'Operational data reset by admin'
        }));

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

const runSchoolYearArchiveCleanup = async (req, res) => {
    try {
        const confirmation = String(req.body?.confirmation || '').trim();
        const schoolYear = req.body?.schoolYear;

        if (confirmation !== ARCHIVE_CONFIRMATION_TEXT) {
            return res.status(400).json({
                success: false,
                error: `Confirmation text must exactly match: ${ARCHIVE_CONFIRMATION_TEXT}`
            });
        }

        const preview = await buildSchoolYearArchivePreview(schoolYear);
        const payload = await collectArchivePayload(schoolYear, req.user?.User_ID || null);
        await writeArchiveFile(payload, preview.archiveName);

        const before = await buildCleanupPreview();
        const userId = req.user?.User_ID || null;
        const result = await prisma.$transaction((tx) => resetSchoolYearOperationalData(tx, userId, schoolYear, {
            action: 'SCHOOL_YEAR_ARCHIVE_CLEANUP',
            message: `Archived ${preview.schoolYear} to ${preview.archiveName} and reset selected school-year operational data`
        }));

        res.json({
            success: true,
            data: {
                message: `School year ${preview.schoolYear} archived and cleanup completed`,
                archiveName: preview.archiveName,
                downloadUrl: `/maintenance/archives/${encodeURIComponent(preview.archiveName)}`,
                preview,
                before,
                result
            }
        });
    } catch (error) {
        console.error('Error running school-year archive cleanup:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || 'Failed to run school-year archive cleanup'
        });
    }
};

const downloadArchive = async (req, res) => {
    try {
        const fileName = path.basename(req.params.fileName || '');
        if (!/^BITS-Archive-SY-\d{4}-\d{4}\.json\.gz$/.test(fileName)) {
            return res.status(400).json({ success: false, error: 'Invalid archive file name' });
        }

        const filePath = path.join(archiveDir, fileName);
        await fs.access(filePath);
        res.download(filePath, fileName);
    } catch (error) {
        console.error('Error downloading archive:', error);
        res.status(404).json({ success: false, error: 'Archive not found' });
    }
};

module.exports = {
    CONFIRMATION_TEXT,
    ARCHIVE_CONFIRMATION_TEXT,
    getCleanupPreview,
    getSchoolYearArchivePreview,
    runCleanup,
    runSchoolYearArchiveCleanup,
    downloadArchive
};
