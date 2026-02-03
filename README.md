# bits-backend

Backend for the Booking, Inventory, and Tracking System of the Department of Computer, Information System and Mathematics.

## Overview

This backend uses Express.js, Prisma ORM, and PostgreSQL. It provides a RESTful API to serve the frontend application with authentication, inventory management, and booking services.

## Tech Stack

- Node.js
- Express.js
- Prisma ORM
- PostgreSQL
- JSON Web Token (JWT) for authentication
- Passport.js (optional, modular auth)

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_ORG/bits-backend.git

2. Install dependencies:
   ```bash
   npm install

3. Set up PostgreSQL and environment variables:
   - Install PostgreSQL from https://www.postgresql.org/download/windows/
   - During installation:
     - Set a password for the postgres user
     - Keep the default port (5432)
     - Add PostgreSQL to PATH
     - Install pgAdmin4 (the GUI tool)
   - Create a database named 'bitsdb' using pgAdmin4
   - Create a .env file in the root:
   ```env
   DATABASE_URL=postgresql://postgres:your_password@localhost:5432/bitsdb
   
4. Run migrations:
   ```bash
   npx prisma migrate dev --name init

5. Initialize Users
   ```bash
   npx prisma db seed

6. Run backend:
   ```bash
   npm run dev
   ```

---

## Heartbeat Monitoring System

The backend includes a real-time heartbeat monitoring system for tracking computer availability across multiple labs.

### Features

- **Automatic Computer Detection**: Uses ARP lookup to identify computers by MAC address
- **Adaptive Heartbeat Intervals**: 10s (high frequency), 30s (normal), or 120s (low frequency) based on computer state
- **Real-Time Updates**: WebSocket/SSE broadcasts for instant status updates to lab technicians
- **Offline Detection**: Background job marks computers offline after 2 minutes of no heartbeat
- **Role-Based Notifications**: Lab technicians and lab heads receive alerts for offline computers

### API Endpoints

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/heartbeat/register` | POST | Auto-detect and register computer | Required |
| `/api/heartbeat` | POST | Send heartbeat signal | Required |
| `/api/heartbeat/status` | GET | Get status summary by room | LAB_TECH+ |
| `/api/heartbeat/computer/:id` | GET | Get detailed heartbeat history | LAB_TECH+ |
| `/api/heartbeat/session/:sessionId` | DELETE | End heartbeat session | Required |

### Background Jobs

**Offline Detection Job** (runs every minute):
- Checks for computers with heartbeats older than 2 minutes
- Marks stale computers as offline
- Sends alerts to lab technicians
- Broadcasts status updates via WebSocket

To start the background job:
```javascript
// In src/index.js
const { startHeartbeatMonitor } = require('./jobs/heartbeatMonitor');
startHeartbeatMonitor();
```

### Services

**HeartbeatService** (`src/services/heartbeatService.js`):
- `processHeartbeat()`: Process incoming heartbeat and update computer status
- `getMacFromIP()`: Cross-platform MAC address lookup (Linux, macOS, Windows)
- `calculateNextInterval()`: Adaptive interval logic (10s/30s/120s)
- `checkOfflineComputers()`: Background job to detect stale heartbeats
- `markComputerOffline()`: Mark computer offline and send alerts
- `getStatusSummary()`: Get room-wise status summary

**NotificationService** (`src/services/notificationService.js`):
- `notifyRole()`: Broadcast to specific user roles (LAB_TECH, LAB_HEAD)
- `createNotification()`: Send real-time notifications via WebSocket/SSE

### Database Models

**ComputerHeartbeat**:
```prisma
model ComputerHeartbeat {
  Heartbeat_ID   Int      @id @default(autoincrement())
  Computer_ID    Int
  User_ID        Int?
  Session_ID     String   @unique
  Status         String   // ONLINE, IDLE, OFFLINE
  IP_Address     String?
  Timestamp      DateTime @default(now())
  Interval_Used  Int?
  Session_Start  DateTime?
  Session_End    DateTime?
  Is_Active      Boolean  @default(true)

  Computer       Computer @relation(...)
  User           User?    @relation(...)
}
```

**Computer** (Heartbeat-Related Fields):
- `Mac_Address`: Unique MAC address for auto-detection
- `Is_Online`: Current online status (boolean)
- `Last_Seen`: Timestamp of last heartbeat
- `Current_User_ID`: Currently logged-in user

### WebSocket Events

**COMPUTER_STATUS_UPDATE**: Real-time status updates (sent on every heartbeat)
```json
{
  "type": "COMPUTER_STATUS_UPDATE",
  "data": {
    "computer_id": 123,
    "computer_name": "LAB-A-PC-01",
    "is_online": true,
    "last_seen": "2026-02-04T10:30:00Z"
  }
}
```

**COMPUTER_OFFLINE**: Alert when computer goes offline
```json
{
  "type": "COMPUTER_OFFLINE",
  "title": "Computer Offline Alert",
  "message": "Computer LAB-A-PC-01 in Lab A has gone offline",
  "data": { "computer_id": 123, "room_id": 1 }
}
```

### Configuration

**Thresholds** (in `src/services/heartbeatService.js`):
```javascript
OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;  // 2 minutes
HIGH_FREQUENCY_INTERVAL = 10;           // 10 seconds
NORMAL_INTERVAL = 30;                   // 30 seconds
LOW_FREQUENCY_INTERVAL = 120;           // 120 seconds
```

### Testing

Run integration tests:
```bash
npm test -- heartbeat
```

Manual smoke tests:
1. Register computer as student: `POST /api/heartbeat/register`
2. Send heartbeat: `POST /api/heartbeat`
3. View status as lab tech: `GET /api/heartbeat/status`
4. End session: `DELETE /api/heartbeat/session/:sessionId`

### Documentation

For detailed API documentation, see:
- [API-HEARTBEAT.md](../docs/API-HEARTBEAT.md) - Complete API reference
- [WEBSOCKET-EVENTS.md](../docs/WEBSOCKET-EVENTS.md) - WebSocket event types
- [INTEGRATION-TESTING.md](../docs/INTEGRATION-TESTING.md) - Testing checklist

---

## Security

- JWT authentication required for all endpoints
- Role-based authorization (LAB_TECH, LAB_HEAD, ADMIN)
- Session ownership verification for DELETE operations
- Rate limiting on heartbeat endpoint (200 req/min per computer)
- ARP lookup restricted to server-side (MAC addresses not exposed to client)