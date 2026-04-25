const prisma = require('../../lib/prisma');
const NotificationService = require('../../services/notificationService');
const NotificationManager = require('../../services/notificationManager');
const AuditLogger = require('../../utils/auditLogger');
const { findScheduleConflict, formatScheduleTime } = require('../../utils/scheduleConflict');

const normalizeRole = (role = '') => String(role).toUpperCase();
const BOOKING_MANAGER_ROLES = ['ADMIN', 'SECRETARY', 'LAB_HEAD', 'LAB_TECH'];
const BOOKING_NOTIFICATION_ROLES = ['SECRETARY', 'LAB_HEAD', 'LAB_TECH'];

const isSecretaryBooking = (user) => normalizeRole(user?.User_Role) === 'SECRETARY';
const SECRETARY_ALLOWED_ROOM_TYPES = new Set(['CONSULTATION', 'CONFERENCE']);

const formatBookingTime = (date) => (
    new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
);

const notifyRejectedBooking = async (actorId, rejectedBooking, reason) => {
    const message = `Your booking for ${rejectedBooking.Room.Name} was rejected. Reason: ${reason}`;

    await AuditLogger.logBooking(
        actorId,
        'BOOKING_REJECTED',
        rejectedBooking.Booked_Room_ID,
        message,
        null,
        rejectedBooking.User_ID
    );

    NotificationManager.send(rejectedBooking.User_ID, {
        type: 'BOOKING_REJECTED',
        category: 'BOOKING_UPDATE',
        timestamp: new Date().toISOString(),
        message,
        booking: {
            id: rejectedBooking.Booked_Room_ID,
            roomId: rejectedBooking.Room_ID,
            status: rejectedBooking.Status,
            startTime: rejectedBooking.Start_Time,
            endTime: rejectedBooking.End_Time
        }
    });
};

