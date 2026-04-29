# Roles & Permissions Reference

Roles enum (`UserRole` in `prisma/schema.prisma`): `LAB_HEAD`, `LAB_TECH`, `FACULTY`, `STUDENT`, `SECRETARY`, `ADMIN`

Auth middleware source: `src/middleware/auth.js` (`authenticateToken`) and `src/middleware/authorize.js` (`authorize()`).

Legend:
- **(public)** — no auth middleware at all
- **any auth** — `authenticateToken` present, no `authorize()` call
- Role list — `authorize('ROLE1', 'ROLE2')` present in route definition
- **see controller** — role check happens inside the controller at runtime, not via middleware

---

## auth

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | /api/auth/login | (public) | Authenticate and receive JWT |
| POST | /api/auth/logout | any auth | Invalidate session / clear token |
| POST | /api/auth/sync-htshadow | ADMIN | Sync users from HTshadow external source |

---

## bookings

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | /api/bookings | any auth | Create a single room booking |
| POST | /api/bookings/series | any auth | Create a recurring booking series (RRULE) |
| PATCH | /api/bookings/series/:id | any auth | Edit all events in a series |
| DELETE | /api/bookings/series/:id | any auth | Cancel an entire series |
| POST | /api/bookings/series/:id/overrides | any auth | Edit a single occurrence in a series |
| POST | /api/bookings/series/:id/exclude | any auth | Skip/exclude a single series occurrence |
| POST | /api/bookings/series/:id/decision | any auth | Approve or reject a series (or single occurrence) |
| POST | /api/bookings/weekly | LAB_TECH, LAB_HEAD, ADMIN | Create a full week of student-usage bookings |
| GET | /api/bookings/active-queues | any auth | Get live Student-Usage occupancy queues |
| GET | /api/bookings | any auth | List room bookings |
| PATCH | /api/bookings/:id | any auth | Update booking details (time, room, purpose) |
| PATCH | /api/bookings/:id/status | any auth | Update booking status |
| PATCH | /api/bookings/:id/occupancy-status | LAB_TECH, LAB_HEAD, ADMIN | Set queue occupancy (OPEN/NEAR_FULL/FULL) |
| GET | /api/bookings/available | any auth | Get available rooms for a time period |
| DELETE | /api/bookings/:id | any auth | Delete a booking |

Note: routes without `authorize()` are gated only by `authenticateToken`; the controller may apply ownership checks at runtime (see controller for runtime check).

---

## borrowing

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/borrowing | any auth | List borrowing requests |
| POST | /api/borrowing | any auth | Submit a borrow request |
| POST | /api/borrowing/walkin | LAB_TECH, LAB_HEAD, ADMIN | Walk-in: create a BORROWED record directly |
| PATCH | /api/borrowing/:id/approve | LAB_TECH, LAB_HEAD, ADMIN | Approve a borrow request |
| PATCH | /api/borrowing/:id/reject | LAB_TECH, LAB_HEAD, ADMIN | Reject a borrow request |
| PATCH | /api/borrowing/:id/return | any auth | Mark item as returned |
| GET | /api/borrowing/pending/count | LAB_TECH, LAB_HEAD, ADMIN | Get count of pending requests |

---

## computers

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/computers | any auth | List all computers |
| POST | /api/computers/import-csv | ADMIN, LAB_HEAD, LAB_TECH | Bulk import computers from CSV/XLSX |
| POST | /api/computers | ADMIN, LAB_HEAD, LAB_TECH | Create a computer record |
| PUT | /api/computers/:id | ADMIN, LAB_HEAD, LAB_TECH | Update a computer record |
| DELETE | /api/computers/:id | LAB_HEAD, LAB_TECH | Delete a computer record |

---

## dashboard

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/dashboard | any auth | Get aggregated dashboard metrics |

---

