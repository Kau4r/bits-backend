// One-time backfill that cleans up existing inventory rows so they match the
// normalization rules added to the import / create / update flows.
//
// Two passes run sequentially:
//   1. Brand / Serial sentinel cleanup. Replaces "OLD", "N/A", "NO S/N" etc
//      with null so the UI shows a clean "—" instead of garbage.
//   2. Synthetic-serial assignment. Items whose Serial_Number is null get
//      "INT-{ITEM_TYPE}-NNNN" appended, sequenced per type, continuing past
//      whatever INT-* rows already exist.
//
// Usage:
//   node scripts/backfill-inventory-data.js              # dry-run, prints summary, no writes
//   node scripts/backfill-inventory-data.js --apply      # actually writes changes
//   node scripts/backfill-inventory-data.js --apply --no-synthetic
//                                                       # cleanup only, skip synthetic serials

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const prisma = require('../src/lib/prisma');
const {
  normalizeBrand,
  normalizeSerial,
  buildSyntheticSerial,
} = require('../src/utils/inventoryNormalize');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const SKIP_SYNTHETIC = args.has('--no-synthetic');

const log = (...parts) => console.log(...parts);
const fmtCount = (n) => String(n).padStart(4, ' ');

async function main() {
  log('--- BITS inventory backfill ---');
  log(APPLY ? 'Mode:        APPLY (writes will be committed)' : 'Mode:        DRY RUN (no writes)');
  log(SKIP_SYNTHETIC ? 'Synthetic:   SKIP (cleanup only)' : 'Synthetic:   ASSIGN INT-{TYPE}-NNNN to items missing a serial');
  log('');

  const items = await prisma.item.findMany({
    select: {
      Item_ID: true,
      Item_Code: true,
      Item_Type: true,
      Brand: true,
      Serial_Number: true,
    },
    orderBy: { Item_ID: 'asc' },
  });

  log(`Loaded ${items.length} item(s) from prisma.item.`);
  log('');

  // ---- Pass 1: sentinel cleanup ----
  const updates = [];
  let brandFixed = 0;
  let serialFixed = 0;

  for (const item of items) {
    const newBrand = normalizeBrand(item.Brand);
    const newSerial = normalizeSerial(item.Serial_Number);
    const data = {};

    if (newBrand !== item.Brand) {
      data.Brand = newBrand;
      brandFixed += 1;
    }
    if (newSerial !== item.Serial_Number) {
      data.Serial_Number = newSerial;
      serialFixed += 1;
    }

    if (Object.keys(data).length > 0) {
      updates.push({ id: item.Item_ID, code: item.Item_Code, data, before: { Brand: item.Brand, Serial_Number: item.Serial_Number } });
    }
  }

  log('Pass 1 — sentinel cleanup');
  log(`  Brand changes:  ${fmtCount(brandFixed)}`);
  log(`  Serial changes: ${fmtCount(serialFixed)}`);
  log(`  Rows touched:   ${fmtCount(updates.length)}`);
  if (updates.length > 0) {
    log('  Sample (first 5):');
    updates.slice(0, 5).forEach(u => {
      const before = `Brand=${JSON.stringify(u.before.Brand)} Serial=${JSON.stringify(u.before.Serial_Number)}`;
      const after = `Brand=${JSON.stringify(u.data.Brand ?? '(unchanged)')} Serial=${JSON.stringify(u.data.Serial_Number ?? '(unchanged)')}`;
      log(`    [${u.code}] ${before}  →  ${after}`);
    });
  }
  log('');

  // ---- Pass 2: synthetic serial assignment ----
  const reloadedItems = APPLY ? null : items; // Re-read after writes if applying.

  // Decide which items still need a synthetic serial after pass 1.
  // In dry-run we use the *prospective* state (items + pass-1 changes).
  const projected = items.map(item => {
    const change = updates.find(u => u.id === item.Item_ID);
    return {
      Item_ID: item.Item_ID,
      Item_Code: item.Item_Code,
      Item_Type: item.Item_Type,
      Serial_Number: change && 'Serial_Number' in change.data
        ? change.data.Serial_Number
        : item.Serial_Number,
    };
  });

  const missingByType = new Map();
  if (!SKIP_SYNTHETIC) {
    for (const row of projected) {
      if (row.Serial_Number === null || row.Serial_Number === undefined || row.Serial_Number === '') {
        if (!missingByType.has(row.Item_Type)) missingByType.set(row.Item_Type, []);
        missingByType.get(row.Item_Type).push(row);
      }
    }
  }

  let syntheticAssigned = 0;
  const syntheticAssignments = []; // { id, code, serial }

  for (const [itemType, rows] of missingByType) {
    const prefix = `INT-${itemType}-`;
    const existingWithPrefix = await prisma.item.findMany({
      where: { Item_Type: itemType, Serial_Number: { startsWith: prefix } },
      select: { Serial_Number: true },
    });
    const maxSeq = existingWithPrefix.reduce((max, item) => {
      const match = item.Serial_Number?.match(/(\d+)$/);
      const n = match ? parseInt(match[1], 10) : 0;
      return n > max ? n : max;
    }, 0);

    rows.forEach((row, idx) => {
      const serial = buildSyntheticSerial(itemType, maxSeq + idx + 1);
      syntheticAssignments.push({ id: row.Item_ID, code: row.Item_Code, type: itemType, serial });
      syntheticAssigned += 1;
    });
  }

  log('Pass 2 — synthetic serial assignment');
  if (SKIP_SYNTHETIC) {
    log('  (skipped via --no-synthetic)');
  } else {
    log(`  Items needing serial: ${fmtCount(syntheticAssigned)}`);
    if (syntheticAssignments.length > 0) {
      log('  By type:');
      const byType = syntheticAssignments.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {});
      Object.entries(byType).forEach(([type, count]) => log(`    ${type.padEnd(20, ' ')} ${count}`));
      log('  Sample (first 5):');
      syntheticAssignments.slice(0, 5).forEach(a => log(`    [${a.code}] → ${a.serial}`));
    }
  }
  log('');

  // ---- Apply writes ----
  if (!APPLY) {
    log('DRY RUN complete. No changes written. Re-run with --apply to commit.');
    await prisma.$disconnect();
    return;
  }

  log('Applying changes...');
  let written = 0;

  for (const u of updates) {
    await prisma.item.update({ where: { Item_ID: u.id }, data: u.data });
    written += 1;
  }
  log(`  Pass 1: wrote ${written} row(s).`);

  let synthWritten = 0;
  for (const a of syntheticAssignments) {
    await prisma.item.update({
      where: { Item_ID: a.id },
      data: { Serial_Number: a.serial },
    });
    synthWritten += 1;
  }
  log(`  Pass 2: wrote ${synthWritten} synthetic serial(s).`);

  log('');
  log('--- DONE ---');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
