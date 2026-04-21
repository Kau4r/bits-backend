const prisma = require('../../lib/prisma');
const AuditLogger = require('../../utils/auditLogger');

const csvEscape = (value) => {
    if (value === null || value === undefined) return '';

    let stringValue = value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);

    // Prevent spreadsheet formula execution when CSVs are opened in Excel.
    if (/^[=+\-@]/.test(stringValue.trim())) {
        stringValue = `'${stringValue}`;
    }

    if (/[",\r\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
};

const sendCsv = (res, filename, columns, rows) => {
    const header = columns.map(column => csvEscape(column.header)).join(',');
    const body = rows.map(row =>
        columns.map(column => csvEscape(
            typeof column.value === 'function' ? column.value(row) : row[column.value]
        )).join(',')
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send([header, ...body].join('\r\n'));
};

const formatDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const formatName = (user) => {
    if (!user) return '';
    const name = [user.First_Name, user.Last_Name].filter(Boolean).join(' ').trim();
    return name || user.Email || '';
};

const parsePositiveInt = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
};

const buildDateRangeWhere = (field, { from, to }) => {
    const range = {};
    if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) range.gte = fromDate;
    }
    if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) {
            toDate.setHours(23, 59, 59, 999);
            range.lte = toDate;
        }
    }
    return Object.keys(range).length ? { [field]: range } : {};
};

const groupByCount = async (delegate, by, where = {}) => {
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
};

const countTasks = (tasks, section) => {
    if (!tasks || typeof tasks !== 'object') return 0;
    return Array.isArray(tasks[section]) ? tasks[section].length : 0;
};

const buildDashboardReportSummary = async (user) => {
    const [
        pendingTickets,
        inProgressTickets,
        resolvedTickets,
        unassignedTickets,
        archivedTickets,
        pendingForms,
        inReviewForms,
        approvedForms,
        cancelledForms,
        archivedForms,
        completedForms,
        inventoryTotal,
        availableItems,
        borrowedItems,
        defectiveItems,
        lostItems,
        replacedItems,
        disposedItems,
        roomsTotal,
        roomsAvailable,
        roomsInUse,
        roomsMaintenance,
        roomsReserved,
        roomsClosed,
        draftReports,
        submittedReports,
        reviewedReports,
        pendingBookings,
        approvedBookings,
        rejectedBookings,
        cancelledBookings,
        itemTypes,
        itemStatuses,
        bookingStatuses
    ] = await Promise.all([
        prisma.ticket.count({ where: { Status: 'PENDING', Archived: false } }),
        prisma.ticket.count({ where: { Status: 'IN_PROGRESS', Archived: false } }),
        prisma.ticket.count({ where: { Status: 'RESOLVED', Archived: false } }),
        prisma.ticket.count({ where: { Technician_ID: null, Status: { not: 'RESOLVED' }, Archived: false } }),
        prisma.ticket.count({ where: { Archived: true } }),
        prisma.form.count({ where: { Status: 'PENDING', Is_Archived: false } }),
        prisma.form.count({ where: { Status: 'IN_REVIEW', Is_Archived: false } }),
        prisma.form.count({ where: { Status: 'APPROVED', Is_Archived: false } }),
        prisma.form.count({ where: { Status: 'CANCELLED', Is_Archived: false } }),
        prisma.form.count({ where: { OR: [{ Is_Archived: true }, { Status: 'ARCHIVED' }] } }),
        prisma.form.count({ where: { Department: 'COMPLETED' } }),
        prisma.item.count(),
        prisma.item.count({ where: { Status: 'AVAILABLE' } }),
        prisma.item.count({ where: { Status: 'BORROWED' } }),
        prisma.item.count({ where: { Status: 'DEFECTIVE' } }),
        prisma.item.count({ where: { Status: 'LOST' } }),
        prisma.item.count({ where: { Status: 'REPLACED' } }),
        prisma.item.count({ where: { Status: 'DISPOSED' } }),
        prisma.room.count(),
        prisma.room.count({ where: { Status: 'AVAILABLE' } }),
        prisma.room.count({ where: { Status: 'IN_USE' } }),
        prisma.room.count({ where: { Status: 'MAINTENANCE' } }),
        prisma.room.count({ where: { Status: 'RESERVED' } }),
        prisma.room.count({ where: { Status: 'CLOSED' } }),
        prisma.weekly_Report.count({ where: { Status: 'DRAFT' } }),
        prisma.weekly_Report.count({ where: { Status: 'SUBMITTED' } }),
        prisma.weekly_Report.count({ where: { Status: 'REVIEWED' } }),
        prisma.booked_Room.count({ where: { Status: 'PENDING' } }),
        prisma.booked_Room.count({ where: { Status: 'APPROVED' } }),
        prisma.booked_Room.count({ where: { Status: 'REJECTED' } }),
        prisma.booked_Room.count({ where: { Status: 'CANCELLED' } }),
        groupByCount(prisma.item, 'Item_Type'),
        groupByCount(prisma.item, 'Status'),
        groupByCount(prisma.booked_Room, 'Status')
    ]);

    return {
        generatedAt: new Date().toISOString(),
        generatedBy: formatName(user),
        role: user.User_Role,
        tickets: {
            pending: pendingTickets,
            inProgress: inProgressTickets,
            resolved: resolvedTickets,
            unassigned: unassignedTickets,
            archived: archivedTickets
        },
        forms: {
            pending: pendingForms,
            inReview: inReviewForms,
            approved: approvedForms,
            cancelled: cancelledForms,
            archived: archivedForms,
            completedDepartment: completedForms
        },
        inventory: {
            total: inventoryTotal,
            available: availableItems,
            borrowed: borrowedItems,
            defective: defectiveItems,
            lost: lostItems,
            replaced: replacedItems,
            disposed: disposedItems
        },
        rooms: {
            total: roomsTotal,
            available: roomsAvailable,
            inUse: roomsInUse,
            maintenance: roomsMaintenance,
            reserved: roomsReserved,
            closed: roomsClosed
        },
        reports: {
            draft: draftReports,
            submitted: submittedReports,
            reviewed: reviewedReports
        },
        bookings: {
            pending: pendingBookings,
            approved: approvedBookings,
            rejected: rejectedBookings,
            cancelled: cancelledBookings
        },
        distributions: {
            itemTypes,
            itemStatuses,
            bookingStatuses
        }
    };
};