## forms

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/forms | ADMIN, LAB_HEAD, LAB_TECH | List forms |
| GET | /api/forms/:id | ADMIN, LAB_HEAD, LAB_TECH | Get form by ID |
| POST | /api/forms | ADMIN, LAB_HEAD, LAB_TECH | Create a form |
| PATCH | /api/forms/:id | ADMIN, LAB_HEAD, LAB_TECH | Update a form |
| PATCH | /api/forms/:id/archive | ADMIN, LAB_HEAD, LAB_TECH | Archive a form |
| PATCH | /api/forms/:id/unarchive | ADMIN, LAB_HEAD, LAB_TECH | Unarchive a form |
| PATCH | /api/forms/:id/received | ADMIN, LAB_HEAD, LAB_TECH | Mark form as received |
| POST | /api/forms/:id/transfer | ADMIN, LAB_HEAD, LAB_TECH | Transfer form to another owner |
| POST | /api/forms/:id/attachments | ADMIN, LAB_HEAD, LAB_TECH | Add attachments to a form |
| DELETE | /api/forms/:id/attachments/:attachmentId | ADMIN, LAB_HEAD, LAB_TECH | Remove an attachment |
| DELETE | /api/forms/:id | ADMIN, LAB_HEAD | Delete a form |

---

## heartbeat

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | /api/heartbeat/register | any auth | Register a computer via MAC address |
| POST | /api/heartbeat | any auth | Send a heartbeat signal |
| GET | /api/heartbeat/status | LAB_TECH, LAB_HEAD, ADMIN | Get computer status summary |
| GET | /api/heartbeat/computer/:id | LAB_TECH, LAB_HEAD, ADMIN | Get detailed computer session history |
| DELETE | /api/heartbeat/session/:sessionId | any auth | End a heartbeat session |

---

## inventory

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/inventory | (public) | List all inventory items |
| GET | /api/inventory/available | (public) | List available items by type (computer assembly) |
| GET | /api/inventory/code/:itemCode | LAB_HEAD, LAB_TECH | Get item by item code |
| GET | /api/inventory/:id | (public) | Get item by ID |
| POST | /api/inventory | ADMIN, LAB_HEAD, LAB_TECH | Create an inventory item |
| PUT | /api/inventory/:id | ADMIN, LAB_HEAD, LAB_TECH | Update an inventory item |
| DELETE | /api/inventory/:id | ADMIN, LAB_HEAD | Soft-delete an inventory item |
| POST | /api/inventory/bulk | ADMIN, LAB_HEAD, LAB_TECH | Bulk create inventory items |
| POST | /api/inventory/import-csv | ADMIN, LAB_HEAD, LAB_TECH | Import items from CSV/XLSX |
| POST | /api/inventory/:id/check | ADMIN, LAB_HEAD, LAB_TECH | Mark item as audited (present) for current semester |
| DELETE | /api/inventory/:id/check | ADMIN, LAB_HEAD, LAB_TECH | Unmark item audit check |

---

## maintenance

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/maintenance/cleanup-preview | ADMIN | Preview what a cleanup run would delete |
| GET | /api/maintenance/school-year-archive-preview | ADMIN | Preview school-year archive scope |
| GET | /api/maintenance/archives | ADMIN | List available archive files |
| GET | /api/maintenance/archives/:fileName | ADMIN | Download a specific archive file |
| GET | /api/maintenance/history | ADMIN | List maintenance run history |
| POST | /api/maintenance/cleanup | ADMIN | Execute data cleanup |
| POST | /api/maintenance/school-year-archive-cleanup | ADMIN | Execute school-year archive + cleanup |

---

## notifications

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/notifications | any auth | Get own notifications |
| GET | /api/notifications/unread-count | any auth | Get unread notification count |
| PATCH | /api/notifications/:id/read | any auth | Mark notification as read |
| PATCH | /api/notifications/:id/unread | any auth | Mark notification as unread |
| POST | /api/notifications/mark-all-read | any auth | Mark all notifications as read |
| PATCH | /api/notifications/read-all | any auth | Mark all notifications as read (alias) |
| PATCH | /api/notifications/:id/archive | any auth | Archive a notification |
| PATCH | /api/notifications/:id/restore | any auth | Restore an archived notification |
| GET | /api/notifications/:id | any auth | Get notification by ID |

