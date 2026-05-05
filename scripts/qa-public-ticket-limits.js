// QA the public ticket rate limiters: per-IP (existing 10/15min),
// per-identifier (new 1/10min), per-IP+room (new 1/10min).
// Submits a series of POSTs and asserts the right requests are blocked.
const prisma = require('../src/lib/prisma');

const API = 'http://localhost:3000/api/tickets/public';

const post = async (body) => {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const QA_DESC_TAG = '__QA_LIMITS__';

async function main() {
  // Pick two real rooms.
  const rooms = await prisma.room.findMany({ select: { Room_ID: true }, take: 2 });
  if (rooms.length < 2) throw new Error('Need at least 2 rooms');
  const [roomA, roomB] = rooms.map(r => r.Room_ID);

  const baseDesc = `${QA_DESC_TAG} test report description, sufficiently long.`;

  const results = [];

  // 1. First report from "Alice - 22102606" on roomA → expect 201.
  results.push(['Alice 1st on A', await post({
    reporterIdentifier: 'Alice - 22102606', roomId: roomA,
    issueType: 'HARDWARE', description: baseDesc,
  })]);

  // 2. Same name+ID on a DIFFERENT room → blocked by identifier limiter.
  results.push(['Alice 2nd on B (same name)', await post({
    reporterIdentifier: 'Alice - 22102606', roomId: roomB,
    issueType: 'HARDWARE', description: baseDesc,
  })]);

  // 3. Different name+ID, same IP, same roomA → blocked by ip+room limiter.
  results.push(['Bob on A (diff name, same room)', await post({
    reporterIdentifier: 'Bob - 22102607', roomId: roomA,
    issueType: 'HARDWARE', description: baseDesc,
  })]);

  // 4. Different name+ID, different room → expect 201.
  results.push(['Bob on B (diff name+room)', await post({
    reporterIdentifier: 'Bob - 22102607', roomId: roomB,
    issueType: 'HARDWARE', description: baseDesc,
  })]);

  // 5. Repeat #4 → blocked by both identifier and ip+room.
  results.push(['Bob on B again', await post({
    reporterIdentifier: 'Bob - 22102607', roomId: roomB,
    issueType: 'HARDWARE', description: baseDesc,
  })]);

  for (const [label, r] of results) {
    console.log(`[${r.status}] ${label} -> ${r.body.error || 'ok'}`);
  }

  const expectations = [201, 429, 429, 201, 429];
  let pass = true;
  results.forEach(([label, r], i) => {
    if (r.status !== expectations[i]) {
      console.error(`FAIL #${i + 1} ${label}: got ${r.status}, want ${expectations[i]}`);
      pass = false;
    }
  });

  // Cleanup any tickets we successfully created.
  await prisma.ticket.deleteMany({
    where: { Report_Problem: { contains: QA_DESC_TAG } }
  });

  console.log(pass ? '\nQA PASS ✅' : '\nQA FAIL ❌');
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.ticket.deleteMany({ where: { Report_Problem: { contains: QA_DESC_TAG } } }).catch(() => {});
  process.exit(2);
});