// Create a new room booking
const createBooking = async (req, res) => {
    try {
        const { User_ID, Room_ID, Start_Time, End_Time, Purpose } = req.body;

        if (!User_ID || !Room_ID || !Start_Time || !End_Time) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const requestedStart = new Date(Start_Time);
        const requestedEnd = new Date(End_Time);

        // Block bookings whose start time is already in the past.
        if (Number.isNaN(requestedStart.getTime()) || requestedStart.getTime() <= Date.now()) {
            return res.status(400).json({
                success: false,
                error: 'Bookings cannot start in the past',
                details: 'Please pick a start time that is later than the current time.'
            });
        }

        // Block bookings on Sundays
        if (requestedStart.getDay() === 0) {
            return res.status(400).json({
                error: 'Bookings are not allowed on Sundays',
                details: 'Please select a different day of the week.'
            });
        }

        // Get room with active recurring schedules
        const room = await prisma.room.findUnique({
            where: { Room_ID: parseInt(Room_ID) },
            include: {
                Schedule: {
                    where: { IsActive: true }
                }
            }
        });

        if (!room) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Reject rooms that an admin has flagged as non-bookable
        // (e.g. storage, control room, dept office, faculty office, green room).
        if (room.Is_Bookable === false) {
            return res.status(403).json({
                success: false,
                error: 'This room is not available for booking',
                details: `${room.Name} has been marked as non-bookable by an administrator.`
            });
        }

        const requestingUser = await prisma.user.findUnique({
            where: { User_ID: parseInt(User_ID) },
            select: { User_Role: true }
        });

        if (!requestingUser) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const secretaryPriority = isSecretaryBooking(requestingUser);

        if (secretaryPriority && !SECRETARY_ALLOWED_ROOM_TYPES.has(room.Room_Type)) {
            return res.status(403).json({
                success: false,
                error: 'Secretary bookings are limited to consultation and conference rooms'
            });
        }

        // Check if room is available for booking
        if (room.Status !== 'AVAILABLE') {
            return res.status(403).json({
                success: false, error: 'Room is not available for booking',
                details: `Room status is currently ${room.Status}`
            });
        }

        // Check for any recurring class schedule conflicts
        const conflictingSchedule = findScheduleConflict(room.Schedule, requestedStart, requestedEnd);
        if (conflictingSchedule) {
            return res.status(409).json({
                success: false, error: 'Time conflict with existing schedule',
                details: `The requested time conflicts with ${conflictingSchedule.Title} from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
            });
        }

        const conflictingApprovedBooking = await prisma.Booked_Room.findFirst({
            where: {
                Room_ID: parseInt(Room_ID),
                Status: 'APPROVED',
                Start_Time: { lt: requestedEnd },
                End_Time: { gt: requestedStart }
            },
            include: {
                User: { select: { First_Name: true, Last_Name: true } }
            }
        });

        if (conflictingApprovedBooking) {
            return res.status(409).json({
                success: false,
                error: 'Room is already booked for the selected time',
                conflictingBooking: {
                    id: conflictingApprovedBooking.Booked_Room_ID,
                    status: conflictingApprovedBooking.Status,
                    startTime: conflictingApprovedBooking.Start_Time,
                    endTime: conflictingApprovedBooking.End_Time,
                    bookedBy: conflictingApprovedBooking.User
                        ? `${conflictingApprovedBooking.User.First_Name} ${conflictingApprovedBooking.User.Last_Name}`
                        : 'Unknown'
                }
            });
        }

        const conflictingPendingBookings = secretaryPriority
            ? await prisma.Booked_Room.findMany({
                where: {
                    Room_ID: parseInt(Room_ID),
                    Status: 'PENDING',
                    Start_Time: { lt: requestedEnd },
                    End_Time: { gt: requestedStart }
                },
                include: {
                    Room: true,
                    User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } },
                    Approver: {
                        select: {
                            User_ID: true,
                            First_Name: true,
                            Last_Name: true,
                            User_Role: true
                        }
                    }
                }
            })
            : [];

        if (!secretaryPriority) {
            const conflictingPendingBooking = await prisma.Booked_Room.findFirst({
                where: {
                    Room_ID: parseInt(Room_ID),
                    Status: 'PENDING',
                    Start_Time: { lt: requestedEnd },
                    End_Time: { gt: requestedStart }
                },
                include: {
                    User: { select: { First_Name: true, Last_Name: true } }
                }
            });

            if (conflictingPendingBooking) {
                return res.status(409).json({
                    success: false,
                    error: 'A pending booking already exists for this time slot',
                    conflictingBooking: {
                        id: conflictingPendingBooking.Booked_Room_ID,
                        status: conflictingPendingBooking.Status,
                        startTime: conflictingPendingBooking.Start_Time,
                        endTime: conflictingPendingBooking.End_Time,
                        bookedBy: conflictingPendingBooking.User
                            ? `${conflictingPendingBooking.User.First_Name} ${conflictingPendingBooking.User.Last_Name}`
                            : 'Unknown'
                    }
                });
            }
        }

        const isLabHead = normalizeRole(requestingUser.User_Role) === 'LAB_HEAD';
        const isAutoApproved = secretaryPriority || isLabHead;
        const bookingData = {
            User_ID: parseInt(User_ID),
            Room_ID: parseInt(Room_ID),
            Start_Time: requestedStart,
            End_Time: requestedEnd,
            Status: isAutoApproved ? 'APPROVED' : 'PENDING',
            Approved_By: isAutoApproved ? parseInt(User_ID) : null,
            Purpose: Purpose || '',
            Created_At: new Date()
        };
        const bookingInclude = {
            Room: true,
            User: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            },
            Approver: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    User_Role: true
                }
            }
        };

        let booking;
        let rejectedBookings = [];

        if (secretaryPriority && conflictingPendingBookings.length > 0) {
            const rejectReason = `Secretary booking takes priority from ${formatBookingTime(requestedStart)} to ${formatBookingTime(requestedEnd)}.`;
            const transactionResult = await prisma.$transaction(async (tx) => {
                const rejected = await Promise.all(conflictingPendingBookings.map((pendingBooking) =>
                    tx.Booked_Room.update({
                        where: { Booked_Room_ID: pendingBooking.Booked_Room_ID },
                        data: {
                            Status: 'REJECTED',
                            Notes: pendingBooking.Notes
                                ? `${pendingBooking.Notes}\n${rejectReason}`
                                : rejectReason,
                            Updated_At: new Date()
                        },
                        include: {
                            Room: true,
                            User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } },
                            Approver: {
                                select: {
                                    User_ID: true,
                                    First_Name: true,
                                    Last_Name: true,
                                    User_Role: true
                                }
                            }
                        }
                    })
                ));

                const created = await tx.Booked_Room.create({
                    data: bookingData,
                    include: bookingInclude
                });

                return { booking: created, rejectedBookings: rejected };
            });

            booking = transactionResult.booking;
            rejectedBookings = transactionResult.rejectedBookings;

            for (const rejectedBooking of rejectedBookings) {
                await notifyRejectedBooking(parseInt(User_ID), rejectedBooking, rejectReason);
            }

            await NotificationManager.broadcastBookingEvent('BOOKING_REJECTED', rejectedBookings[0], BOOKING_NOTIFICATION_ROLES);
        } else {
            // Create the booking with PENDING status unless the request is auto-approved.
            booking = await prisma.Booked_Room.create({
                data: bookingData,
                include: bookingInclude
            });
        }

        // Log and notify Lab Heads about the new booking request
        console.log('[Bookings] About to call AuditLogger.logBooking...');
        try {
            await AuditLogger.logBooking(
                parseInt(User_ID),
                secretaryPriority ? 'BOOKING_APPROVED' : 'ROOM_BOOKED',
                booking.Booked_Room_ID,
                secretaryPriority
                    ? `Secretary booking for ${booking.Room.Name} was auto-approved`
                    : `New booking request for ${booking.Room.Name} by ${booking.User.First_Name} ${booking.User.Last_Name}`,
                ['SECRETARY', 'LAB_HEAD'] // Notify booking managers
            );
            console.log('[Bookings] AuditLogger.logBooking completed successfully');
        } catch (auditError) {
            console.error('[Bookings] AuditLogger.logBooking FAILED:', auditError);
        }

        // Broadcast real-time UI update to booking managers
        await NotificationManager.broadcastBookingEvent(
            secretaryPriority ? 'BOOKING_APPROVED' : 'BOOKING_CREATED',
            booking,
            BOOKING_NOTIFICATION_ROLES
        );

        res.status(201).json({
            success: true,
            data: booking,
            meta: { rejectedBookings: rejectedBookings.length }
        });

    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({ success: false, error: 'Failed to create booking' });
    }
};

// Get all room bookings
const getBookings = async (req, res) => {
    try {
        const { status, roomId, userId, from, to } = req.query;

        const where = {};
        // Support comma-separated statuses (e.g., "PENDING,APPROVED")
        if (status) {
            const statuses = status.split(',').map(s => s.trim());
            where.Status = statuses.length > 1 ? { in: statuses } : statuses[0];
        }
        if (roomId) where.Room_ID = parseInt(roomId);
        if (userId) where.User_ID = parseInt(userId);

        // Support date-range filtering on Start_Time: ?from=ISO&to=ISO
        if (from || to) {
            where.Start_Time = {};
            if (from) where.Start_Time.gte = new Date(from);
            if (to) where.Start_Time.lt = new Date(to);
        }

        const bookings = await prisma.Booked_Room.findMany({
            where,
            include: {
                Room: true,
                User: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                Approver: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        User_Role: true
                    }
                }
            },
            orderBy: {
                Start_Time: 'desc'
            }
        });

        res.json({ success: true, data: bookings });
    } catch (error) {
        console.error('Error fetching room bookings:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch room bookings' });
    }
};

// Update room booking details (time, room, purpose)
const updateBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { Start_Time, End_Time, Room_ID, Purpose, Notes } = req.body;
        const requesterRole = normalizeRole(req.user?.User_Role);

        // Get the existing booking
        const existingBooking = await prisma.Booked_Room.findUnique({
            where: { Booked_Room_ID: parseInt(id) },
            include: { User: true, Room: true }
        });

        if (!existingBooking) {
            return res.status(404).json({ success: false, error: 'Booking not found' });
        }

        const isOwner = existingBooking.User_ID === req.user?.User_ID;
        const canEditAnyBooking = requesterRole === 'ADMIN' || requesterRole === 'LAB_HEAD';
        if (!isOwner && !canEditAnyBooking) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden',
                details: 'You can only edit your own bookings unless you are a Lab Head or Admin.'
            });
        }

        // Build update data
        const updateData = {
            Updated_At: new Date(),
        };

        if (Start_Time) updateData.Start_Time = new Date(Start_Time);
        if (End_Time) updateData.End_Time = new Date(End_Time);
        if (Room_ID) updateData.Room_ID = parseInt(Room_ID);
        if (Purpose !== undefined) updateData.Purpose = Purpose;
        if (Notes !== undefined) updateData.Notes = Notes;

        // Check for conflicts if time or room is being changed
        const newStart = updateData.Start_Time || existingBooking.Start_Time;
        const newEnd = updateData.End_Time || existingBooking.End_Time;
        const newRoom = updateData.Room_ID || existingBooking.Room_ID;

        const targetRoom = newRoom === existingBooking.Room_ID
            ? existingBooking.Room
            : await prisma.Room.findUnique({
                where: { Room_ID: newRoom },
                select: { Room_ID: true, Room_Type: true }
            });

        if (!targetRoom) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        if (requesterRole === 'SECRETARY' && !SECRETARY_ALLOWED_ROOM_TYPES.has(targetRoom.Room_Type)) {
            return res.status(403).json({
                success: false,
                error: 'Secretary bookings are limited to consultation and conference rooms'
            });
        }

        const activeSchedules = await prisma.Schedule.findMany({
            where: { Room_ID: newRoom, IsActive: true }
        });
        const conflictingSchedule = findScheduleConflict(activeSchedules, newStart, newEnd);
        if (conflictingSchedule) {
            return res.status(409).json({
                success: false,
                error: 'Time conflict with existing schedule',
                details: `The requested time conflicts with ${conflictingSchedule.Title} from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
            });
        }

        const conflictingBooking = await prisma.Booked_Room.findFirst({
            where: {
                Room_ID: newRoom,
                Booked_Room_ID: { not: parseInt(id) },
                Status: { in: ['APPROVED', 'PENDING'] },
                Start_Time: { lt: newEnd },
                End_Time: { gt: newStart }
            },
            include: {
                User: { select: { First_Name: true, Last_Name: true } }
            }
        });

        if (conflictingBooking) {
            const statusMsg = conflictingBooking.Status === 'PENDING'
                ? 'A pending booking already exists for this time slot'
                : 'Room is already booked for the selected time';
            return res.status(409).json({
                success: false, error: statusMsg,
                conflictingBooking: {
                    id: conflictingBooking.Booked_Room_ID,
                    status: conflictingBooking.Status,
                    startTime: conflictingBooking.Start_Time,
                    endTime: conflictingBooking.End_Time,
                    bookedBy: conflictingBooking.User
                        ? `${conflictingBooking.User.First_Name} ${conflictingBooking.User.Last_Name}`
                        : 'Unknown'
                }
            });
        }

        // Update the booking
        const booking = await prisma.Booked_Room.update({
            where: { Booked_Room_ID: parseInt(id) },
            data: updateData,
            include: {
                Room: true,
                User: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                Approver: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        User_Role: true
                    }
                }
            }
        });

        res.json({ success: true, data: booking });
    } catch (error) {
        console.error('Error updating booking:', error);
        res.status(500).json({ success: false, error: 'Failed to update booking' });
    }
};

