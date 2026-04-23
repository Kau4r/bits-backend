/**
 * One-shot inventory import from the AY 25-26 workbook.
 *
 * Strategy:
 *   - Scan each row for cells matching the asset-code pattern.
 *   - Derive Item_Type from the asset-code prefix (NUC/MPC/CPU/MAC/MON/KBS/... ).
 *   - If a row contains >=1 PC-component asset, group those into a Computer.
 *   - Any non-PC asset in the row (and rows with no PC parts) becomes a standalone Item.
 *
 * Routing:
 *   - Lab / office sheets map to one room (see SHEET_ROOM_MAP).
 *   - LECTURE ROOMS resolves per-row (first column = 483/484/485/486).
 *   - ctrl room x3 all merge into "Control Room" (union; dedupe by asset code).
 *   - Green Room x2 both merge into "Green Room".
 *   - Empty duplicates LB467TC (2) / LB468TC (2) are skipped.
 *
 * All writes are idempotent (upsert by Item_Code; PC matched by Room_ID + Name).
 * Safe to re-run locally or in production.
 *
 * Usage:
 *   node scripts/seed-ay25-26-inventory.js "/path/to/workbook.xlsx"
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');
const { readXlsxWorkbook } = require('../src/utils/xlsxReader');

const ASSET_CODE_RE = /^[A-Z][A-Z0-9]{1,4}-\d{2,4}-[A-Z0-9]+$/i;

const PREFIX_TO_TYPE = {
  // PC components
  NUC: 'MINI_PC',
  MPC: 'MINI_PC',
  CPU: 'MINI_PC',
  MAC: 'MAC',
  MON: 'MONITOR',
  KBS: 'KEYBOARD',
  MOU: 'MOUSE',
  PAN: 'POWER_ADAPTER',
  PMP: 'POWER_ADAPTER',
  PMN: 'POWER_MONITOR',
  // Standalone / misc
  STV: 'SMART_TV',
  ELP: 'PROJECTOR',
  PRN: 'PRINTER',
  MIC: 'MICROPHONE',
  MXR: 'MIXER',
  AVR: 'AVR',
  CAL: 'CALCULATOR',
  CSL: 'KIT',
  SIK: 'KIT',
  S13: 'SWITCH',
  S29: 'SWITCH',
  SSF: 'SWITCH',
  SHP: 'SWITCH',
  SDL: 'SWITCH',
  R19: 'ROUTER',
  R29: 'ROUTER',
  R82: 'ROUTER',
  RMK: 'ROUTER',
  WRT: 'WIFI_ROUTER',
  WAD: 'WIFI_ADAPTER',
  SVR: 'SERVER',
  CAM: 'CAMERA',
  WBCM: 'WEBCAM',
  SMT: 'MULTIMETER',
  TBX: 'TOOLBOX',
  HCR: 'CCTV_RECORDER',
  HCS: 'CCTV_SWITCH',
  VSP: 'VIDEO_SPLITTER',
};

const PC_COMPONENT_TYPES = new Set([
  'MINI_PC', 'MAC', 'MONITOR', 'KEYBOARD', 'MOUSE', 'POWER_ADAPTER', 'POWER_MONITOR',
]);

const SHEET_ROOM_MAP = {
  'Faculty Office': 'Faculty Office',
  'Department Office': 'Department Office',
  'LB400TC': 'LB400TC',
  'LB442TC': 'LB442TC',
  'LB443B':  'LB443B',
  'LB443TC': 'LB443TC',
  'LB445TC': 'LB445TC',
  'LB446TC': 'LB446TC',
  'LB447TC': 'LB447TC',
  'LB448TC': 'LB448TC',
  'LB467TC': 'LB467TC',
  'LB468TC': 'LB468TC',
  'LB469TC': 'LB469TC',
  'LB470TC': 'LB470TC',
  'ctrl room':       'Control Room',
  'ctrl room (2)':   'Control Room',
  'ctrl room new':   'Control Room',
  'Green Room':      'Green Room',
  'Green Room 2':    'Green Room',
  'CISCO Storage ':  'CISCO Storage',
  'CISCO Storage':   'CISCO Storage',
};

const LECTURE_ROOM_SHEET = 'LECTURE ROOMS';
const LECTURE_ROOM_MAP = {
  '483': 'LB483TC',
  '484': 'LB484TC',
  '485': 'LB485TC',
  '486': 'LB486TC',
};

const IGNORE_SHEETS = new Set(['LB467TC (2)', 'LB468TC (2)']);

const STATUS_MARKERS = new Set(['OK', 'X', 'DEF', 'DEFECTIVE']);
const HEADER_ROW_RE = /^(note|table|asset code|room no|department|date of inventory|semester|verified by|prepared by|submitted to|usc laboratory|room)/i;

const cleanText = (v) =>
  String(v ?? '')
    .replace(/_x000D_/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const looksLikeAssetCode = (v) => ASSET_CODE_RE.test(cleanText(v));

const prefixOf = (code) => {
  const m = cleanText(code).match(/^([A-Z][A-Z0-9]+)-/i);
  return m ? m[1].toUpperCase() : null;
};

const itemTypeFor = (code) => {
  const p = prefixOf(code);
  return (p && PREFIX_TO_TYPE[p]) || 'OTHER';
};

const normalizeStatus = (s) => {
  const v = cleanText(s).toUpperCase();
  return (v === 'X' || v === 'DEF' || v === 'DEFECTIVE') ? 'DEFECTIVE' : 'AVAILABLE';
};

const inferBrandAndSerial = (detail) => {
  const t = cleanText(detail);
  if (!t) return { Brand: null, Serial_Number: null };
  if (/\d/.test(t)) return { Brand: null, Serial_Number: t };
  return { Brand: t.toUpperCase(), Serial_Number: null };
};

function extractItemsFromRow(row) {
  const items = [];
  for (let i = 0; i < row.length; i++) {
    if (!looksLikeAssetCode(row[i])) continue;
    const code = cleanText(row[i]);
    const next1 = cleanText(row[i + 1] || '');
    const next2 = cleanText(row[i + 2] || '');

    let detail = '';
    let status = 'AVAILABLE';
    if (STATUS_MARKERS.has(next1.toUpperCase())) {
      status = normalizeStatus(next1);
    } else {
      detail = next1;
      if (STATUS_MARKERS.has(next2.toUpperCase())) {
        status = normalizeStatus(next2);
      }
    }

    items.push({ code, detail, status, columnIndex: i });
  }
  return items;
}

function derivePcName(row, rowNumber, pcComponents, isLectureSheet) {
  if (isLectureSheet) return 'PC 1';
  const first = cleanText(row[0]);
  if (/^\d+(\.\d+)?$/.test(first)) {
    return `PC ${Math.floor(parseFloat(first))}`;
  }
  if (pcComponents.length > 0) {
    return `PC ${pcComponents[0].code}`;
  }
  return `PC row${rowNumber}`;
}

async function upsertItem(tx, data) {
  const existing = await tx.item.findFirst({
    where: { Item_Code: { equals: data.Item_Code, mode: 'insensitive' } },
  });
  if (existing) {
    return tx.item.update({
      where: { Item_ID: existing.Item_ID },
      data: {
        Item_Type: data.Item_Type,
        Brand: data.Brand,
        Serial_Number: data.Serial_Number,
        Status: data.Status,
        Room_ID: data.Room_ID,
        IsBorrowable: false,
        Updated_At: new Date(),
      },
    });
  }
  return tx.item.create({
    data: { ...data, IsBorrowable: false, Created_At: new Date(), Updated_At: new Date() },
  });
}

async function upsertComputerWithItems(tx, { roomId, name, itemIds }) {
  const existing = await tx.computer.findFirst({ where: { Room_ID: roomId, Name: name } });
  const computer = existing
    ? await tx.computer.update({
        where: { Computer_ID: existing.Computer_ID },
        data: { Updated_At: new Date() },
      })
    : await tx.computer.create({
        data: { Name: name, Room_ID: roomId, Status: 'AVAILABLE', Updated_At: new Date() },
      });

  if (itemIds.length === 0) return computer;

  const otherPcs = await tx.computer.findMany({
    where: {
      Computer_ID: { not: computer.Computer_ID },
      Item: { some: { Item_ID: { in: itemIds } } },
    },
    select: { Computer_ID: true, Item: { where: { Item_ID: { in: itemIds } }, select: { Item_ID: true } } },
  });
  for (const other of otherPcs) {
    await tx.computer.update({
      where: { Computer_ID: other.Computer_ID },
      data: { Item: { disconnect: other.Item.map((i) => ({ Item_ID: i.Item_ID })) } },
    });
  }

  await tx.computer.update({
    where: { Computer_ID: computer.Computer_ID },
    data: { Item: { set: itemIds.map((Item_ID) => ({ Item_ID })) } },
  });

  return computer;
}

async function main() {
  const workbookPath = process.argv[2];
  if (!workbookPath) {
    console.error('Usage: node scripts/seed-ay25-26-inventory.js <path-to-workbook.xlsx>');
    process.exit(1);
  }

  const absPath = path.resolve(workbookPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Workbook not found: ${absPath}`);
    process.exit(1);
  }

  const workbook = readXlsxWorkbook(fs.readFileSync(absPath));

  const rooms = await prisma.room.findMany();
  const roomByName = new Map(rooms.map((r) => [r.Name, r]));

  const adminUser = await prisma.user.findFirst({ where: { User_Role: 'ADMIN' } });
  if (!adminUser) {
    console.error('No ADMIN user found — seed users first (prisma/seed.js).');
    process.exit(1);
  }
  const userId = adminUser.User_ID;

  const stats = {
    sheetsProcessed: 0,
    sheetsSkipped: 0,
    pcs: 0,
    items: 0,
    standalone: 0,
    errors: [],
  };

  for (const sheet of workbook.sheets) {
    if (IGNORE_SHEETS.has(sheet.name)) {
      stats.sheetsSkipped++;
      console.log(`[skip] ${sheet.name} (ignored)`);
      continue;
    }

    const isLectureSheet = sheet.name === LECTURE_ROOM_SHEET;

    let defaultRoom = null;
    if (!isLectureSheet) {
      const roomName = SHEET_ROOM_MAP[sheet.name];
      if (!roomName) {
        stats.sheetsSkipped++;
        console.log(`[skip] ${sheet.name} (no mapping)`);
        continue;
      }
      defaultRoom = roomByName.get(roomName);
      if (!defaultRoom) {
        stats.errors.push(`Sheet "${sheet.name}" maps to missing room "${roomName}". Run seed-workbook-rooms.js first.`);
        continue;
      }
    }

    let sheetPcs = 0;
    let sheetItems = 0;
    let sheetStandalone = 0;

    for (let idx = 0; idx < sheet.rows.length; idx++) {
      const row = sheet.rows[idx];
      if (!row.some((c) => cleanText(c))) continue;
      const first = cleanText(row[0]);
      if (HEADER_ROW_RE.test(first) && !isLectureSheet) continue;

      let targetRoom = defaultRoom;
      if (isLectureSheet) {
        const lrNum = parseFloat(first);
        if (!Number.isFinite(lrNum)) continue;
        const lrKey = String(Math.floor(lrNum));
        const targetName = LECTURE_ROOM_MAP[lrKey];
        if (!targetName) continue;
        targetRoom = roomByName.get(targetName);
        if (!targetRoom) {
          stats.errors.push(`Lecture room ${lrKey} missing — run seed-workbook-rooms.js first.`);
          continue;
        }
      }

      const extracted = extractItemsFromRow(row);
      if (extracted.length === 0) continue;

      const candidates = extracted.map((e) => {
        const itemType = itemTypeFor(e.code);
        const { Brand, Serial_Number } = inferBrandAndSerial(e.detail);
        return {
          code: e.code,
          isPcPart: PC_COMPONENT_TYPES.has(itemType),
          data: {
            Item_Code: e.code,
            Item_Type: itemType,
            Brand,
            Serial_Number,
            Status: e.status,
            Room_ID: targetRoom.Room_ID,
            User_ID: userId,
          },
        };
      });

      const pcParts = candidates.filter((c) => c.isPcPart);
      const standalones = candidates.filter((c) => !c.isPcPart);

      try {
        await prisma.$transaction(async (tx) => {
          const pcItemIds = [];
          for (const c of pcParts) {
            const item = await upsertItem(tx, c.data);
            pcItemIds.push(item.Item_ID);
            sheetItems++;
          }
          for (const c of standalones) {
            await upsertItem(tx, c.data);
            sheetItems++;
            sheetStandalone++;
          }
          if (pcParts.length > 0) {
            const name = derivePcName(row, idx + 1, pcParts, isLectureSheet);
            await upsertComputerWithItems(tx, {
              roomId: targetRoom.Room_ID,
              name,
              itemIds: pcItemIds,
            });
            sheetPcs++;
          }
        });
      } catch (err) {
        stats.errors.push(`${sheet.name} row ${idx + 1}: ${err.message}`);
      }
    }

    stats.sheetsProcessed++;
    stats.pcs += sheetPcs;
    stats.items += sheetItems;
    stats.standalone += sheetStandalone;
    console.log(
      `[ok]   ${sheet.name.padEnd(22)} PCs=${String(sheetPcs).padStart(3)} items=${String(sheetItems).padStart(3)} standalone=${String(sheetStandalone).padStart(3)}`
    );
  }

  console.log('');
  console.log('=== Inventory import summary ===');
  console.log(`Sheets processed:  ${stats.sheetsProcessed}`);
  console.log(`Sheets skipped:    ${stats.sheetsSkipped}`);
  console.log(`PCs upserted:      ${stats.pcs}`);
  console.log(`Items upserted:    ${stats.items}`);
  console.log(`   of which standalone: ${stats.standalone}`);
  if (stats.errors.length > 0) {
    console.log(`Errors (${stats.errors.length}):`);
    stats.errors.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 2;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