---

## reports

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | /api/reports | LAB_TECH | Create a new weekly report |
| GET | /api/reports | LAB_TECH, LAB_HEAD | List reports (role-filtered) |
| GET | /api/reports/auto-populate | LAB_TECH | Auto-populate report data from tickets |
| GET | /api/reports/summary | LAB_TECH, LAB_HEAD, ADMIN | Dashboard report summary |
| GET | /api/reports/summary.csv | LAB_TECH, LAB_HEAD, ADMIN | Export dashboard summary as CSV |
| GET | /api/reports/inventory.csv | LAB_TECH, LAB_HEAD, ADMIN | Export inventory report as CSV |
| GET | /api/reports/rooms.csv | LAB_TECH, LAB_HEAD, ADMIN | Export rooms report as CSV |
| GET | /api/reports/weekly.csv | LAB_TECH, LAB_HEAD, ADMIN | Export weekly reports as CSV |
| GET | /api/reports/:id | LAB_TECH, LAB_HEAD | Get a single report |
| PUT | /api/reports/:id | LAB_TECH | Update own draft report |
| PATCH | /api/reports/:id/submit | LAB_TECH | Submit a draft report |
| PATCH | /api/reports/:id/review | LAB_HEAD | Approve or reject a submitted report |
| DELETE | /api/reports/:id | LAB_TECH | Delete own draft report |

---

## rooms

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/rooms/public/opened-labs | (public) | Public: list currently opened labs |
| GET | /api/rooms/public/lecture-rooms | (public) | Public: list lecture rooms |
| GET | /api/rooms/public/:roomId/schedule-7day | (public) | Public: 7-day schedule for a room |
| GET | /api/rooms/public | (public) | Public: list all rooms |
| GET | /api/rooms | (public) | List all rooms (no auth required) |
| GET | /api/rooms/opened-labs | STUDENT, LAB_HEAD, LAB_TECH, ADMIN | Get opened labs (authenticated view) |
| GET | /api/rooms/:id/audit-status | LAB_HEAD, LAB_TECH, ADMIN | Get room audit status |
| GET | /api/rooms/:id | (public) | Get room by ID |
| POST | /api/rooms | ADMIN, LAB_HEAD | Create a room |
| PUT | /api/rooms/:id | ADMIN, LAB_HEAD | Update a room |
| DELETE | /api/rooms/:id | ADMIN | Delete a room |
| POST | /api/rooms/:id/student-availability | LAB_HEAD, LAB_TECH, ADMIN | Set student availability for a room |

---

## schedules

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | /api/schedules/import-offered-courses/preview | ADMIN | Dry-run preview of offered-course schedule import |
| POST | /api/schedules/import-offered-courses | ADMIN | Import offered-course schedules from XLSX |

---

## semesters

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/semesters | any auth | List all semesters |
| GET | /api/semesters/active | any auth | Get the currently active semester |
| POST | /api/semesters | ADMIN, LAB_HEAD | Create a new semester |
| PATCH | /api/semesters/:id/activate | ADMIN, LAB_HEAD | Activate a semester |

---

## tickets

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | /api/tickets/public | (public, rate-limited 10/15 min per IP) | Anonymous IT issue report submission |
| POST | /api/tickets | any auth | Create a ticket (authenticated) |
| GET | /api/tickets/count | ADMIN, LAB_HEAD, LAB_TECH | Get ticket count by status |
| GET | /api/tickets | ADMIN, LAB_HEAD, LAB_TECH | List all tickets |
| PUT | /api/tickets/:id | ADMIN, LAB_HEAD, LAB_TECH | Update ticket (status, priority, category) |
| GET | /api/tickets/:id | any auth | Get a single ticket by ID |

---

## upload

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | /api/upload/files/:filename | (public) | Serve an uploaded file (inline or download via `?download=1`) |
| POST | /api/upload | any auth | Upload a single file (multipart/form-data, 10 MB limit) |
