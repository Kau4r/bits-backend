const prisma = require('../../lib/prisma');
const NotificationManager = require('../../services/notificationManager');
const AuditLogger = require('../../utils/auditLogger');
const { findScheduleConflict, formatScheduleTime } = require('../../utils/scheduleConflict');
const { expandRrule } = require('../../utils/rruleExpander');

const SECRETARY_ALLOWED_ROOM_TYPES = new Set(['CONSULTATION', 'CONFERENCE']);
const BOOKING_NOTIFICATION_ROLES = ['SECRETARY', 'LAB_HEAD', 'LAB_TECH'];
const SERIES_HARD_CAP = 366; // never expand more than 366 instances per series

const normalizeRole = (role = '') => String(role).toUpperCase();

const toIsoNoMs = (d) => new Date(d).toISOString();

// ---- Read helpers (used by getBookings) ----

// Expand all active series whose rule produces occurrences in [from, to].
// Layers per-instance overrides on top: if a Booked_Room row exists with
// (Series_ID, Original_Start) matching an occurrence, the override row wins
// and the virtual occurrence is dropped.
const buildVirtualOccurrences = async ({ from, to, where = {} } = {}) => {
  const fromDate = from ? new Date(from) : new Date();
  const toDate = to ? new Date(to) : new Date(fromDate.getTime() + 90 * 24 * 60 * 60 * 1000);

  const seriesWhere = {};
  if (where.User_ID) seriesWhere.User_ID = where.User_ID;
  if (where.Room_ID) seriesWhere.Room_ID = where.Room_ID;

  const series = await prisma.Booking_Series.findMany({
    where: seriesWhere,
    include: {
      Room: true,
      User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } }
    }
  });

  if (series.length === 0) return [];

  const seriesIds = series.map(s => s.Series_ID);
  const overrideRows = await prisma.Booked_Room.findMany({
    where: {
      Series_ID: { in: seriesIds },
      Original_Start: { not: null }
    },
    select: { Series_ID: true, Original_Start: true }
  });

  const overrideKeys = new Set(
    overrideRows.map(r => `${r.Series_ID}|${new Date(r.Original_Start).toISOString()}`)
  );

  const virtual = [];
  for (const s of series) {
    const durationMs = new Date(s.Anchor_End).getTime() - new Date(s.Anchor_Start).getTime();
    const occurrences = expandRrule(s.Recurrence_Rule, s.Anchor_Start, {
      windowStart: fromDate,
      windowEnd: toDate,
      excludedDates: s.Excluded_Dates,
      hardCap: SERIES_HARD_CAP
    });

    for (const start of occurrences) {
      const key = `${s.Series_ID}|${start.toISOString()}`;
      if (overrideKeys.has(key)) continue; // overridden — the persisted row will appear via the regular query

      const end = new Date(start.getTime() + durationMs);
      virtual.push({
        Booked_Room_ID: -s.Series_ID * 10_000_000 - Math.floor(start.getTime() / 60000), // negative + deterministic per instance
        Room_ID: s.Room_ID,
        User_ID: s.User_ID,
        Start_Time: start,
        End_Time: end,
        Status: s.Status,
        Created_At: s.Created_At,
        Updated_At: s.Updated_At,
        Purpose: s.Purpose,
        Schedule_ID: null,
        Approved_By: null,
        Notes: s.Notes,
        Queue_Status: 'OPEN',
        Series_ID: s.Series_ID,
        Original_Start: start,
        Is_Virtual: true,           // flags this row as expanded-from-rule, not a real DB row
        Series_Title: s.Title,
        Room: s.Room,
        User: s.User,
        Approver: null
      });
    }
  }

  return virtual;
};

// ---- Create a series ----