// Update room booking status
const updateBookingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, approverId, notes } = req.body;

        if (!status || !['APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }

        // Get the approver's user information
        const approver = await prisma.user.findUnique({
            where: { User_ID: parseInt(approverId) },
            select: { User_Role: true }
        });

        if (!approver) {
            return res.status(404).json({ success: false, error: 'Approver not found' });
        }

        // Check if user has permission to change booking status
        const isStaff = BOOKING_MANAGER_ROLES.includes(approver.User_Role);

        // Get the booking to check ownership and current status
        const existingBooking = await prisma.Booked_Room.findUnique({
            where: { Booked_Room_ID: parseInt(id) },
            include: { User: true }
        });

        if (!existingBooking) {
            return res.status(404).json({ success: false, error: 'Booking not found' });
        }

        // Permission logic:
        // - STAFF (SECRETARY, LAB_TECH, LAB_HEAD, ADMIN) can approve/reject/cancel any booking
        // - FACULTY can only CANCEL their OWN bookings
        const isOwner = existingBooking.User_ID === parseInt(approverId);
        const isFacultyCancellingOwn = approver.User_Role === 'FACULTY' && status === 'CANCELLED' && isOwner;

        if (!isStaff && !isFacultyCancellingOwn) {
            return res.status(403).json({
                success: false, error: 'Forbidden',
                details: 'Only SECRETARY, LAB_TECH, LAB_HEAD, or ADMIN can approve/reject bookings. Faculty can only cancel their own bookings.'
            });
        }

        // Only allow status changes for PENDING bookings, unless it's an ADMIN or owner cancelling
        if (existingBooking.Status !== 'PENDING' && approver.User_Role !== 'ADMIN' && !isFacultyCancellingOwn) {
            return res.status(400).json({
                error: 'Bad Request',
                details: 'Only PENDING bookings can be updated',
                currentStatus: existingBooking.Status
            });
        }

        const updateData = {
            Status: status,
            Updated_At: new Date(),
            ...(status === 'APPROVED' && { Approved_By: parseInt(approverId) }),
            ...(notes && { Notes: notes })
        };

        if (status === 'APPROVED') {
            const activeSchedules = await prisma.Schedule.findMany({
                where: { Room_ID: existingBooking.Room_ID, IsActive: true }
            });
            const conflictingSchedule = findScheduleConflict(activeSchedules, existingBooking.Start_Time, existingBooking.End_Time);
            if (conflictingSchedule) {
                return res.status(409).json({
                    success: false,
                    error: 'Time conflict with existing schedule',
                    details: `This booking conflicts with ${conflictingSchedule.Title} from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
                });
            }
        }

        const booking = await prisma.Booked_Room.update({
            where: { Booked_Room_ID: parseInt(id) },
            data: updateData,
            include: {
                Room: true,
                User: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                Approver: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        User_Role: true
                    }
                }
            }
        });

        // Notify the requester about approval/rejection/cancellation
        let notificationType = null;
        let message = '';

        if (status === 'APPROVED') {
            notificationType = 'BOOKING_APPROVED';
            message = `Your booking for ${booking.Room.Name} has been approved!`;
        } else if (status === 'REJECTED') {
            notificationType = 'BOOKING_REJECTED';
            message = `Your booking for ${booking.Room.Name} was rejected.${notes ? ` Reason: ${notes}` : ''}`;
        } else if (status === 'CANCELLED') {
            notificationType = 'BOOKING_CANCELLED';
            message = `Booking for ${booking.Room.Name} has been cancelled.`;
        }

        if (notificationType) {
            // Log to audit trail
            await AuditLogger.logBooking(
                parseInt(approverId),
                notificationType,
                booking.Booked_Room_ID,
                message,
                null, // No role to notify
                existingBooking.User_ID // Notify the requester (or actor for cancellation)
            );

            // Broadcast real-time UI update to all relevant users
            // For approvals/rejections, notify both the requester AND staff
            // For cancellations, notify staff
            if (status === 'CANCELLED') {
                await NotificationManager.broadcastBookingEvent('BOOKING_CANCELLED', booking, BOOKING_NOTIFICATION_ROLES);
            } else {
                // Approved or Rejected - notify the faculty who made the booking
                NotificationManager.send(existingBooking.User_ID, {
                    type: notificationType,
                    category: 'BOOKING_UPDATE',
                    timestamp: new Date().toISOString(),
                    booking: {
                        id: booking.Booked_Room_ID,
                        roomId: booking.Room_ID,
                        status: booking.Status,
                        startTime: booking.Start_Time,
                        endTime: booking.End_Time
                    }
                });

                // ALSO broadcast to booking managers so their calendars update too
                await NotificationManager.broadcastBookingEvent(notificationType, booking, BOOKING_NOTIFICATION_ROLES);
            }
        }

        res.json({ success: true, data: booking });
    } catch (error) {
        console.error('Error updating room booking status:', error);
        res.status(500).json({ success: false, error: 'Failed to update room booking status' });
    }
};

// Get available rooms for a time period
const getAvailableRooms = async (req, res) => {
    try {
        const { startTime, endTime, capacity } = req.query;

        if (!startTime || !endTime) {
            return res.status(400).json({ success: false, error: 'Start time and end time are required' });
        }

        // Find all rooms that have no conflicting approved bookings
        const roomsWithoutBookingConflicts = await prisma.$queryRaw`
            SELECT r.*
            FROM "Room" r
            WHERE r."Capacity" >= COALESCE(${parseInt(capacity) || 1}, 1)
            AND r."Room_ID" NOT IN (
                SELECT br."Room_ID"
                FROM "Booked_Room" br
                WHERE br."Status" = 'APPROVED'
                AND (
                    (br."Start_Time" < ${new Date(endTime)} AND br."End_Time" > ${new Date(startTime)})
                )
            )
            ORDER BY r."Capacity" ASC
        `;

        if (roomsWithoutBookingConflicts.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const schedules = await prisma.Schedule.findMany({
            where: {
                IsActive: true,
                Room_ID: { in: roomsWithoutBookingConflicts.map(room => room.Room_ID) }
            }
        });
        const schedulesByRoom = schedules.reduce((acc, schedule) => {
            if (!acc.has(schedule.Room_ID)) acc.set(schedule.Room_ID, []);
            acc.get(schedule.Room_ID).push(schedule);
            return acc;
        }, new Map());
        const availableRooms = roomsWithoutBookingConflicts.filter(room =>
            !findScheduleConflict(schedulesByRoom.get(room.Room_ID) || [], startTime, endTime)
        );

        res.json({ success: true, data: availableRooms });
    } catch (error) {
        console.error('Error finding available rooms:', error);
        res.status(500).json({ success: false, error: 'Failed to find available rooms' });
    }
};

// Delete a booking
const deleteBooking = async (req, res) => {
    try {
        const { id } = req.params;

        // Get the booking to check ownership
        const existingBooking = await prisma.Booked_Room.findUnique({
            where: { Booked_Room_ID: parseInt(id) },
            include: { Room: true, User: true }
        });

        if (!existingBooking) {
            return res.status(404).json({ success: false, error: 'Booking not found' });
        }

        // Only allow staff or the owner of the booking to delete it
        const isOwner = existingBooking.User_ID === req.user.User_ID;
        const isStaff = BOOKING_MANAGER_ROLES.includes(req.user.User_Role);

        if (!isOwner && !isStaff) {
            return res.status(403).json({
                success: false, error: 'Forbidden',
                details: 'You can only delete your own bookings.'
            });
        }

        await prisma.Booked_Room.delete({
            where: { Booked_Room_ID: parseInt(id) }
        });

        // Log to audit trail
        await AuditLogger.logBooking(
            req.user.User_ID,
            'BOOKING_CANCELLED',
            existingBooking.Booked_Room_ID,
            `Booking for ${existingBooking.Room.Name} was deleted.`,
            null,
            existingBooking.User_ID
        );

        // Notify UI to refresh schedules
        await NotificationManager.broadcastBookingEvent('BOOKING_CANCELLED', existingBooking, BOOKING_NOTIFICATION_ROLES);

        res.json({ success: true, data: { message: 'Booking deleted successfully' } });
    } catch (error) {
        console.error('Error deleting booking:', error);
        res.status(500).json({ success: false, error: 'Failed to delete booking' });
    }
};

// Create multiple bookings for a full week in a single atomic transaction
// All-or-nothing: if ANY slot conflicts, no bookings are created.
const createBookingsWeekly = async (req, res) => {
    try {
        const { roomId, purpose, slots } = req.body;

        const parsedRoomId = parseInt(roomId);

        const room = await prisma.room.findUnique({
            where: { Room_ID: parsedRoomId },
            include: {
                Schedule: { where: { IsActive: true } }
            }
        });

        if (!room) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        if (room.Status !== 'AVAILABLE') {
            return res.status(403).json({
                success: false,
                error: 'Room is not available for booking',
                details: `Room status is currently ${room.Status}`
            });
        }

        // Normalize slot dates and reject any pair that spans Sunday or is invalid
        const normalizedSlots = slots.map((s, idx) => ({
            idx,
            start: new Date(s.startTime),
            end: new Date(s.endTime)
        }));

        for (const slot of normalizedSlots) {
            if (slot.start.getDay() === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Bookings are not allowed on Sundays',
                    conflictingSlots: [{ index: slot.idx, reason: 'Sunday not allowed' }]
                });
            }
        }

        // Detect internal overlaps within the submitted slots
        const sortedSlots = [...normalizedSlots].sort((a, b) => a.start - b.start);
        for (let i = 1; i < sortedSlots.length; i++) {
            if (sortedSlots[i].start < sortedSlots[i - 1].end) {
                return res.status(400).json({
                    success: false,
                    error: 'Submitted slots overlap each other',
                    conflictingSlots: [
                        { index: sortedSlots[i - 1].idx },
                        { index: sortedSlots[i].idx }
                    ]
                });
            }
        }

        const conflictingSlots = [];

        for (const slot of normalizedSlots) {
            const conflictingSchedule = findScheduleConflict(room.Schedule, slot.start, slot.end);
            if (conflictingSchedule) {
                conflictingSlots.push({
                    index: slot.idx,
                    startTime: slot.start.toISOString(),
                    endTime: slot.end.toISOString(),
                    reason: `Conflicts with ${conflictingSchedule.Title || 'class'} from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
                });
                continue;
            }

            const conflictingBooking = await prisma.Booked_Room.findFirst({
                where: {
                    Room_ID: parsedRoomId,
                    Status: { in: ['APPROVED', 'PENDING'] },
                    Start_Time: { lt: slot.end },
                    End_Time: { gt: slot.start }
                },
                include: {
                    User: { select: { First_Name: true, Last_Name: true } }
                }
            });

            if (conflictingBooking) {
                conflictingSlots.push({
                    index: slot.idx,
                    startTime: slot.start.toISOString(),
                    endTime: slot.end.toISOString(),
                    reason: `Conflicts with existing ${conflictingBooking.Status.toLowerCase()} booking`,
                    conflictingBookingId: conflictingBooking.Booked_Room_ID
                });
            }
        }

        if (conflictingSlots.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'One or more slots conflict with existing schedules or bookings',
                conflictingSlots
            });
        }

        // All slots are conflict-free. Create them atomically.
        const now = new Date();
        const created = await prisma.$transaction(
            normalizedSlots.map(slot => prisma.Booked_Room.create({
                data: {
                    User_ID: req.user.User_ID,
                    Room_ID: parsedRoomId,
                    Start_Time: slot.start,
                    End_Time: slot.end,
                    Status: 'APPROVED',
                    Purpose: purpose || 'Student Usage',
                    Notes: 'Weekly student usage schedule set by Lab Tech',
                    Approved_By: req.user.User_ID,
                    Created_At: now,
                    Updated_At: now
                },
                include: { Room: true }
            }))
        );

        const createdIds = created.map(b => b.Booked_Room_ID);

        // Audit log each booking
        for (const booking of created) {
            try {
                await AuditLogger.logBooking(
                    req.user.User_ID,
                    'BOOKING_APPROVED',
                    booking.Booked_Room_ID,
                    `Weekly student usage booking for ${booking.Room.Name} auto-approved`,
                    null,
                    req.user.User_ID
                );
            } catch (auditError) {
                console.error('[Bookings/Weekly] AuditLogger failed:', auditError);
            }
        }

        // Broadcast a single event per booking so UIs refresh
        for (const booking of created) {
            await NotificationManager.broadcastBookingEvent(
                'BOOKING_APPROVED',
                booking,
                BOOKING_NOTIFICATION_ROLES
            );
        }

        // Include the full Queue_Status (default OPEN) on every created booking
        // so the frontend can render the weekly grid without a follow-up fetch.
        const createdBookings = created.map(b => ({
            Booked_Room_ID: b.Booked_Room_ID,
            Room_ID: b.Room_ID,
            Start_Time: b.Start_Time,
            End_Time: b.End_Time,
            Status: b.Status,
            Purpose: b.Purpose,
            Queue_Status: b.Queue_Status || 'OPEN'
        }));

        res.status(201).json({
            success: true,
            data: { createdIds, createdBookings }
        });
    } catch (error) {
        console.error('Weekly booking error:', error);
        res.status(500).json({ success: false, error: 'Failed to create weekly bookings' });
    }
};

