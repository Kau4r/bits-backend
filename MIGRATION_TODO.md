# Migration TODO — add_queue_status

## What changed in `prisma/schema.prisma`
- New enum `QueueStatus { OPEN, NEAR_FULL, FULL }`
- New field `Queue_Status QueueStatus @default(OPEN)` on `Booked_Room`

## What was applied automatically
- `npx prisma db push` was run successfully against the local `bitsdb` database,
  so the schema is live and the Prisma client exports `QueueStatus`.
- `npx prisma generate` partially succeeded: the TypeScript/JS client files were
  regenerated (index.d.ts timestamps updated) but the Windows query_engine DLL
  rename failed with `EPERM` because a node process was holding the file open.
  The runtime still works because the engine is loaded from the pre-existing
  DLL (which is compatible — the engine reads the schema dynamically).

## What you still need to do
1. Stop any running backend dev server (`npm run dev` / nodemon).
2. Run: `npx prisma migrate dev --name add_queue_status` to produce a proper
   migration file under `prisma/migrations/`. This previously failed with
   `P3006: Migration 20260422111203_remove_item_location failed to apply
   cleanly to the shadow database. column "Location" of relation "Item" does
   not exist.` That's a pre-existing migration issue unrelated to this change.
3. If the shadow DB error persists, resolve that older migration first (e.g.
   `npx prisma migrate resolve --applied 20260422111203_remove_item_location`),
   then re-run `migrate dev`.
4. Re-run `npx prisma generate` with no node processes holding the DLL to get
   a clean query engine binary.

## Verification
- `node -e "const p = require('@prisma/client'); console.log(p.QueueStatus)"`
  should print `{ OPEN: 'OPEN', NEAR_FULL: 'NEAR_FULL', FULL: 'FULL' }` — this
  was confirmed passing after `db push`.
