// One-shot QA script for the auto-reject conflicting bookings feature.
// Seeds two overlapping PENDING bookings on the same room, approves one
// via the real HTTP API, and verifies the other flips to REJECTED with
// the auto-reject reason. Cleans up after itself.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const API = 'http://localhost:3000/api';

const ROOM_ID = 1;            // Mac Room Test (LAB)
const FACULTY_A = 4;          // faculty@bits.edu
const FACULTY_B = 6;          // student@bits.edu — used as a second pending booker
const APPROVER_ID = 3;        // labhead@bits.edu

const QA_TAG = '__QA_AUTO_REJECT__';

async function main() {
  // Pick a date far in the future (Tue 2027-06-01) to avoid colliding with
  // anything in the live calendar. 09:00–11:00 vs 10:00–12:00 overlaps.
  const startA = new Date('2027-06-01T09:00:00.000Z');
  const endA   = new Date('2027-06-01T11:00:00.000Z');
  const startB = new Date('2027-06-01T10:00:00.000Z');
  const endB   = new Date('2027-06-01T12:00:00.000Z');

  // Clean any leftover from previous QA runs.
  await prisma.Booked_Room.deleteMany({ where: { Purpose: QA_TAG } });

  const a = await prisma.Booked_Room.create({
    data: {
      Room_ID: ROOM_ID, User_ID: FACULTY_A,
      Start_Time: startA, End_Time: endA,
      Status: 'PENDING', Purpose: QA_TAG
    }
  });
  const b = await prisma.Booked_Room.create({
    data: {
      Room_ID: ROOM_ID, User_ID: FACULTY_B,
      Start_Time: startB, End_Time: endB,
      Status: 'PENDING', Purpose: QA_TAG
    }
  });
  // Control 1: same room, NON-overlapping (later in the day) — must stay PENDING.
  const c = await prisma.Booked_Room.create({
    data: {
      Room_ID: ROOM_ID, User_ID: FACULTY_B,
      Start_Time: new Date('2027-06-01T13:00:00.000Z'),
      End_Time:   new Date('2027-06-01T14:00:00.000Z'),
      Status: 'PENDING', Purpose: QA_TAG
    }
  });
  // Control 2: different room, overlapping time — must stay PENDING.
  const d = await prisma.Booked_Room.create({
    data: {
      Room_ID: 2, User_ID: FACULTY_B,
      Start_Time: startB, End_Time: endB,
      Status: 'PENDING', Purpose: QA_TAG
    }
  });
  console.log(`Seeded: A=${a.Booked_Room_ID} pending overlap`);
  console.log(`        B=${b.Booked_Room_ID} pending overlap (should auto-reject)`);
  console.log(`        C=${c.Booked_Room_ID} pending same-room non-overlap (should stay PENDING)`);
  console.log(`        D=${d.Booked_Room_ID} pending different-room overlap (should stay PENDING)`);

  const token = jwt.sign({ userId: APPROVER_ID }, JWT_SECRET, { expiresIn: '5m' });

  const res = await fetch(`${API}/bookings/${a.Booked_Room_ID}/status`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED', approverId: APPROVER_ID })
  });
  const body = await res.json();
  console.log(`\nPATCH /bookings/${a.Booked_Room_ID}/status -> ${res.status}`);
  console.log('response:', JSON.stringify(body, null, 2));

  // Re-read both bookings.
  const finalA = await prisma.Booked_Room.findUnique({ where: { Booked_Room_ID: a.Booked_Room_ID } });
  const finalB = await prisma.Booked_Room.findUnique({ where: { Booked_Room_ID: b.Booked_Room_ID } });
  const finalC = await prisma.Booked_Room.findUnique({ where: { Booked_Room_ID: c.Booked_Room_ID } });
  const finalD = await prisma.Booked_Room.findUnique({ where: { Booked_Room_ID: d.Booked_Room_ID } });
  console.log(`\nFinal A.Status = ${finalA.Status}, Approved_By=${finalA.Approved_By}`);
  console.log(`Final B.Status = ${finalB.Status}, Notes=${JSON.stringify(finalB.Notes)}, Approved_By=${finalB.Approved_By}`);
  console.log(`Final C.Status = ${finalC.Status} (control: same-room non-overlap)`);
  console.log(`Final D.Status = ${finalD.Status} (control: different-room overlap)`);

  let pass = true;
  if (finalA.Status !== 'APPROVED') { console.error('FAIL: A should be APPROVED'); pass = false; }
  if (finalB.Status !== 'REJECTED') { console.error('FAIL: B should be REJECTED'); pass = false; }
  if (!finalB.Notes || !/Auto-rejected/i.test(finalB.Notes)) { console.error('FAIL: B should have auto-reject reason in Notes'); pass = false; }
  if (finalB.Approved_By !== APPROVER_ID) { console.error('FAIL: B.Approved_By should equal approver'); pass = false; }
  if (finalC.Status !== 'PENDING') { console.error('FAIL: C (same-room non-overlap) should stay PENDING'); pass = false; }
  if (finalD.Status !== 'PENDING') { console.error('FAIL: D (different-room overlap) should stay PENDING'); pass = false; }
  if (!body?.meta?.autoRejectedBookingIds?.includes(b.Booked_Room_ID)) {
    console.error('FAIL: response meta should include B in autoRejectedBookingIds');
    pass = false;
  }
  if (body?.meta?.autoRejectedBookingIds?.includes(c.Booked_Room_ID) || body?.meta?.autoRejectedBookingIds?.includes(d.Booked_Room_ID)) {
    console.error('FAIL: response meta should NOT include C or D');
    pass = false;
  }

  // Cleanup.
  await prisma.Booked_Room.deleteMany({ where: { Purpose: QA_TAG } });

  console.log(pass ? '\nQA PASS ✅' : '\nQA FAIL ❌');
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.Booked_Room.deleteMany({ where: { Purpose: QA_TAG } }).catch(() => {});
  process.exit(2);
});