// Update the queue occupancy status on a Booked_Room (OPEN / NEAR_FULL / FULL).
// Only meaningful for active Student-Usage sessions. Lab techs and lab heads
// can toggle this freely regardless of who originally queued the room.
const updateOccupancyStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const bookingId = parseInt(id);
    if (Number.isNaN(bookingId)) {
        return res.status(400).json({ success: false, error: 'Invalid booking id' });
    }

    const existing = await prisma.Booked_Room.findUnique({
        where: { Booked_Room_ID: bookingId },
        include: { Room: true }
    });

    if (!existing) {
        return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    if (existing.Purpose !== 'Student Usage') {
        return res.status(400).json({
            success: false,
            error: 'Queue status is only applicable to Student Usage bookings'
        });
    }

    const updated = await prisma.Booked_Room.update({
        where: { Booked_Room_ID: bookingId },
        data: {
            Queue_Status: status,
            Updated_At: new Date()
        },
        include: {
            Room: true,
            User: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    Email: true
                }
            }
        }
    });

    try {
        await AuditLogger.logBooking(
            req.user.User_ID,
            'BOOKING_UPDATED',
            bookingId,
            `Queue status → ${status}`,
            null,
            null
        );
    } catch (auditError) {
        console.error('[Bookings/OccupancyStatus] AuditLogger failed:', auditError);
    }

    // Broadcast so other labtech UIs and the public student landing refresh.
    try {
        await NotificationManager.broadcastBookingEvent('BOOKING_UPDATED', updated, BOOKING_NOTIFICATION_ROLES);
    } catch (broadcastError) {
        console.error('[Bookings/OccupancyStatus] Broadcast failed:', broadcastError);
    }

    res.json({ success: true, data: updated });
};

