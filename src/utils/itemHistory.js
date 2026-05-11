const prisma = require('../lib/prisma');

// Standard action codes. Free-form strings, but keep these names stable so the
// UI can group/filter. Add new ones as needed.
const ItemHistoryAction = Object.freeze({
    CREATED: 'CREATED',
    UPDATED: 'UPDATED',
    STATUS_CHANGED: 'STATUS_CHANGED',
    MOVED_ROOM: 'MOVED_ROOM',
    BORROWED: 'BORROWED',
    RETURNED: 'RETURNED',
    MARKED_DEFECTIVE: 'MARKED_DEFECTIVE',
    REPLACED: 'REPLACED',
    DISPOSED: 'DISPOSED',
    AUDITED: 'AUDITED',
    UNAUDITED: 'UNAUDITED',
    ATTACHED_TO_PARENT: 'ATTACHED_TO_PARENT',
    DETACHED_FROM_PARENT: 'DETACHED_FROM_PARENT'
});

// Pick the subset of an item's columns that we want to capture in history snapshots.
// Keeps payloads small and avoids storing secrets/joined tables.
const snapshotItem = (item) => {
    if (!item) return null;
    return {
        Item_ID: item.Item_ID,
        Item_Code: item.Item_Code,
        Item_Type: item.Item_Type,
        Brand: item.Brand,
        Serial_Number: item.Serial_Number,
        Status: item.Status,
        Room_ID: item.Room_ID,
        IsBorrowable: item.IsBorrowable,
        ReplacedById: item.ReplacedById
    };
};

// Compute the {old, new} diff of two snapshots — only fields that changed.
// Returns null if nothing meaningful changed (caller may choose to skip the write).
const diffSnapshots = (before, after) => {
    if (!before && !after) return null;
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const oldDiff = {};
    const newDiff = {};
    let changed = false;
    for (const k of keys) {
        const a = before?.[k];
        const b = after?.[k];
        if (a !== b) {
            oldDiff[k] = a ?? null;
            newDiff[k] = b ?? null;
            changed = true;
        }
    }
    return changed ? { oldDiff, newDiff } : null;
};

// Best-effort write. Logs and swallows errors so the parent mutation is never
// blocked by an audit-trail failure.
const recordItemHistory = async ({
    itemId,
    action,
    oldValue = null,
    newValue = null,
    userId = null,
    reason = null,
    notes = null,
    parentItemId = null,
    parentComputerId = null
}) => {
    if (!itemId || !action) {
        console.warn('[itemHistory] skipped — itemId and action are required');
        return null;
    }
    try {
        return await prisma.item_History.create({
            data: {
                Item_ID: itemId,
                Action: action,
                Old_Value: oldValue ?? undefined,
                New_Value: newValue ?? undefined,
                Performed_By_ID: userId ?? null,
                Reason: reason,
                Notes: notes,
                Parent_Item_ID: parentItemId ?? null,
                Parent_Computer_ID: parentComputerId ?? null
            }
        });
    } catch (error) {
        console.error('[itemHistory] write failed:', error.message);
        return null;
    }
};

module.exports = {
    ItemHistoryAction,
    snapshotItem,
    diffSnapshots,
    recordItemHistory
};
