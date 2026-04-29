# Module Index

| Module | Path | Roles allowed | Brief purpose |
|---|---|---|---|
| auth | `src/modules/auth/` | (public) + any auth + ADMIN | Login/logout and `htshadow` user sync (ADMIN-only) |
| bookings | `src/modules/bookings/` | any auth; LAB_TECH/LAB_HEAD/ADMIN for write-restricted ops | Room booking CRUD, recurring series (RRULE), occupancy queues |
| borrowing | `src/modules/borrowing/` | any auth; LAB_TECH/LAB_HEAD/ADMIN for staff ops | Equipment borrow requests, walk-in lending, approve/reject/return |
| computers | `src/modules/computers/` | any auth (read); ADMIN/LAB_HEAD/LAB_TECH (write/delete) | Computer asset CRUD and CSV/XLSX bulk import |
| dashboard | `src/modules/dashboard/` | any auth | Aggregated metrics for the dashboard home |
| forms | `src/modules/forms/` | ADMIN/LAB_HEAD/LAB_TECH | Internal form tracking with attachments, archive, and transfer |
| heartbeat | `src/modules/heartbeat/` | any auth; LAB_TECH/LAB_HEAD/ADMIN for read ops | Computer presence/session tracking via periodic heartbeats |
| inventory | `src/modules/inventory/` | (public) for reads; ADMIN/LAB_HEAD/LAB_TECH for writes | Lab inventory items CRUD, bulk import, semester audit check |
| maintenance | `src/modules/maintenance/` | ADMIN only | Data cleanup, school-year archive, archive download |
| notifications | `src/modules/notifications/` | any auth (own notifications only) | Per-user notification inbox: read, unread, archive, restore |
| reports | `src/modules/reports/` | LAB_TECH (create/submit); LAB_HEAD (review); both + ADMIN (read/export) | Weekly lab reports lifecycle: draft → submit → review, CSV exports |
| rooms | `src/modules/rooms/` | (public) for basic reads; scoped roles for protected ops | Room/lab CRUD, opened-lab status, student availability, public landing-page endpoints |
| schedules | `src/modules/schedules/` | ADMIN only | Import offered-course schedules from XLSX workbook |
| semesters | `src/modules/semesters/` | any auth (read); ADMIN/LAB_HEAD (write) | Semester lifecycle: list, active semester, create, activate |
| tickets | `src/modules/tickets/` | (public) for anonymous report; ADMIN/LAB_HEAD/LAB_TECH for management | IT issue tickets: public anonymous submission, authenticated CRUD and status management |
| upload | `src/modules/upload/` | (public) for file serving; any auth for upload | Multer-backed file upload and passthrough file serving |
| users | `src/modules/users/` | any auth (read own/list); ADMIN for write | User CRUD, role change with JWT invalidation, bulk create, audit history |

## How modules are structured

Each module under `src/modules/<name>/` follows the same three-layer convention documented in `CLAUDE.md`:

1. **Routes** (`<name>.routes.js`) — declares the Express router, wires `authenticateToken` + `authorize()` middleware, and delegates to controller functions wrapped in `asyncHandler`.
2. **Controller** (`<name>.controller.js`) — contains all business logic: Prisma queries, response shaping using the standard `{ success, data, error, meta }` envelope, and any service calls.
3. **Validation** (`<name>.validation.js`, present where input validation is non-trivial, e.g. `inventory`, `bookings`, `tickets`) — exports Joi schemas consumed by the `validate()` middleware in the route layer.

Role gating always lives in the route file via `authorize('ROLE1', 'ROLE2')`. Controller-level runtime role divergence (e.g. filtering results differently by role) is noted inline in `docs/roles-permissions.md`.