const createBookingSeries = async (req, res) => {
  const {
    User_ID,
    Room_ID,
    Title,
    Purpose,
    Notes,
    Recurrence_Rule,
    Anchor_Start,
    Anchor_End,
    Excluded_Dates = []
  } = req.body;

  const userId = parseInt(User_ID, 10);
  const roomId = parseInt(Room_ID, 10);
  const anchorStart = new Date(Anchor_Start);
  const anchorEnd = new Date(Anchor_End);

  if (Number.isNaN(anchorStart.getTime()) || Number.isNaN(anchorEnd.getTime()) || anchorEnd <= anchorStart) {
    return res.status(400).json({ success: false, error: 'Anchor_Start must be a valid date and Anchor_End must come after it' });
  }

  if (anchorStart.getTime() <= Date.now()) {
    return res.status(400).json({
      success: false,
      error: 'Series cannot start in the past',
      details: 'The first occurrence must be a future time.'
    });
  }

  const room = await prisma.Room.findUnique({
    where: { Room_ID: roomId },
    include: { Schedule: { where: { IsActive: true } } }
  });
  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
  if (room.Is_Bookable === false) {
    return res.status(403).json({
      success: false,
      error: 'This room is not available for booking',
      details: `${room.Name} has been marked as non-bookable.`
    });
  }
  if (room.Status !== 'AVAILABLE') {
    return res.status(403).json({
      success: false,
      error: 'Room is not available for booking',
      details: `Room status is currently ${room.Status}`
    });
  }

  const requestingUser = await prisma.user.findUnique({
    where: { User_ID: userId },
    select: { User_Role: true, First_Name: true, Last_Name: true }
  });
  if (!requestingUser) return res.status(404).json({ success: false, error: 'User not found' });

  const role = normalizeRole(requestingUser.User_Role);
  const requiresSecretaryReview = SECRETARY_ALLOWED_ROOM_TYPES.has(room.Room_Type);

  // Approval semantics for the whole series mirror single-booking semantics:
  //   secretary on CONF/CONS → APPROVED
  //   lab_head on lab/lecture → APPROVED
  //   everyone else → PENDING (one approval applies to every occurrence)
  const isAutoApproved =
    (role === 'SECRETARY' && requiresSecretaryReview) ||
    (role === 'LAB_HEAD' && !requiresSecretaryReview);
  const seriesStatus = isAutoApproved ? 'APPROVED' : 'PENDING';

  // Expand the rule to validate every occurrence against existing schedules
  // and approved bookings BEFORE persisting the series. All-or-nothing.
  const durationMs = anchorEnd.getTime() - anchorStart.getTime();
  const occurrences = expandRrule(Recurrence_Rule, anchorStart, {
    excludedDates: Excluded_Dates,
    hardCap: SERIES_HARD_CAP
  });

  if (occurrences.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Recurrence rule produced no occurrences',
      details: 'Adjust the rule, end date, or excluded dates and try again.'
    });
  }

  if (occurrences.length > SERIES_HARD_CAP) {
    return res.status(400).json({
      success: false,
      error: `Series is too long (>${SERIES_HARD_CAP} occurrences)`,
      details: 'Set an end date or shorten the recurrence so the series stays under one year of dates.'
    });
  }

  // Walk every occurrence and surface conflicts.
  const conflicts = [];
  for (const start of occurrences) {
    const end = new Date(start.getTime() + durationMs);

    const conflictingSchedule = findScheduleConflict(room.Schedule, start, end);
    if (conflictingSchedule) {
      conflicts.push({
        when: start.toISOString(),
        reason: `Conflicts with ${conflictingSchedule.Title} from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
      });
      continue;
    }

    const overlap = await prisma.Booked_Room.findFirst({
      where: {
        Room_ID: roomId,
        Status: { in: ['APPROVED', 'PENDING'] },
        Start_Time: { lt: end },
        End_Time: { gt: start }
      },
      include: { User: { select: { First_Name: true, Last_Name: true } } }
    });
    if (overlap) {
      const bookedBy = overlap.User
        ? `${overlap.User.First_Name} ${overlap.User.Last_Name}`
        : 'someone else';
      conflicts.push({
        when: start.toISOString(),
        reason: `Conflicts with existing ${overlap.Status.toLowerCase()} booking by ${bookedBy}`,
        conflictingBookingId: overlap.Booked_Room_ID
      });
    }
  }

  if (conflicts.length > 0) {
    return res.status(409).json({
      success: false,
      error: 'Recurring series has conflicts',
      details: `${conflicts.length} of ${occurrences.length} occurrence(s) clash with existing bookings or class schedules. Resolve them and try again.`,
      conflicts: conflicts.slice(0, 50),
      totalConflicts: conflicts.length,
      totalOccurrences: occurrences.length
    });
  }

  const series = await prisma.Booking_Series.create({
    data: {
      Room_ID: roomId,
      User_ID: userId,
      Title: Title || (Purpose || 'Recurring booking'),
      Purpose: Purpose || null,
      Notes: Notes || null,
      Recurrence_Rule,
      Anchor_Start: anchorStart,
      Anchor_End: anchorEnd,
      Excluded_Dates: Excluded_Dates.map(d => typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)),
      Status: seriesStatus
    },
    include: {
      Room: true,
      User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } }
    }
  });

  try {
    await AuditLogger.logBooking(
      userId,
      seriesStatus === 'APPROVED' ? 'BOOKING_APPROVED' : 'ROOM_BOOKED',
      0,
      seriesStatus === 'APPROVED'
        ? `Recurring series for ${series.Room.Name} auto-approved (${occurrences.length} occurrences)`
        : `Recurring series request for ${series.Room.Name} by ${requestingUser.First_Name} ${requestingUser.Last_Name} (${occurrences.length} occurrences)`,
      ['SECRETARY', 'LAB_HEAD']
    );
  } catch (err) {
    console.error('[BookingSeries] AuditLogger.logBooking failed:', err);
  }

  try {
    await NotificationManager.broadcastBookingEvent(
      seriesStatus === 'APPROVED' ? 'BOOKING_APPROVED' : 'BOOKING_CREATED',
      {
        Booked_Room_ID: -series.Series_ID,
        Series_ID: series.Series_ID,
        Room_ID: series.Room_ID,
        Room: series.Room,
        Status: series.Status,
        Start_Time: series.Anchor_Start,
        End_Time: series.Anchor_End,
        Purpose: series.Purpose
      },
      BOOKING_NOTIFICATION_ROLES
    );
  } catch (err) {
    console.error('[BookingSeries] broadcastBookingEvent failed:', err);
  }

  res.status(201).json({
    success: true,
    data: {
      ...series,
      Anchor_Start: toIsoNoMs(series.Anchor_Start),
      Anchor_End: toIsoNoMs(series.Anchor_End),
      occurrenceCount: occurrences.length
    }
  });
};

// ---- Delete an entire series (and its overrides via FK cascade) ----

const deleteBookingSeries = async (req, res) => {
  const seriesId = parseInt(req.params.id, 10);
  if (Number.isNaN(seriesId)) {
    return res.status(400).json({ success: false, error: 'Invalid series id' });
  }

  const series = await prisma.Booking_Series.findUnique({
    where: { Series_ID: seriesId },
    include: { Room: true }
  });
  if (!series) return res.status(404).json({ success: false, error: 'Series not found' });

  const isOwner = series.User_ID === req.user?.User_ID;
  if (!isOwner) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      details: 'You can only delete recurring series you own.'
    });
  }

  // Cascade is handled at FK level — this also drops overrides.
  await prisma.Booking_Series.delete({ where: { Series_ID: seriesId } });

  try {
    await AuditLogger.logBooking(
      req.user.User_ID,
      'BOOKING_CANCELLED',
      0,
      `Recurring series for ${series.Room.Name} cancelled.`,
      null,
      series.User_ID
    );
  } catch (err) {
    console.error('[BookingSeries] AuditLogger.logBooking failed in delete:', err);
  }

  try {
    await NotificationManager.broadcastBookingEvent('BOOKING_CANCELLED', {
      Booked_Room_ID: -series.Series_ID,
      Series_ID: series.Series_ID,
      Room_ID: series.Room_ID,
      Room: series.Room,
      Status: 'CANCELLED'
    }, BOOKING_NOTIFICATION_ROLES);
  } catch (err) {
    console.error('[BookingSeries] broadcastBookingEvent failed in delete:', err);
  }

  res.json({ success: true, data: { message: 'Series cancelled' } });
};

// ---- Update an entire series (Title/Purpose/Notes/Anchor times/Room) ----
//
// Anchor or Room changes shift every virtual occurrence, so we re-validate
// the whole series against schedules + other bookings (same pipeline as
// createBookingSeries). Existing per-instance overrides whose Original_Start
// no longer maps to a generated occurrence are stale; the user explicitly
// chose "all events", so we wipe overrides on structural changes. Pure
// metadata edits (Title/Purpose/Notes) leave overrides alone, BUT the
// override row's matching field is updated too so the rendered name stays
// in sync with the series.

const updateBookingSeries = async (req, res) => {
  const seriesId = parseInt(req.params.id, 10);
  if (Number.isNaN(seriesId)) {
    return res.status(400).json({ success: false, error: 'Invalid series id' });
  }

  const series = await prisma.Booking_Series.findUnique({
    where: { Series_ID: seriesId },
    include: { Room: true }
  });
  if (!series) return res.status(404).json({ success: false, error: 'Series not found' });
  if (series.User_ID !== req.user?.User_ID) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      details: 'You can only edit recurring series you own.'
    });
  }

  const {
    Title,
    Purpose,
    Notes,
    Room_ID,
    Anchor_Start,
    Anchor_End,
    Excluded_Dates
  } = req.body;

  const newRoomId = Room_ID ? parseInt(Room_ID, 10) : series.Room_ID;
  const newAnchorStart = Anchor_Start ? new Date(Anchor_Start) : new Date(series.Anchor_Start);
  const newAnchorEnd = Anchor_End ? new Date(Anchor_End) : new Date(series.Anchor_End);

  if (Number.isNaN(newAnchorStart.getTime()) || Number.isNaN(newAnchorEnd.getTime()) || newAnchorEnd <= newAnchorStart) {
    return res.status(400).json({
      success: false,
      error: 'Anchor_End must be after Anchor_Start'
    });
  }

  const roomChanged = newRoomId !== series.Room_ID;
  const anchorStartChanged = newAnchorStart.getTime() !== new Date(series.Anchor_Start).getTime();
  const anchorEndChanged = newAnchorEnd.getTime() !== new Date(series.Anchor_End).getTime();
  const structuralChange = roomChanged || anchorStartChanged || anchorEndChanged;

  // Re-validate every generated occurrence whenever a structural field shifts.
  let occurrenceCount = 0;
  if (structuralChange) {
    const room = await prisma.Room.findUnique({
      where: { Room_ID: newRoomId },
      include: { Schedule: { where: { IsActive: true } } }
    });
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.Is_Bookable === false) {
      return res.status(403).json({
        success: false,
        error: 'This room is not available for booking',
        details: `${room.Name} has been marked as non-bookable.`
      });
    }
    if (room.Status !== 'AVAILABLE') {
      return res.status(403).json({
        success: false,
        error: 'Room is not available for booking',
        details: `Room status is currently ${room.Status}`
      });
    }

    const occurrences = expandRrule(series.Recurrence_Rule, newAnchorStart, {
      excludedDates: Excluded_Dates ?? series.Excluded_Dates,
      hardCap: SERIES_HARD_CAP
    });
    occurrenceCount = occurrences.length;

    if (occurrenceCount === 0) {
      return res.status(400).json({
        success: false,
        error: 'Updated rule produced no occurrences'
      });
    }
    if (occurrenceCount > SERIES_HARD_CAP) {
      return res.status(400).json({
        success: false,
        error: `Series too long (>${SERIES_HARD_CAP} occurrences)`
      });
    }

    const durationMs = newAnchorEnd.getTime() - newAnchorStart.getTime();
    const conflicts = [];
    for (const start of occurrences) {
      const end = new Date(start.getTime() + durationMs);

      const conflictingSchedule = findScheduleConflict(room.Schedule, start, end);
      if (conflictingSchedule) {
        conflicts.push({
          when: start.toISOString(),
          reason: `Conflicts with ${conflictingSchedule.Title} from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
        });
        continue;
      }

      // Skip overlap rows that belong to this same series — we're about to
      // wipe overrides anyway, and virtual occurrences from the same rule
      // shouldn't conflict with themselves.
      const overlap = await prisma.Booked_Room.findFirst({
        where: {
          Room_ID: newRoomId,
          Status: { in: ['APPROVED', 'PENDING'] },
          Start_Time: { lt: end },
          End_Time: { gt: start },
          NOT: { Series_ID: seriesId }
        },
        include: { User: { select: { First_Name: true, Last_Name: true } } }
      });
      if (overlap) {
        const bookedBy = overlap.User
          ? `${overlap.User.First_Name} ${overlap.User.Last_Name}`
          : 'someone else';
        conflicts.push({
          when: start.toISOString(),
          reason: `Conflicts with existing ${overlap.Status.toLowerCase()} booking by ${bookedBy}`,
          conflictingBookingId: overlap.Booked_Room_ID
        });
      }
    }

    if (conflicts.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Updated series has conflicts',
        details: `${conflicts.length} of ${occurrences.length} occurrence(s) clash with existing bookings or class schedules.`,
        conflicts: conflicts.slice(0, 50),
        totalConflicts: conflicts.length,
        totalOccurrences: occurrences.length
      });
    }
  }

  const updateData = {
    Updated_At: new Date()
  };
  if (Title !== undefined) updateData.Title = Title;
  if (Purpose !== undefined) updateData.Purpose = Purpose;
  if (Notes !== undefined) updateData.Notes = Notes;
  if (roomChanged) updateData.Room_ID = newRoomId;
  if (anchorStartChanged) updateData.Anchor_Start = newAnchorStart;
  if (anchorEndChanged) updateData.Anchor_End = newAnchorEnd;
  if (Excluded_Dates) {
    updateData.Excluded_Dates = Excluded_Dates.map(d =>
      typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)
    );
  }

  const transactionOps = [
    prisma.Booking_Series.update({
      where: { Series_ID: seriesId },
      data: updateData,
      include: {
        Room: true,
        User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } }
      }
    })
  ];

  if (structuralChange) {
    // Wipe overrides — their Original_Start no longer corresponds to a real
    // generated occurrence after the rule shifted.
    transactionOps.push(
      prisma.Booked_Room.deleteMany({
        where: { Series_ID: seriesId, Original_Start: { not: null } }
      })
    );
  } else {
    // Metadata-only change — sync the matching fields on overrides so the UI
    // shows consistent text. Overrides keep their own time/room.
    const overrideUpdates = {};
    if (Title !== undefined || Purpose !== undefined) overrideUpdates.Purpose = Purpose !== undefined ? Purpose : (Title !== undefined ? Title : undefined);
    if (Notes !== undefined) overrideUpdates.Notes = Notes;
    if (Object.keys(overrideUpdates).length > 0) {
      transactionOps.push(
        prisma.Booked_Room.updateMany({
          where: { Series_ID: seriesId, Original_Start: { not: null } },
          data: { ...overrideUpdates, Updated_At: new Date() }
        })
      );
    }
  }

  const [updatedSeries] = await prisma.$transaction(transactionOps);

  try {
    await NotificationManager.broadcastBookingEvent('BOOKING_UPDATED', {
      Booked_Room_ID: -seriesId,
      Series_ID: seriesId,
      Room_ID: updatedSeries.Room_ID,
      Room: updatedSeries.Room,
      Status: updatedSeries.Status,
      Start_Time: updatedSeries.Anchor_Start,
      End_Time: updatedSeries.Anchor_End,
      Purpose: updatedSeries.Purpose
    }, BOOKING_NOTIFICATION_ROLES);
  } catch (err) {
    console.error('[BookingSeries] broadcast failed in updateBookingSeries:', err);
  }

  res.json({
    success: true,
    data: {
      ...updatedSeries,
      structuralChange,
      overridesWiped: structuralChange
    }
  });
};

