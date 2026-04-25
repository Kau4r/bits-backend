// Shared normalization helpers for inventory rows. Used by:
//   - inventory.controller.js (createItem, updateItem, import flow)
//   - scripts/backfill-inventory-data.js (one-time DB cleanup)
//
// Sentinels are values that crept into the Brand or Serial cells via dirty
// Excel data — typically because the data-entry person used the column to
// scribble a note ("NO S/N", "OLD") instead of an actual brand/serial.

const BRAND_SENTINELS = new Set([
  '', '-', '--', '---', 'N/A', 'NA', 'NO S/N', 'NO SN', 'NO/SN',
  'NONE', 'NO BRAND', 'OLD', 'UNKNOWN', 'GENERAL', 'TBD',
]);

const SERIAL_SENTINELS = new Set([
  '-', '--', '---', 'N/A', 'NA', 'NO S/N', 'NO SN', 'NO/SN',
  'NONE', 'OLD', 'UNKNOWN', 'TBD', 'NOT ASSIGNED',
]);

const normalizeItemType = (value = 'OTHER') => {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(/[\s-]+/g, '_').toUpperCase();
  if (['GENERAL', '_', '__'].includes(normalized)) {
    return 'OTHER';
  }
  if (normalized === 'SYSTEM_UNIT') {
    return 'MINI_PC';
  }
  if (!normalized || normalized.length > 50 || !/^[A-Z0-9_]+$/.test(normalized)) {
    return null;
  }

  return normalized;
};

const normalizeBrand = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized || BRAND_SENTINELS.has(normalized)) return null;
  return normalized;
};

const normalizeSerial = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || SERIAL_SENTINELS.has(normalized.toUpperCase())) return null;
  return normalized;
};

/**
 * Build the "INT-{TYPE}-NNNN" synthetic serial for items that arrive without
 * a real serial. Sequence is 4-digit zero-padded.
 */
const buildSyntheticSerial = (itemType, sequence) =>
  `INT-${itemType}-${String(sequence).padStart(4, '0')}`;

const SYNTHETIC_SERIAL_REGEX = /^INT-([A-Z0-9_]+)-(\d+)$/i;

const isSyntheticSerial = (value) => {
  if (!value) return false;
  return SYNTHETIC_SERIAL_REGEX.test(String(value).trim());
};

module.exports = {
  BRAND_SENTINELS,
  SERIAL_SENTINELS,
  normalizeItemType,
  normalizeBrand,
  normalizeSerial,
  buildSyntheticSerial,
  isSyntheticSerial,
  SYNTHETIC_SERIAL_REGEX,
};