// POST /api/reports - Create a new report
const createReport = async (req, res) => {
    const { weekStart, weekEnd, tasks, notes, status } = req.body;
    const userId = req.user.User_ID;

    // Validate week range
    if (!weekStart || !weekEnd) {
        return res.status(400).json({ success: false, error: 'weekStart and weekEnd are required' });
    }

    const start = new Date(weekStart);
    const end = new Date(weekEnd);

    if (start >= end) {
        return res.status(400).json({ success: false, error: 'weekStart must be before weekEnd' });
    }

    // Validate tasks shape
    if (tasks) {
        if (
            !Array.isArray(tasks.completed) ||
            !Array.isArray(tasks.pending) ||
            !Array.isArray(tasks.inProgress)
        ) {
            return res.status(400).json({
                error: 'tasks must have completed, pending, and inProgress arrays'
            });
        }
    }

    const reportStatus = status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';

    let report;
    try {
        report = await prisma.weekly_Report.create({
            data: {
                User_ID: userId,
                Week_Start: start,
                Week_End: end,
                Tasks: tasks || { completed: [], pending: [], inProgress: [] },
                Issues_Reported: tasks ? (tasks.completed.length + tasks.pending.length + tasks.inProgress.length) : 0,
                Notes: notes || null,
                Status: reportStatus
            },
            include: {
                User: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                }
            }
        });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(409).json({ success: false, error: 'You already have a report for this week' });
        }
        throw err;
    }

    if (reportStatus === 'SUBMITTED') {
        await AuditLogger.logReport(
            userId,
            'REPORT_SUBMITTED',
            `${req.user.First_Name} ${req.user.Last_Name} submitted a weekly report for ${start.toDateString()} - ${end.toDateString()}`,
            ['LAB_HEAD']
        );
    }

    res.status(201).json({ success: true, data: report });
};

