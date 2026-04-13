const prisma = require('../../lib/prisma');
const NotificationService = require('../../services/notificationService');
const NotificationManager = require('../../services/notificationManager');
const AuditLogger = require('../../utils/auditLogger');
const { findScheduleConflict, formatScheduleTime } = require('../../utils/scheduleConflict');

// Create a new room booking
const createBooking = async (req, res) => {
    try {
        const { User_ID, Room_ID, Start_Time, End_Time, Purpose } = req.body;

        if (!User_ID || !Room_ID || !Start_Time || !End_Time) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Block bookings on Sundays
        if (new Date(Start_Time).getDay() === 0) {
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

        // Check if room is available for booking
        if (room.Status !== 'AVAILABLE') {
            return res.status(403).json({
                success: false, error: 'Room is not available for booking',
                details: `Room status is currently ${room.Status}`
            });
        }

        // Check for any recurring class schedule conflicts
        const conflictingSchedule = findScheduleConflict(room.Schedule, Start_Time, End_Time);
        if (conflictingSchedule) {
            return res.status(409).json({
                success: false, error: 'Time conflict with existing schedule',
                details: `The requested time conflicts with ${conflictingSchedule.Title} from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
            });
        }

        // Check for conflicting bookings (both APPROVED and PENDING)
        const conflictingBooking = await prisma.Booked_Room.findFirst({
            where: {
                Room_ID: parseInt(Room_ID),
                Status: { in: ['APPROVED', 'PENDING'] },
                Start_Time: { lt: new Date(End_Time) },
                End_Time: { gt: new Date(Start_Time) }
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

        // Create the booking with PENDING status
        const booking = await prisma.Booked_Room.create({
            data: {
                User_ID: parseInt(User_ID),
                Room_ID: parseInt(Room_ID),
                Start_Time: new Date(Start_Time),
                End_Time: new Date(End_Time),
                Status: 'PENDING',
                Purpose: Purpose || '',
                Created_At: new Date()
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
                },
                Approver: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        User_Role: true
                    }
                }
            }
        });

        // Log and notify Lab Heads about the new booking request
        console.log('[Bookings] About to call AuditLogger.logBooking...');
        try {
            await AuditLogger.logBooking(
                parseInt(User_ID),
                'ROOM_BOOKED',
                booking.Booked_Room_ID,
                `New booking request for ${booking.Room.Name} by ${booking.User.First_Name} ${booking.User.Last_Name}`,
                'LAB_HEAD' // Notify Lab Heads
            );
            console.log('[Bookings] AuditLogger.logBooking completed successfully');
        } catch (auditError) {
            console.error('[Bookings] AuditLogger.logBooking FAILED:', auditError);
        }

        // Broadcast real-time UI update to LAB_HEAD and LAB_TECH
        await NotificationManager.broadcastBookingEvent('BOOKING_CREATED', booking, ['LAB_HEAD', 'LAB_TECH']);


        res.status(201).json({ success: true, data: booking });

    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({ success: false, error: 'Failed to create booking' });
    }
};

// Get all room bookings
const getBookings = async (req, res) => {
    try {
        const { status, roomId, userId } = req.query;

        const where = {};
        // Support comma-separated statuses (e.g., "PENDING,APPROVED")
        if (status) {
            const statuses = status.split(',').map(s => s.trim());
            where.Status = statuses.length > 1 ? { in: statuses } : statuses[0];
        }
        if (roomId) where.Room_ID = parseInt(roomId);
        if (userId) where.User_ID = parseInt(userId);

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

        // Get the existing booking
        const existingBooking = await prisma.Booked_Room.findUnique({
            where: { Booked_Room_ID: parseInt(id) },
            include: { User: true }
        });

        if (!existingBooking) {
            return res.status(404).json({ success: false, error: 'Booking not found' });
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
        const isStaff = ['ADMIN', 'LAB_TECH', 'LAB_HEAD'].includes(approver.User_Role);

        // Get the booking to check ownership and current status
        const existingBooking = await prisma.Booked_Room.findUnique({
            where: { Booked_Room_ID: parseInt(id) },
            include: { User: true }
        });

        if (!existingBooking) {
            return res.status(404).json({ success: false, error: 'Booking not found' });
        }

        // Permission logic:
        // - STAFF (LAB_TECH, LAB_HEAD, ADMIN) can approve/reject/cancel any booking
        // - FACULTY can only CANCEL their OWN bookings
        const isOwner = existingBooking.User_ID === parseInt(approverId);
        const isFacultyCancellingOwn = approver.User_Role === 'FACULTY' && status === 'CANCELLED' && isOwner;

        if (!isStaff && !isFacultyCancellingOwn) {
            return res.status(403).json({
                success: false, error: 'Forbidden',
                details: 'Only LAB_TECH, LAB_HEAD, or ADMIN can approve/reject bookings. Faculty can only cancel their own bookings.'
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
                await NotificationManager.broadcastBookingEvent('BOOKING_CANCELLED', booking, ['LAB_HEAD', 'LAB_TECH']);
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

                // ALSO broadcast to LAB_HEAD/LAB_TECH so their calendars update too
                await NotificationManager.broadcastBookingEvent(notificationType, booking, ['LAB_HEAD', 'LAB_TECH']);
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
        const isStaff = ['ADMIN', 'LAB_TECH', 'LAB_HEAD'].includes(req.user.User_Role);

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
        await NotificationManager.broadcastBookingEvent('BOOKING_CANCELLED', existingBooking, ['LAB_HEAD', 'LAB_TECH']);

        res.json({ success: true, data: { message: 'Booking deleted successfully' } });
    } catch (error) {
        console.error('Error deleting booking:', error);
        res.status(500).json({ success: false, error: 'Failed to delete booking' });
    }
};

module.exports = {
    createBooking,
    getBookings,
    updateBooking,
    updateBookingStatus,
    getAvailableRooms,
    deleteBooking
};