// ---- Override (edit a single occurrence of a series) ----

const upsertSeriesOverride = async (req, res) => {
  const seriesId = parseInt(req.params.id, 10);
  if (Number.isNaN(seriesId)) {
    return res.status(400).json({ success: false, error: 'Invalid series id' });
  }

  const series = await prisma.Booking_Series.findUnique({
    where: { Series_ID: seriesId },
    include: { Room: true }
  });
  if (!series) return res.status(404).json({ success: false, error: 'Series not found' });

  const isOwner = series.User_ID === req.user?.User_ID;
  if (!isOwner) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      details: 'You can only edit occurrences of series you own.'
    });
  }

  const {
    Original_Start,
    Start_Time,
    End_Time,
    Room_ID,
    Purpose,
    Notes,
    Status
  } = req.body;

  const originalStart = new Date(Original_Start);
  if (Number.isNaN(originalStart.getTime())) {
    return res.status(400).json({ success: false, error: 'Original_Start is required and must be a valid datetime' });
  }

  const newRoomId = Room_ID ? parseInt(Room_ID, 10) : series.Room_ID;
  const newStart = Start_Time ? new Date(Start_Time) : null;
  const newEnd = End_Time ? new Date(End_Time) : null;

  if (newStart && newEnd && newEnd <= newStart) {
    return res.status(400).json({ success: false, error: 'End_Time must be after Start_Time' });
  }

  // If only one of Start/End was supplied, fill from anchor duration. We need
  // both populated to validate against schedules + bookings.
  const durationMs = new Date(series.Anchor_End).getTime() - new Date(series.Anchor_Start).getTime();
  const effectiveStart = newStart ?? originalStart;
  const effectiveEnd = newEnd ?? new Date(effectiveStart.getTime() + durationMs);

  // Conflict checks against the new room/time, ignoring this override row.
  const room = await prisma.Room.findUnique({
    where: { Room_ID: newRoomId },
    include: { Schedule: { where: { IsActive: true } } }
  });
  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

  const conflictingSchedule = findScheduleConflict(room.Schedule, effectiveStart, effectiveEnd);
  if (conflictingSchedule) {
    return res.status(409).json({
      success: false,
      error: 'Time conflict with existing class schedule',
      details: `Conflicts with ${conflictingSchedule.Title} from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
    });
  }

  // Locate existing override for this occurrence (if any) so we can update vs create.
  const existing = await prisma.Booked_Room.findFirst({
    where: {
      Series_ID: seriesId,
      Original_Start: originalStart
    }
  });

  const overlap = await prisma.Booked_Room.findFirst({
    where: {
      Room_ID: newRoomId,
      Status: { in: ['APPROVED', 'PENDING'] },
      Start_Time: { lt: effectiveEnd },
      End_Time: { gt: effectiveStart },
      ...(existing ? { Booked_Room_ID: { not: existing.Booked_Room_ID } } : {})
    },
    include: { User: { select: { First_Name: true, Last_Name: true } } }
  });
  if (overlap) {
    return res.status(409).json({
      success: false,
      error: 'Room is already booked for the selected time',
      conflictingBooking: {
        id: overlap.Booked_Room_ID,
        status: overlap.Status,
        startTime: overlap.Start_Time,
        endTime: overlap.End_Time,
        bookedBy: overlap.User
          ? `${overlap.User.First_Name} ${overlap.User.Last_Name}`
          : 'Unknown'
      }
    });
  }

  const data = {
    Room_ID: newRoomId,
    User_ID: series.User_ID,
    Start_Time: effectiveStart,
    End_Time: effectiveEnd,
    Status: Status || series.Status,
    Purpose: Purpose !== undefined ? Purpose : series.Purpose,
    Notes: Notes !== undefined ? Notes : series.Notes,
    Series_ID: seriesId,
    Original_Start: originalStart,
    Updated_At: new Date()
  };

  const booking = existing
    ? await prisma.Booked_Room.update({
        where: { Booked_Room_ID: existing.Booked_Room_ID },
        data,
        include: {
          Room: true,
          User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } }
        }
      })
    : await prisma.Booked_Room.create({
        data: { ...data, Created_At: new Date() },
        include: {
          Room: true,
          User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } }
        }
      });

  try {
    await NotificationManager.broadcastBookingEvent(
      existing ? 'BOOKING_UPDATED' : 'BOOKING_CREATED',
      booking,
      BOOKING_NOTIFICATION_ROLES
    );
  } catch (err) {
    console.error('[BookingSeries] broadcast failed in upsertSeriesOverride:', err);
  }

  res.json({ success: true, data: booking });
};

// ---- Approve / reject a recurring series (whole-series or single-occurrence) ----
//
// applyToSeries=true is the "agree to all" flow: the series's own Status is
// flipped, AND every generated occurrence is re-validated. Any occurrence
// that now conflicts with a class schedule or another approved booking is
// auto-rejected as a per-instance override with the reason recorded in Notes.
// The caller's `notes` (optional) is prepended to that auto-reason.
//
// applyToSeries=false approves/rejects only the occurrence identified by
// `Original_Start`, materializing a single override row.

const decideSeriesStatus = async (req, res) => {
  const seriesId = parseInt(req.params.id, 10);
  if (Number.isNaN(seriesId)) {
    return res.status(400).json({ success: false, error: 'Invalid series id' });
  }

  const { status, notes, applyToSeries, Original_Start } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status must be APPROVED or REJECTED' });
  }

  const series = await prisma.Booking_Series.findUnique({
    where: { Series_ID: seriesId },
    include: {
      Room: { include: { Schedule: { where: { IsActive: true } } } },
      User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } }
    }
  });
  if (!series) return res.status(404).json({ success: false, error: 'Series not found' });

  // Permission: same as updateBookingStatus — secretary handles CONF/CONS,
  // lab head/lab tech handle the rest. Owner cannot self-approve here; they
  // can only cancel via deleteBookingSeries.
  const approverRole = normalizeRole(req.user?.User_Role);
  const requiresSecretaryReview = SECRETARY_ALLOWED_ROOM_TYPES.has(series.Room.Room_Type);
  if (requiresSecretaryReview && approverRole !== 'SECRETARY') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      details: 'Only the secretary can approve or reject conference/consultation series.'
    });
  }
  if (!requiresSecretaryReview && approverRole !== 'LAB_HEAD' && approverRole !== 'LAB_TECH') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      details: 'Only lab head or lab tech can approve or reject lab/lecture series.'
    });
  }

  const durationMs = new Date(series.Anchor_End).getTime() - new Date(series.Anchor_Start).getTime();
  const userNotePrefix = (notes || '').trim();

  // ---- Single-occurrence path ----
  if (!applyToSeries) {
    if (!Original_Start) {
      return res.status(400).json({ success: false, error: 'Original_Start is required for single-occurrence decisions' });
    }
    const occ = new Date(Original_Start);
    if (Number.isNaN(occ.getTime())) {
      return res.status(400).json({ success: false, error: 'Original_Start must be a valid datetime' });
    }
    const occEnd = new Date(occ.getTime() + durationMs);

    const existing = await prisma.Booked_Room.findFirst({
      where: { Series_ID: seriesId, Original_Start: occ }
    });

    const overrideData = {
      Room_ID: series.Room_ID,
      User_ID: series.User_ID,
      Start_Time: occ,
      End_Time: occEnd,
      Status: status,
      Approved_By: req.user.User_ID,
      Notes: userNotePrefix || (existing?.Notes ?? null),
      Purpose: series.Purpose,
      Series_ID: seriesId,
      Original_Start: occ,
      Updated_At: new Date()
    };

    const override = existing
      ? await prisma.Booked_Room.update({
          where: { Booked_Room_ID: existing.Booked_Room_ID },
          data: overrideData,
          include: { Room: true, User: true }
        })
      : await prisma.Booked_Room.create({
          data: { ...overrideData, Created_At: new Date() },
          include: { Room: true, User: true }
        });

    try {
      await NotificationManager.broadcastBookingEvent(
        status === 'APPROVED' ? 'BOOKING_APPROVED' : 'BOOKING_REJECTED',
        override,
        BOOKING_NOTIFICATION_ROLES
      );
    } catch (err) {
      console.error('[BookingSeries] broadcast failed in decideSeriesStatus(single):', err);
    }

    return res.json({
      success: true,
      data: { occurrence: override, approved: status === 'APPROVED' ? 1 : 0, rejected: status === 'APPROVED' ? 0 : 1 }
    });
  }

  // ---- Whole-series path ----
  if (status === 'REJECTED') {
    const updated = await prisma.Booking_Series.update({
      where: { Series_ID: seriesId },
      data: { Status: 'REJECTED', Updated_At: new Date() }
    });
    try {
      await NotificationManager.broadcastBookingEvent('BOOKING_REJECTED', {
        Booked_Room_ID: -seriesId,
        Series_ID: seriesId,
        Room_ID: series.Room_ID,
        Room: series.Room,
        Status: 'REJECTED',
        Start_Time: series.Anchor_Start,
        End_Time: series.Anchor_End,
        Notes: userNotePrefix || null
      }, BOOKING_NOTIFICATION_ROLES);
    } catch (err) {
      console.error('[BookingSeries] broadcast failed in decideSeriesStatus(reject all):', err);
    }
    return res.json({
      success: true,
      data: { series: updated, approved: 0, rejected: 'all', conflicts: [] }
    });
  }

  // APPROVED whole series — re-validate every occurrence, auto-reject the
  // ones that now collide with another approved booking or class schedule.
  const occurrences = expandRrule(series.Recurrence_Rule, series.Anchor_Start, {
    excludedDates: series.Excluded_Dates,
    hardCap: SERIES_HARD_CAP
  });

  const rejected = [];
  for (const start of occurrences) {
    const end = new Date(start.getTime() + durationMs);
    let reason = null;

    const conflictingSchedule = findScheduleConflict(series.Room.Schedule, start, end);
    if (conflictingSchedule) {
      reason = `Conflicts with class schedule "${conflictingSchedule.Title}" (${formatScheduleTime(conflictingSchedule.Start_Time)}–${formatScheduleTime(conflictingSchedule.End_Time)})`;
    } else {
      const overlap = await prisma.Booked_Room.findFirst({
        where: {
          Room_ID: series.Room_ID,
          Status: 'APPROVED',
          Start_Time: { lt: end },
          End_Time: { gt: start },
          NOT: { Series_ID: seriesId }
        },
        include: { User: { select: { First_Name: true, Last_Name: true } } }
      });
      if (overlap) {
        const bookedBy = overlap.User
          ? `${overlap.User.First_Name} ${overlap.User.Last_Name}`
          : 'someone else';
        reason = `Conflicts with existing approved booking by ${bookedBy}`;
      }
    }

    if (!reason) continue;

    const noteText = userNotePrefix
      ? `${userNotePrefix}\n${reason}`
      : reason;

    const existing = await prisma.Booked_Room.findFirst({
      where: { Series_ID: seriesId, Original_Start: start }
    });
    const data = {
      Room_ID: series.Room_ID,
      User_ID: series.User_ID,
      Start_Time: start,
      End_Time: end,
      Status: 'REJECTED',
      Approved_By: req.user.User_ID,
      Notes: noteText,
      Purpose: series.Purpose,
      Series_ID: seriesId,
      Original_Start: start,
      Updated_At: new Date()
    };
    if (existing) {
      await prisma.Booked_Room.update({ where: { Booked_Room_ID: existing.Booked_Room_ID }, data });
    } else {
      await prisma.Booked_Room.create({ data: { ...data, Created_At: new Date() } });
    }
    rejected.push({ when: start.toISOString(), reason });
  }

  const updated = await prisma.Booking_Series.update({
    where: { Series_ID: seriesId },
    data: { Status: 'APPROVED', Updated_At: new Date() }
  });

  try {
    await NotificationManager.broadcastBookingEvent('BOOKING_APPROVED', {
      Booked_Room_ID: -seriesId,
      Series_ID: seriesId,
      Room_ID: series.Room_ID,
      Room: series.Room,
      Status: 'APPROVED',
      Start_Time: series.Anchor_Start,
      End_Time: series.Anchor_End,
      Notes: userNotePrefix || null
    }, BOOKING_NOTIFICATION_ROLES);
  } catch (err) {
    console.error('[BookingSeries] broadcast failed in decideSeriesStatus(approve all):', err);
  }

  res.json({
    success: true,
    data: {
      series: updated,
      approved: occurrences.length - rejected.length,
      rejected: rejected.length,
      totalOccurrences: occurrences.length,
      conflicts: rejected
    }
  });
};

// ---- Exclude a specific occurrence (single-instance delete) ----

const excludeSeriesDate = async (req, res) => {
  const seriesId = parseInt(req.params.id, 10);
  if (Number.isNaN(seriesId)) {
    return res.status(400).json({ success: false, error: 'Invalid series id' });
  }

  const series = await prisma.Booking_Series.findUnique({
    where: { Series_ID: seriesId },
    include: { Room: true }
  });
  if (!series) return res.status(404).json({ success: false, error: 'Series not found' });

  if (series.User_ID !== req.user?.User_ID) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      details: 'You can only modify series you own.'
    });
  }

  const { Original_Start } = req.body;
  const occ = new Date(Original_Start);
  if (Number.isNaN(occ.getTime())) {
    return res.status(400).json({ success: false, error: 'Original_Start is required and must be a valid datetime' });
  }
  const ymd = `${occ.getFullYear()}-${String(occ.getMonth() + 1).padStart(2, '0')}-${String(occ.getDate()).padStart(2, '0')}`;

  // Drop any existing override for this slot — exclusion supersedes it.
  await prisma.Booked_Room.deleteMany({
    where: { Series_ID: seriesId, Original_Start: occ }
  });

  const updated = await prisma.Booking_Series.update({
    where: { Series_ID: seriesId },
    data: {
      Excluded_Dates: series.Excluded_Dates.includes(ymd)
        ? series.Excluded_Dates
        : [...series.Excluded_Dates, ymd].sort()
    }
  });

  try {
    await NotificationManager.broadcastBookingEvent('BOOKING_CANCELLED', {
      Booked_Room_ID: -seriesId,
      Series_ID: seriesId,
      Room_ID: series.Room_ID,
      Room: series.Room,
      Start_Time: occ,
      Status: 'CANCELLED'
    }, BOOKING_NOTIFICATION_ROLES);
  } catch (err) {
    console.error('[BookingSeries] broadcast failed in excludeSeriesDate:', err);
  }

  res.json({ success: true, data: { excludedDates: updated.Excluded_Dates } });
};

module.exports = {
  buildVirtualOccurrences,
  createBookingSeries,
  updateBookingSeries,
  deleteBookingSeries,
  upsertSeriesOverride,
  excludeSeriesDate,
  decideSeriesStatus
};