// GET /api/reports - List reports (role-based)
const getReports = async (req, res) => {
    const { userId, status } = req.query;

    let whereClause = {};

    if (req.user.User_Role === 'LAB_TECH') {
        // Lab techs can only see their own reports
        whereClause.User_ID = req.user.User_ID;
    } else if (req.user.User_Role === 'LAB_HEAD') {
        // Lab heads can filter by userId or see all
        if (userId) {
            whereClause.User_ID = parseInt(userId);
        }
    }

    if (status) {
        whereClause.Status = status.toUpperCase();
    }

    const reports = await prisma.weekly_Report.findMany({
        where: whereClause,
        include: {
            User: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            },
            Reviewer: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true
                }
            }
        },
        orderBy: { Week_Start: 'desc' }
    });

    res.json({ success: true, data: reports });
};

// GET /api/reports/auto-populate - Auto-populate report from tickets
const autoPopulate = async (req, res) => {
    const { weekStart, weekEnd } = req.query;

    if (!weekStart || !weekEnd) {
        return res.status(400).json({ success: false, error: 'weekStart and weekEnd are required' });
    }

    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() + 1);

    const tickets = await prisma.ticket.findMany({
        where: {
            Technician_ID: req.user.User_ID,
            Archived: false,
            OR: [
                // Tickets updated within this week
                { Updated_At: { gte: start, lt: endInclusive } },
                // Tickets created within this week
                { Created_At: { gte: start, lt: endInclusive } },
                // Tickets still in progress (carry-forward regardless of date)
                { Status: 'IN_PROGRESS' }
            ]
        },
        include: {
            Room: { select: { Name: true } },
            Item: { select: { Item_Code: true, Brand: true } }
        }
    });

    const existingReports = await prisma.weekly_Report.findMany({
        where: {
            User_ID: req.user.User_ID,
            Status: { in: ['SUBMITTED', 'REVIEWED'] }
        },
        select: { Tasks: true }
    });

    const reportedTicketIds = new Set();
    for (const report of existingReports) {
        const tasks = report.Tasks;
        if (tasks && typeof tasks === 'object') {
            for (const section of ['completed', 'inProgress', 'pending']) {
                for (const task of (tasks[section] || [])) {
                    if (task.ticketId) reportedTicketIds.add(task.ticketId);
                }
            }
        }
    }

    const relevantTickets = tickets.filter(t => {
        const updatedInWeek = t.Updated_At >= start && t.Updated_At < endInclusive;
        const createdInWeek = t.Created_At >= start && t.Created_At < endInclusive;
        const unreported = !reportedTicketIds.has(t.Ticket_ID);
        return updatedInWeek || createdInWeek || unreported;
    });

    const completed = [];
    const inProgress = [];
    const pending = [];

    for (const ticket of relevantTickets) {
        const locationParts = [];
        if (ticket.Location) locationParts.push(ticket.Location);
        if (ticket.Room) locationParts.push(ticket.Room.Name);
        if (ticket.Item) locationParts.push(`${ticket.Item.Brand || ''} ${ticket.Item.Item_Code || ''}`.trim());

        const task = {
            title: ticket.Report_Problem,
            description: locationParts.join(' - '),
            category: ticket.Category ? ticket.Category.charAt(0) + ticket.Category.slice(1).toLowerCase() : 'Tickets',
            ticketId: ticket.Ticket_ID,
        };

        if (ticket.Status === 'RESOLVED') {
            completed.push(task);
        } else if (ticket.Status === 'IN_PROGRESS') {
            inProgress.push(task);
        } else {
            pending.push(task);
        }
    }

    res.json({
        success: true,
        data: { completed, inProgress, pending },
    });
};

// GET /api/reports/:id - Get a single report
const getReportById = async (req, res) => {
    const reportId = parseInt(req.params.id);
    if (isNaN(reportId)) {
        return res.status(400).json({ success: false, error: 'Invalid report ID' });
    }

    const report = await prisma.weekly_Report.findUnique({
        where: { Report_ID: reportId },
        include: {
            User: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            },
            Reviewer: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true
                }
            }
        }
    });

    if (!report) {
        return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (req.user.User_Role === 'LAB_TECH' && report.User_ID !== req.user.User_ID) {
        return res.status(403).json({ success: false, error: 'You do not have permission to view this report' });
    }

    res.json({ success: true, data: report });
};

