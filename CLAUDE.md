# BITS Backend

## Stack
- Express 5 + Node.js (JavaScript — no TS migration)
- Prisma ORM + PostgreSQL
- Auth: JWT (jsonwebtoken + bcrypt)
- Real-time: WebSocket (`ws`) — no SSE
- Validation: Joi
- File upload: Multer
- Scheduled jobs: node-cron

## Documentation map (READ FIRST when working backend modules)

- `docs/modules/_index.md` — module overview table (all 17 modules + their role gates + brief purpose)
- `docs/roles-permissions.md` — endpoint-keyed permissions: every route, with HTTP verb, path, roles allowed, purpose

For multi-role flows that drive endpoint usage, see `../bits-frontend/docs/flows.md`.
For role definitions, see `prisma/schema.prisma` (`UserRole` enum) or `../bits-frontend/docs/roles/_index.md`.

## Project Structure
```
src/
├── index.js       # Slim entry point
├── server.js      # Express setup, middleware, route mounting, WebSocket
├── lib/prisma.js  # Prisma singleton
├── middleware/    # auth, authorize, errorHandler, validate, requestLogging
├── modules/       # 17 modules — see docs/modules/_index.md
│   └── <name>/
│       ├── <name>.routes.js       # router + middleware chain
│       ├── <name>.controller.js   # business logic
│       └── <name>.validation.js   # Joi schemas (where non-trivial)
├── services/      # Cross-module business logic (notification, heartbeat, websocket)
├── jobs/          # Scheduled tasks (heartbeat monitor, notification jobs)
└── utils/         # asyncHandler, auditLogger, notificationUtils
```

## Conventions
- ALL responses use envelope: `{ success: boolean, data: any, error?: string, meta?: object }`
- Wrap every route handler in `asyncHandler` from `src/utils/asyncHandler.js`
- Role gating goes in route files via `authorize('ROLE1', 'ROLE2')` — never inline checks in controllers
- Use Prisma singleton from `src/lib/prisma.js` — never `new PrismaClient()`
- Module pattern: routes define middleware chain → controllers contain business logic → validation files hold Joi schemas
- WebSocket only for real-time notifications

## Commands
```bash
npm run dev              # Start with nodemon
npm start                # Production start
npm test                 # Run Jest tests
npx prisma studio        # Database GUI
npx prisma migrate dev   # Run migrations
npx prisma db seed       # Seed database
```

## API surface
All routes prefixed with `/api/`. Full route + role table is in `docs/roles-permissions.md`.

Module list (17): `auth`, `bookings`, `borrowing`, `computers`, `dashboard`, `forms`, `heartbeat`, `inventory`, `maintenance`, `notifications`, `reports`, `rooms`, `schedules`, `semesters`, `tickets`, `upload`, `users`.

## WebSocket
- Endpoint: `ws://localhost:3000/ws/notifications?token=JWT`
- Authenticated via JWT query parameter
- Used for real-time notification delivery

## Update discipline (keep docs in sync)
When you change the codebase, update the matching doc in the **same commit**:

- Add/remove a route → update `docs/roles-permissions.md`
- Add/remove a module → update `docs/modules/_index.md` + `docs/roles-permissions.md`
- Change `authorize()` roles on any route → update `docs/roles-permissions.md`
- Change response envelope or middleware chain conventions → update this `CLAUDE.md`

If a doc disagrees with the code, the code wins — fix the doc, don't trust stale guidance.
