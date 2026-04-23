const prisma = require('../../lib/prisma');

// GET /api/semesters - List all semesters
const getSemesters = async (_req, res) => {
    const semesters = await prisma.semester.findMany({
        orderBy: { Start_Date: 'desc' },
    });
    res.json({ success: true, data: semesters });
};

// GET /api/semesters/active - Get the current active semester (if any)
const getActiveSemester = async (_req, res) => {
    const semester = await prisma.semester.findFirst({
        where: { Is_Active: true },
        orderBy: { Start_Date: 'desc' },
    });
    if (!semester) {
        return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: semester });
};

// POST /api/semesters - Create a new semester
const createSemester = async (req, res) => {
    const { name, startDate, endDate, activate } = req.body || {};

    if (!name || !startDate || !endDate) {
        return res.status(400).json({
            success: false,
            error: 'name, startDate, and endDate are required',
        });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ success: false, error: 'Invalid date format' });
    }
    if (end.getTime() <= start.getTime()) {
        return res.status(400).json({ success: false, error: 'endDate must be after startDate' });
    }

    const semester = await prisma.$transaction(async (tx) => {
        if (activate) {
            await tx.semester.updateMany({ where: { Is_Active: true }, data: { Is_Active: false } });
        }
        return tx.semester.create({
            data: {
                Name: String(name).trim(),
                Start_Date: start,
                End_Date: end,
                Is_Active: !!activate,
            },
        });
    });

    res.status(201).json({ success: true, data: semester });
};

// PATCH /api/semesters/:id/activate - Activate this semester (deactivates others)
const activateSemester = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, error: 'Invalid semester id' });
    }

    const existing = await prisma.semester.findUnique({ where: { Semester_ID: id } });
    if (!existing) {
        return res.status(404).json({ success: false, error: 'Semester not found' });
    }

    const semester = await prisma.$transaction(async (tx) => {
        await tx.semester.updateMany({ where: { Is_Active: true }, data: { Is_Active: false } });
        return tx.semester.update({ where: { Semester_ID: id }, data: { Is_Active: true } });
    });

    res.json({ success: true, data: semester });
};

module.exports = {
    getSemesters,
    getActiveSemester,
    createSemester,
    activateSemester,
};
