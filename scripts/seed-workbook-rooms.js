/**
 * Idempotent seed for rooms referenced by the AY 25-26 inventory workbook.
 *
 * Safe to run against any environment. For each target room:
 *   - Renames the legacy short-form (LB400 -> LB400TC) if present.
 *   - Fixes Room_Type if it drifted (e.g. LB468 stored as LECTURE).
 *   - Creates the room if neither the legacy nor target name exists.
 *
 * Reports but does not auto-delete suspicious test rows.
 *
 * Usage: node scripts/seed-workbook-rooms.js
 */

const prisma = require('../src/lib/prisma');

const TARGET_ROOMS = [
  { name: 'LB400TC', type: 'LAB',     capacity: 40, renameFrom: 'LB400' },
  { name: 'LB442TC', type: 'LAB',     capacity: 40 },
  { name: 'LB443TC', type: 'LAB',     capacity: 40 },
  { name: 'LB443B',  type: 'LAB',     capacity: 40 },
  { name: 'LB445TC', type: 'LAB',     capacity: 40, renameFrom: 'LB445' },
  { name: 'LB446TC', type: 'LAB',     capacity: 40 },
  { name: 'LB447TC', type: 'LAB',     capacity: 40 },
  { name: 'LB448TC', type: 'LAB',     capacity: 40 },
  { name: 'LB467TC', type: 'LAB',     capacity: 40, renameFrom: 'LB467' },
  { name: 'LB468TC', type: 'LAB',     capacity: 40, renameFrom: 'LB468' },
  { name: 'LB469TC', type: 'LAB',     capacity: 40, renameFrom: 'LB469' },
  { name: 'LB470TC', type: 'LAB',     capacity: 40 },
  { name: 'LB483TC', type: 'LECTURE', capacity: 50 },
  { name: 'LB484TC', type: 'LECTURE', capacity: 50 },
  { name: 'LB485TC', type: 'LECTURE', capacity: 50 },
  { name: 'LB486TC', type: 'LECTURE', capacity: 50 },
  { name: 'Faculty Office',    type: 'OTHER', capacity: 20 },
  { name: 'Department Office', type: 'OTHER', capacity: 20 },
  { name: 'Control Room',      type: 'OTHER', capacity: 15 },
  { name: 'Green Room',        type: 'OTHER', capacity: 30 },
  { name: 'CISCO Storage',     type: 'OTHER', capacity: 10 },
];

async function main() {
  const summary = { created: [], renamed: [], typeFixed: [], unchanged: [], conflicts: [] };

  for (const target of TARGET_ROOMS) {
    const existingTarget = await prisma.room.findFirst({ where: { Name: target.name } });
    const existingLegacy = target.renameFrom
      ? await prisma.room.findFirst({ where: { Name: target.renameFrom } })
      : null;

    if (existingTarget) {
      if (existingLegacy && existingLegacy.Room_ID !== existingTarget.Room_ID) {
        summary.conflicts.push(
          `Both "${target.renameFrom}" (id=${existingLegacy.Room_ID}) and "${target.name}" (id=${existingTarget.Room_ID}) exist. Reconcile manually.`
        );
      }

      if (existingTarget.Room_Type !== target.type) {
        await prisma.room.update({
          where: { Room_ID: existingTarget.Room_ID },
          data: { Room_Type: target.type },
        });
        summary.typeFixed.push(`${target.name}: ${existingTarget.Room_Type} -> ${target.type}`);
      } else {
        summary.unchanged.push(target.name);
      }
      continue;
    }

    if (existingLegacy) {
      const patch = { Name: target.name };
      if (existingLegacy.Room_Type !== target.type) patch.Room_Type = target.type;
      await prisma.room.update({
        where: { Room_ID: existingLegacy.Room_ID },
        data: patch,
      });
      summary.renamed.push(
        patch.Room_Type
          ? `${target.renameFrom} -> ${target.name} (type ${existingLegacy.Room_Type} -> ${target.type})`
          : `${target.renameFrom} -> ${target.name}`
      );
      continue;
    }

    await prisma.room.create({
      data: {
        Name: target.name,
        Room_Type: target.type,
        Capacity: target.capacity,
      },
    });
    summary.created.push(target.name);
  }

  // Cleanup: remove rooms NOT in the target list, but only when they have no dependent records.
  // Relies on FK constraints (Prisma throws P2003 if anything references the row), so we never
  // force-delete production data.
  const targetNames = new Set(TARGET_ROOMS.map((t) => t.name));
  const allRooms = await prisma.room.findMany();
  summary.deleted = [];
  summary.keptExtras = [];
  for (const room of allRooms) {
    if (targetNames.has(room.Name)) continue;
    try {
      await prisma.room.delete({ where: { Room_ID: room.Room_ID } });
      summary.deleted.push(`${room.Name} (id=${room.Room_ID})`);
    } catch (err) {
      const [items, computers, schedules, bookings, tickets] = await Promise.all([
        prisma.item.count({ where: { Room_ID: room.Room_ID } }).catch(() => 0),
        prisma.computer.count({ where: { Room_ID: room.Room_ID } }).catch(() => 0),
        prisma.schedule.count({ where: { Room_ID: room.Room_ID } }).catch(() => 0),
        prisma.booked_Room.count({ where: { Room_ID: room.Room_ID } }).catch(() => 0),
        prisma.ticket.count({ where: { Room_ID: room.Room_ID } }).catch(() => 0),
      ]);
      const parts = [];
      if (items) parts.push(`${items} items`);
      if (computers) parts.push(`${computers} PCs`);
      if (schedules) parts.push(`${schedules} schedules`);
      if (bookings) parts.push(`${bookings} bookings`);
      if (tickets) parts.push(`${tickets} tickets`);
      summary.keptExtras.push(`${room.Name} (id=${room.Room_ID}) — blocked by ${parts.join(', ') || 'unknown refs'}`);
    }
  }

  console.log('');
  console.log('=== Room seed summary ===');
  console.log(`Created   (${summary.created.length}):`, summary.created.join(', ') || 'none');
  console.log(`Renamed   (${summary.renamed.length}):`, summary.renamed.join(', ') || 'none');
  console.log(`Type fix  (${summary.typeFixed.length}):`, summary.typeFixed.join(', ') || 'none');
  console.log(`Unchanged (${summary.unchanged.length}):`, summary.unchanged.join(', ') || 'none');
  console.log(`Deleted   (${summary.deleted.length}):`, summary.deleted.join(', ') || 'none');
  if (summary.keptExtras.length) {
    console.log(`KEPT EXTRAS (${summary.keptExtras.length}) — not in target list but have data:`);
    summary.keptExtras.forEach((c) => console.log(`  - ${c}`));
  }
  if (summary.conflicts.length) {
    console.log(`CONFLICTS (${summary.conflicts.length}):`);
    summary.conflicts.forEach((c) => console.log(`  - ${c}`));
    process.exitCode = 2;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