// PUT /api/reports/:id - Update own draft report
const updateReport = async (req, res) => {
    const reportId = parseInt(req.params.id);
    if (isNaN(reportId)) {
        return res.status(400).json({ success: false, error: 'Invalid report ID' });
    }

    const { tasks, notes, weekStart, weekEnd } = req.body;

    const report = await prisma.weekly_Report.findUnique({
        where: { Report_ID: reportId }
    });

    if (!report) {
        return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (report.User_ID !== req.user.User_ID) {
        return res.status(403).json({ success: false, error: 'You do not have permission to edit this report' });
    }

    if (report.Status !== 'DRAFT') {
        return res.status(400).json({ success: false, error: 'Only draft reports can be edited' });
    }

    const updateData = {};

    if (tasks !== undefined) {
        updateData.Tasks = tasks;
        updateData.Issues_Reported = (tasks.completed?.length || 0) + (tasks.pending?.length || 0) + (tasks.inProgress?.length || 0);
    }
    if (notes !== undefined) updateData.Notes = notes;
    if (weekStart !== undefined) updateData.Week_Start = new Date(weekStart);
    if (weekEnd !== undefined) updateData.Week_End = new Date(weekEnd);

    const updatedReport = await prisma.weekly_Report.update({
        where: { Report_ID: reportId },
        data: updateData,
        include: {
            User: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            },
            Reviewer: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true
                }
            }
        }
    });

    res.json({ success: true, data: updatedReport });
};

// PATCH /api/reports/:id/submit - Submit a draft report
const submitReport = async (req, res) => {
    const reportId = parseInt(req.params.id);
    if (isNaN(reportId)) {
        return res.status(400).json({ success: false, error: 'Invalid report ID' });
    }

    const report = await prisma.weekly_Report.findUnique({
        where: { Report_ID: reportId }
    });

    if (!report) {
        return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (report.User_ID !== req.user.User_ID) {
        return res.status(403).json({ success: false, error: 'You do not have permission to submit this report' });
    }

    if (report.Status !== 'DRAFT') {
        return res.status(400).json({ success: false, error: 'Only draft reports can be submitted' });
    }

    const updatedReport = await prisma.weekly_Report.update({
        where: { Report_ID: reportId },
        data: { Status: 'SUBMITTED' },
        include: {
            User: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            },
            Reviewer: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true
                }
            }
        }
    });

    await AuditLogger.logReport(
        req.user.User_ID,
        'REPORT_SUBMITTED',
        `${req.user.First_Name} ${req.user.Last_Name} submitted weekly report #${report.Report_ID}`,
        ['LAB_HEAD']
    );

    res.json({ success: true, data: updatedReport });
};

// PATCH /api/reports/:id/review - Review a submitted report (Lab Head)
const reviewReport = async (req, res) => {
    const reportId = parseInt(req.params.id);
    if (isNaN(reportId)) {
        return res.status(400).json({ success: false, error: 'Invalid report ID' });
    }

    const report = await prisma.weekly_Report.findUnique({
        where: { Report_ID: reportId }
    });

    if (!report) {
        return res.status(404).json({ success: false, error: 'Report not found' });
    }

    if (report.Status !== 'SUBMITTED') {
        return res.status(400).json({ success: false, error: 'Only submitted reports can be reviewed' });
    }

    const updatedReport = await prisma.weekly_Report.update({
        where: { Report_ID: reportId },
        data: {
            Status: 'REVIEWED',
            Reviewed_By: req.user.User_ID,
            Reviewed_At: new Date()
        },
        include: {
            User: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            },
            Reviewer: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true
                }
            }
        }
    });

    await AuditLogger.logReport(
        req.user.User_ID,
        'REPORT_REVIEWED',
        `${req.user.First_Name} ${req.user.Last_Name} reviewed weekly report #${report.Report_ID}`,
        null,
        report.User_ID
    );

    res.json({ success: true, data: updatedReport });
};

