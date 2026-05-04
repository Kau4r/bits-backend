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

// Canonical "no brand" string. Stored in the DB and rendered verbatim by the
// frontend, so every row has a non-blank brand without per-call-site fallbacks.
const NO_BRAND = 'None';

const normalizeBrand = (value) => {
  if (value === undefined || value === null) return NO_BRAND;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized || BRAND_SENTINELS.has(normalized)) return NO_BRAND;
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

// True when the stored brand represents "no brand" (null, empty, or the
// canonical NO_BRAND marker). Use this in place of `!brand` checks so the
// canonical "None" string is treated as absent for label-building.
const isNoBrand = (value) => {
  if (value === undefined || value === null) return true;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed.toUpperCase() === NO_BRAND.toUpperCase();
};

// Returns the brand for display, or '' when the brand is "no brand". Handy for
// label templates like `${displayBrand(item.Brand)} ${item.Item_Code}`.trim().
const displayBrand = (value) => (isNoBrand(value) ? '' : String(value).trim());

module.exports = {
  BRAND_SENTINELS,
  SERIAL_SENTINELS,
  NO_BRAND,
  normalizeItemType,
  normalizeBrand,
  normalizeSerial,
  buildSyntheticSerial,
  isSyntheticSerial,
  isNoBrand,
  displayBrand,
  SYNTHETIC_SERIAL_REGEX,
};
