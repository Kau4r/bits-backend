const normalizeCsvHeader = (value = '') =>
  String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const parseCsvText = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);

  return rows;
};

const parseCsvBuffer = (buffer) => {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows = parseCsvText(text);
  if (rows.length < 2) {
    return { headers: rows[0] || [], rows: [] };
  }

  const headers = rows[0].map(header => header.trim());
  const dataRows = rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    values,
  }));

  return { headers, rows: dataRows };
};

const getRowValue = (headers, row, aliases) => {
  const normalizedAliases = aliases.map(normalizeCsvHeader);
  const index = headers.findIndex(header => normalizedAliases.includes(normalizeCsvHeader(header)));
  if (index === -1) return '';
  return row.values[index]?.trim() || '';
};

const normalizeImportedStatus = (value, validStatuses, defaultStatus = 'AVAILABLE') => {
  if (!value) return defaultStatus;

  const normalized = String(value).trim().replace(/[\s-]+/g, '_').toUpperCase();
  const statusAliases = {
    OK: 'AVAILABLE',
    GOOD: 'AVAILABLE',
    WORKING: 'AVAILABLE',
    AVAILABLE: 'AVAILABLE',
    IN_USE: 'IN_USE',
    USED: 'IN_USE',
    BORROWED: 'BORROWED',
    DEFECTIVE: 'DEFECTIVE',
    DAMAGED: 'DEFECTIVE',
    BAD: 'DEFECTIVE',
    BROKEN: 'DEFECTIVE',
    MAINTENANCE: 'MAINTENANCE',
    DECOMMISSIONED: 'DECOMMISSIONED',
    LOST: 'LOST',
    REPLACED: 'REPLACED',
  };

  const resolved = statusAliases[normalized] || normalized;
  return validStatuses.includes(resolved) ? resolved : null;
};

const parseImportedBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return defaultValue;
};

module.exports = {
  getRowValue,
  normalizeCsvHeader,
  normalizeImportedStatus,
  parseCsvBuffer,
  parseImportedBoolean,
};
