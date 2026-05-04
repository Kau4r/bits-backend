const prisma = require('../../lib/prisma');

const sanitizeName = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const sanitizeItemTypes = (value) => {
    if (!Array.isArray(value)) return null;
    const cleaned = [];
    const seen = new Set();
    for (const raw of value) {
        if (typeof raw !== 'string') continue;
        const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
        if (!normalized || normalized.length > 50) continue;
        if (!/^[A-Z0-9_]+$/.test(normalized)) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        cleaned.push(normalized);
    }
    return cleaned;
};

const formatSuggestion = (row) => ({
    Suggestion_ID: row.Suggestion_ID,
    Name: row.Name,
    Item_Types: Array.isArray(row.Item_Types) ? row.Item_Types : [],
    Created_At: row.Created_At,
    Updated_At: row.Updated_At,
});

const getSuggestions = async (_req, res) => {
    const rows = await prisma.computer_Suggestion.findMany({
        orderBy: { Name: 'asc' },
    });
    res.json({ success: true, data: rows.map(formatSuggestion) });
};

const createSuggestion = async (req, res) => {
    const name = sanitizeName(req.body?.name);
    const itemTypes = sanitizeItemTypes(req.body?.itemTypes);

    if (!name) {
        return res.status(400).json({ success: false, error: 'Name is required' });
    }
    if (!itemTypes || itemTypes.length === 0) {
        return res.status(400).json({ success: false, error: 'At least one item type is required' });
    }

    const existing = await prisma.computer_Suggestion.findUnique({ where: { Name: name } });
    if (existing) {
        return res.status(409).json({ success: false, error: 'A suggestion with that name already exists' });
    }

    const created = await prisma.computer_Suggestion.create({
        data: { Name: name, Item_Types: itemTypes, Updated_At: new Date() },
    });
    res.status(201).json({ success: true, data: formatSuggestion(created) });
};

const updateSuggestion = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, error: 'Invalid suggestion ID' });
    }

    const existing = await prisma.computer_Suggestion.findUnique({ where: { Suggestion_ID: id } });
    if (!existing) {
        return res.status(404).json({ success: false, error: 'Suggestion not found' });
    }

    const data = { Updated_At: new Date() };

    if (req.body?.name !== undefined) {
        const name = sanitizeName(req.body.name);
        if (!name) {
            return res.status(400).json({ success: false, error: 'Name is required' });
        }
        if (name !== existing.Name) {
            const dup = await prisma.computer_Suggestion.findUnique({ where: { Name: name } });
            if (dup) {
                return res.status(409).json({ success: false, error: 'A suggestion with that name already exists' });
            }
        }
        data.Name = name;
    }

    if (req.body?.itemTypes !== undefined) {
        const itemTypes = sanitizeItemTypes(req.body.itemTypes);
        if (!itemTypes || itemTypes.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one item type is required' });
        }
        data.Item_Types = itemTypes;
    }

    const updated = await prisma.computer_Suggestion.update({
        where: { Suggestion_ID: id },
        data,
    });
    res.json({ success: true, data: formatSuggestion(updated) });
};

const deleteSuggestion = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, error: 'Invalid suggestion ID' });
    }

    try {
        await prisma.computer_Suggestion.delete({ where: { Suggestion_ID: id } });
    } catch (err) {
        if (err.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Suggestion not found' });
        }
        throw err;
    }
    res.json({ success: true, data: { message: 'Suggestion deleted' } });
};

module.exports = {
    getSuggestions,
    createSuggestion,
    updateSuggestion,
    deleteSuggestion,
};