// Normalize Queue_Status: when the session has ended, return OPEN so stale
// "FULL" flags don't leak into summaries. This is computed per-row at read time.
const effectiveQueueStatus = (booking) => {
    if (!booking) return 'OPEN';
    const now = new Date();
    const endTime = booking.End_Time ? new Date(booking.End_Time) : null;
    if (endTime && endTime <= now) return 'OPEN';
    return booking.Queue_Status || 'OPEN';
};

// Return all APPROVED Student-Usage sessions that are live RIGHT NOW.
// Used by the lab-tech Active Queue Dashboard. No role filter — any
// authenticated user (esp. labtechs) can see all labs for overflow context.
const getActiveQueues = async (req, res) => {
    const now = new Date();

    const bookings = await prisma.Booked_Room.findMany({
        where: {
            Status: 'APPROVED',
            Purpose: 'Student Usage',
            Start_Time: { lte: now },
            End_Time: { gt: now }
        },
        include: {
            Room: {
                select: {
                    Room_ID: true,
                    Name: true,
                    Lab_Type: true,
                    Capacity: true,
                    Room_Type: true
                }
            },
            User: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true
                }
            }
        },
        orderBy: { Start_Time: 'asc' }
    });

    // Effective status for active sessions is always the stored status —
    // End_Time has already been filtered > now. Kept explicit for clarity.
    const data = bookings.map(b => ({
        ...b,
        Queue_Status: effectiveQueueStatus(b)
    }));

    res.json({ success: true, data });
};

module.exports = {
    createBooking,
    createBookingsWeekly,
    getBookings,
    updateBooking,
    updateBookingStatus,
    getAvailableRooms,
    deleteBooking,
    updateOccupancyStatus,
    getActiveQueues
};