// GET /api/reports/summary - Dashboard report summary for export/review pages
const getDashboardReportSummary = async (req, res) => {
    const summary = await buildDashboardReportSummary(req.user);
    res.json({ success: true, data: summary });
};

// GET /api/reports/summary.csv - Download dashboard summary CSV
const exportDashboardSummaryCsv = async (req, res) => {
    const summary = await buildDashboardReportSummary(req.user);
    const rows = [
        ...Object.entries(summary.tickets).map(([metric, value]) => ({ area: 'Tickets', metric, value })),
        ...Object.entries(summary.forms).map(([metric, value]) => ({ area: 'Forms', metric, value })),
        ...Object.entries(summary.inventory).map(([metric, value]) => ({ area: 'Inventory', metric, value })),
        ...Object.entries(summary.rooms).map(([metric, value]) => ({ area: 'Rooms', metric, value })),
        ...Object.entries(summary.reports).map(([metric, value]) => ({ area: 'Weekly Reports', metric, value })),
        ...Object.entries(summary.bookings).map(([metric, value]) => ({ area: 'Bookings', metric, value }))
    ];

    sendCsv(res, 'dashboard-summary-report.csv', [
        { header: 'Generated At', value: () => summary.generatedAt },
        { header: 'Generated By', value: () => summary.generatedBy },
        { header: 'Area', value: 'area' },
        { header: 'Metric', value: 'metric' },
        { header: 'Value', value: 'value' }
    ], rows);
};

// GET /api/reports/inventory.csv - Download inventory report CSV
const exportInventoryCsv = async (req, res) => {
    const { roomId, status, type } = req.query;
    const parsedRoomId = parsePositiveInt(roomId);

    const where = {};
    if (parsedRoomId) {
        where.OR = [
            { Room_ID: parsedRoomId },
            { Computer: { some: { Room_ID: parsedRoomId } } }
        ];
    }
    if (status) where.Status = String(status).toUpperCase();
    if (type) where.Item_Type = String(type).trim().replace(/[\s-]+/g, '_').toUpperCase();

    const items = await prisma.item.findMany({
        where,
        include: {
            Room: { select: { Name: true } },
            User: { select: { First_Name: true, Last_Name: true, Email: true } },
            Computer: {
                select: {
                    Name: true,
                    Room: { select: { Name: true } }
                }
            }
        },
        orderBy: [
            { Room_ID: 'asc' },
            { Item_Type: 'asc' },
            { Item_Code: 'asc' }
        ]
    });

    const roomLabel = parsedRoomId ? `room-${parsedRoomId}` : 'all-rooms';
    sendCsv(res, `inventory-${roomLabel}-report.csv`, [
        { header: 'Item Code', value: 'Item_Code' },
        { header: 'Type', value: 'Item_Type' },
        { header: 'Brand', value: 'Brand' },
        { header: 'Serial Number', value: 'Serial_Number' },
        { header: 'Status', value: 'Status' },
        { header: 'Location', value: item => item.Location || item.Room?.Name || item.Computer?.[0]?.Room?.Name || '' },
        { header: 'Room', value: item => item.Room?.Name || item.Computer?.[0]?.Room?.Name || '' },
        { header: 'PC', value: item => (item.Computer || []).map(computer => computer.Name).join('; ') },
        { header: 'Borrowable', value: item => item.IsBorrowable ? 'Yes' : 'No' },
        { header: 'Created By', value: item => formatName(item.User) },
        { header: 'Created At', value: item => formatDate(item.Created_At) },
        { header: 'Last Updated', value: item => formatDate(item.Updated_At) }
    ], items);
};

