# BITS Backend

## Stack
- Express 5 + Node.js (JavaScript)
- Prisma ORM + PostgreSQL
- Authentication: JWT (jsonwebtoken + bcrypt)
- Real-time: WebSocket (ws)
- Validation: Joi
- File upload: Multer
- Scheduled jobs: node-cron

## Project Structure
```
src/
├── index.js       # Slim entry point
├── server.js      # Express setup, middleware, route mounting, WebSocket
├── lib/prisma.js  # Prisma singleton
├── middleware/     # auth, authorize, errorHandler, validate, requestLogging
├── modules/       # Modular routes + controllers
│   ├── auth/      # auth.routes.js + auth.controller.js
│   ├── inventory/ # inventory.routes.js + inventory.controller.js + inventory.validation.js
│   ├── bookings/  # bookings.routes.js + bookings.controller.js + bookings.validation.js
│   └── ...        # 14 modules total
├── services/      # Business logic services (notification, heartbeat, websocket)
├── jobs/          # Scheduled tasks (heartbeat monitor, notification jobs)
└── utils/         # Utilities (asyncHandler, auditLogger, notificationUtils)
```

## Conventions
- ALL responses use envelope: `{ success: boolean, data: any, error?: string, meta?: object }`
- Use `asyncHandler` wrapper for all route handlers
- Use `authorize('ROLE1', 'ROLE2')` middleware for role-based access
- Use Prisma singleton from `src/lib/prisma.js` — never `new PrismaClient()`
- Module pattern: routes define middleware chain, controllers contain business logic
- WebSocket only for real-time notifications (no SSE)

## Commands
```bash
npm run dev     # Start with nodemon
npm start       # Production start
npm test        # Run Jest tests
npx prisma studio  # Database GUI
npx prisma migrate dev  # Run migrations
npx prisma db seed     # Seed database
```

## API Routes
All routes prefixed with `/api/`:
- `/api/auth/login` (POST), `/api/auth/logout` (POST)
- `/api/inventory`, `/api/users`, `/api/tickets`, `/api/rooms`
- `/api/bookings`, `/api/computers`, `/api/borrowing`
- `/api/notifications`, `/api/forms`, `/api/upload`
- `/api/dashboard`, `/api/heartbeat`, `/api/reports`

## WebSocket
- Endpoint: `ws://localhost:3000/ws/notifications?token=JWT`
- Authenticated via JWT query parameter
- Used for real-time notification delivery
