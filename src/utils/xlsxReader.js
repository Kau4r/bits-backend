const path = require('path');
const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const XML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

const decodeXml = (value = '') =>
  value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    return XML_ENTITIES[entity] ?? match;
  });

const parseAttributes = (raw = '') => {
  const attributes = {};
  const pattern = /([A-Za-z_][\w:.-]*)="([^"]*)"/g;
  let match;

  while ((match = pattern.exec(raw))) {
    attributes[match[1]] = decodeXml(match[2]);
  }

  return attributes;
};

const extractText = (xml = '') => {
  const textParts = [];
  const pattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match;

  while ((match = pattern.exec(xml))) {
    textParts.push(decodeXml(match[1]));
  }

  return textParts.join('');
};

const columnIndex = (cellRef = '') => {
  const letters = cellRef.replace(/[^A-Za-z]/g, '').toUpperCase();
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }

  return index - 1;
};

const findEndOfCentralDirectory = (buffer) => {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error('Invalid XLSX file: ZIP directory not found');
};

const readZipEntries = (buffer) => {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid XLSX file: ZIP central directory is corrupt');
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer
      .toString('utf8', offset + 46, offset + 46 + fileNameLength)
      .replace(/\\/g, '/');

    entries.set(fileName, { fileName, method, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  const readFile = (fileName) => {
    const entry = entries.get(fileName);
    if (!entry) return null;

    const localOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`Invalid XLSX file: local header missing for ${fileName}`);
    }

    const fileNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + fileNameLength + extraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return compressedData.toString('utf8');
    if (entry.method === 8) return zlib.inflateRawSync(compressedData).toString('utf8');

    throw new Error(`Unsupported XLSX compression method ${entry.method} in ${fileName}`);
  };

  return { entries, readFile };
};

const normalizeWorkbookPath = (target) => {
  const normalizedTarget = target.replace(/^\/+/, '');
  return normalizedTarget.startsWith('xl/')
    ? normalizedTarget
    : path.posix.normalize(path.posix.join('xl', normalizedTarget));
};

const readSharedStrings = (readFile) => {
  const xml = readFile('xl/sharedStrings.xml');
  if (!xml) return [];

  const values = [];
  const pattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;

  while ((match = pattern.exec(xml))) {
    values.push(extractText(match[1]).replace(/_x000D_/g, '').trim());
  }

  return values;
};

const readWorkbookSheets = (readFile) => {
  const workbookXml = readFile('xl/workbook.xml');
  const relsXml = readFile('xl/_rels/workbook.xml.rels');

  if (!workbookXml || !relsXml) {
    throw new Error('Invalid XLSX file: workbook metadata is missing');
  }

  const rels = new Map();
  const relPattern = /<Relationship\b([^>]*)\/?>/g;
  let relMatch;

  while ((relMatch = relPattern.exec(relsXml))) {
    const attrs = parseAttributes(relMatch[1]);
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, attrs.Target);
  }

  const sheets = [];
  const sheetPattern = /<sheet\b([^>]*)\/?>/g;
  let sheetMatch;

  while ((sheetMatch = sheetPattern.exec(workbookXml))) {
    const attrs = parseAttributes(sheetMatch[1]);
    const relId = attrs['r:id'];
    const target = rels.get(relId);

    if (attrs.name && target) {
      sheets.push({ name: attrs.name, path: normalizeWorkbookPath(target) });
    }
  }

  return sheets;
};

const readSheetRows = (xml, sharedStrings) => {
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(xml))) {
    const rowXml = rowMatch[1];
    const values = [];
    let maxIndex = -1;
    const cellPattern = /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g;
    let cellMatch;

    while ((cellMatch = cellPattern.exec(rowXml))) {
      const attrs = parseAttributes(cellMatch[1]);
      const index = columnIndex(attrs.r || '');
      if (index < 0) continue;

      const cellXml = cellMatch[2] || '';
      const valueMatch = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      let value = '';

      if (attrs.t === 's' && valueMatch?.[1] !== undefined) {
        value = sharedStrings[parseInt(valueMatch[1], 10)] ?? '';
      } else if (attrs.t === 'inlineStr') {
        value = extractText(cellXml);
      } else if (valueMatch?.[1] !== undefined) {
        value = decodeXml(valueMatch[1]);
      }

      values[index] = String(value).replace(/_x000D_/g, '').trim();
      maxIndex = Math.max(maxIndex, index);
    }

    if (maxIndex >= 0) {
      const denseRow = Array.from({ length: maxIndex + 1 }, (_, index) => values[index] ?? '');
      if (denseRow.some(value => value.trim())) rows.push(denseRow);
    }
  }

  return rows;
};

const readXlsxWorkbook = (buffer) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('XLSX parser expected a file buffer');
  }

  const zip = readZipEntries(buffer);
  const sharedStrings = readSharedStrings(zip.readFile);
  const sheets = readWorkbookSheets(zip.readFile).map(sheet => {
    const xml = zip.readFile(sheet.path);
    return {
      name: sheet.name,
      rows: xml ? readSheetRows(xml, sharedStrings) : []
    };
  });

  return { sheets };
};

module.exports = {
  readXlsxWorkbook
};