// GET /api/reports/rooms.csv - Download room report CSV
const exportRoomsCsv = async (req, res) => {
    const rooms = await prisma.room.findMany({
        include: {
            Computer: {
                include: {
                    Item: true
                }
            },
            Items: true,
            Tickets: true,
            Schedule: true,
            Booked_Rooms: true
        },
        orderBy: { Name: 'asc' }
    });

    const rows = rooms.map(room => {
        const assetById = new Map();
        room.Items.forEach(item => assetById.set(item.Item_ID, item));
        room.Computer.forEach(computer => {
            computer.Item.forEach(item => assetById.set(item.Item_ID, item));
        });
        return {
            ...room,
            Report_Items: Array.from(assetById.values())
        };
    });

    const activeStatuses = ['PENDING', 'IN_PROGRESS'];
    sendCsv(res, 'room-report.csv', [
        { header: 'Room', value: 'Name' },
        { header: 'Room Type', value: 'Room_Type' },
        { header: 'Lab Type', value: room => room.Lab_Type || '' },
        { header: 'Capacity', value: 'Capacity' },
        { header: 'Status', value: 'Status' },
        { header: 'Current Use', value: room => room.Current_Use_Type || '' },
        { header: 'Computers Total', value: room => room.Computer.length },
        { header: 'Computers Available', value: room => room.Computer.filter(computer => computer.Status === 'AVAILABLE').length },
        { header: 'Computers In Use', value: room => room.Computer.filter(computer => computer.Status === 'IN_USE').length },
        { header: 'Computers Maintenance', value: room => room.Computer.filter(computer => computer.Status === 'MAINTENANCE').length },
        { header: 'Items Total', value: room => room.Report_Items.length },
        { header: 'Items Available', value: room => room.Report_Items.filter(item => item.Status === 'AVAILABLE').length },
        { header: 'Items Disposed', value: room => room.Report_Items.filter(item => item.Status === 'DISPOSED').length },
        { header: 'Active Tickets', value: room => room.Tickets.filter(ticket => activeStatuses.includes(ticket.Status) && !ticket.Archived).length },
        { header: 'Active Schedules', value: room => room.Schedule.filter(schedule => schedule.IsActive).length },
        { header: 'Pending Bookings', value: room => room.Booked_Rooms.filter(booking => booking.Status === 'PENDING').length },
        { header: 'Updated At', value: room => formatDate(room.Updated_At) }
    ], rows);
};

// GET /api/reports/weekly.csv - Download weekly reports CSV
const exportWeeklyReportsCsv = async (req, res) => {
    const { userId, status, from, to } = req.query;
    const whereClause = {
        ...buildDateRangeWhere('Week_Start', { from, to })
    };

    if (req.user.User_Role === 'LAB_TECH') {
        whereClause.User_ID = req.user.User_ID;
    } else {
        const parsedUserId = parsePositiveInt(userId);
        if (parsedUserId) whereClause.User_ID = parsedUserId;
    }

    if (status) {
        whereClause.Status = String(status).toUpperCase();
    }

    const reports = await prisma.weekly_Report.findMany({
        where: whereClause,
        include: {
            User: {
                select: {
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            },
            Reviewer: {
                select: {
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            }
        },
        orderBy: { Week_Start: 'desc' }
    });

    sendCsv(res, 'weekly-reports.csv', [
        { header: 'Report ID', value: 'Report_ID' },
        { header: 'Lab Technician', value: report => formatName(report.User) },
        { header: 'Week Start', value: report => formatDate(report.Week_Start) },
        { header: 'Week End', value: report => formatDate(report.Week_End) },
        { header: 'Status', value: 'Status' },
        { header: 'Issues Reported', value: 'Issues_Reported' },
        { header: 'Completed Tasks', value: report => countTasks(report.Tasks, 'completed') },
        { header: 'In Progress Tasks', value: report => countTasks(report.Tasks, 'inProgress') },
        { header: 'Pending Tasks', value: report => countTasks(report.Tasks, 'pending') },
        { header: 'Reviewed By', value: report => formatName(report.Reviewer) },
        { header: 'Reviewed At', value: report => formatDate(report.Reviewed_At) },
        { header: 'Notes', value: 'Notes' },
        { header: 'Created At', value: report => formatDate(report.Created_At) },
        { header: 'Updated At', value: report => formatDate(report.Updated_At) }
    ], reports);
};

module.exports = {
    createReport,
    getReports,
    autoPopulate,
    getReportById,
    updateReport,
    submitReport,
    reviewReport,
    getDashboardReportSummary,
    exportDashboardSummaryCsv,
    exportInventoryCsv,
    exportRoomsCsv,
    exportWeeklyReportsCsv
};
