# Deploy — bits-backend

Short checklist for pushing the Express API to production.

## Prerequisites

- Node 22+ installed on the target host
- `DATABASE_URL` pointing to the prod Postgres
- `JWT_SECRET` and any other `.env` variables populated on the host
- SSH / shell access to the prod server

## Deploy steps

```bash
# 1. Pull latest
git pull origin main

# 2. Install production dependencies
npm ci --omit=dev

# 3. Apply pending database migrations
npx prisma migrate deploy

# 4. Regenerate the Prisma client (matches schema)
npx prisma generate

# 5. Restart the service
#    pm2 restart bits-backend     # if you use pm2
#    systemctl restart bits-api   # if you use systemd
```

## One-time seed scripts

Only run these when seeding a fresh environment or bulk-importing legacy data. **They are safe to re-run (idempotent) but still destructive for unrelated rows** — read the script output before continuing in prod.

```bash
# Creates / renames rooms for the AY 25-26 workbook layout, prunes stray rooms
# that have no dependent records.
npm run seed:rooms

# Imports inventory items + PC setups from the AY 25-26 workbook. Requires the
# xlsx file to be reachable on the server.
npm run seed:inventory -- "/absolute/path/to/First SEM lab inventory AY 25-26.xlsx"
```

## Rollback

If a migration goes bad:

```bash
# Mark the last migration as rolled back (does NOT undo schema changes)
npx prisma migrate resolve --rolled-back <migration_name>

# Then restore the DB from backup and redeploy the previous tag
git checkout <previous-tag>
npm ci --omit=dev
npx prisma generate
# restart
```

Always take a DB backup before running `migrate deploy` on a release that includes destructive schema changes (DROP COLUMN, ALTER TYPE, etc.).
