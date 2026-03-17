const prisma = require('../../lib/prisma');
const AuditLogger = require('../../utils/auditLogger');

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

module.exports = {
    createReport,
    getReports,
    autoPopulate,
    getReportById,
    updateReport,
    submitReport,
    reviewReport
};
