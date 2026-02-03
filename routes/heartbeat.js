const express = require('express');
const router = express.Router();
const prisma = require('../src/lib/prisma');
const { authenticateToken } = require('../src/middleware/auth');
const { authorize, ROLES } = require('../src/middleware/authorize');
const { asyncHandler } = require('../src/middleware/errorHandler');
const HeartbeatService = require('../src/services/heartbeatService');

// ============================================
// POST /api/heartbeat/register - Auto-detect computer via MAC address
// ============================================
router.post('/register', authenticateToken, asyncHandler(async (req, res) => {
    const { client_ip, device_fingerprint, browser_info } = req.body;
    const user = req.user;

    // Extract IP from request (use provided client_ip or fallback to request IP)
    const ipAddress = client_ip || req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim();

    if (!ipAddress) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_IP',
            message: 'Cannot detect client IP address'
        });
    }

    try {
        // Get MAC address from IP
        const macAddress = await HeartbeatService.getMacFromIP(ipAddress);

        if (!macAddress) {
            // Failed to get MAC - return available computers
            const availableComputers = await prisma.computer.findMany({
                where: { Is_Online: false },
                include: {
                    Room: {
                        select: {
                            Room_ID: true,
                            Name: true,

                        }
                    }
                }
            });

            return res.status(400).json({
                success: false,
                error: 'AUTO_DETECT_FAILED',
                message: 'Could not detect MAC address from IP. Please select computer manually.',
                available_computers: availableComputers.map(c => ({
                    id: c.Computer_ID,
                    name: c.Name,
                    room_id: c.Room_ID,
                    room_name: c.Room?.Name,

                }))
            });
        }

        // Find computer by MAC address
        const computer = await prisma.computer.findFirst({
            where: { Mac_Address: macAddress },
            include: {
                Room: {
                    select: {
                        Room_ID: true,
                        Name: true
                    }
                }
            }
        });

        if (!computer) {
            // MAC found but no matching computer in database
            const availableComputers = await prisma.computer.findMany({
                where: { Is_Online: false },
                include: {
                    Room: {
                        select: {
                            Room_ID: true,
                            Name: true,

                        }
                    }
                }
            });

            return res.status(404).json({
                success: false,
                error: 'COMPUTER_NOT_FOUND',
                message: `Computer with MAC ${macAddress} not found in database`,
                available_computers: availableComputers.map(c => ({
                    id: c.Computer_ID,
                    name: c.Name,
                    room_id: c.Room_ID,
                    room_name: c.Room?.Name,

                }))
            });
        }

        // Update computer with current user
        await prisma.computer.update({
            where: { Computer_ID: computer.Computer_ID },
            data: {
                Current_User_ID: user.User_ID,
                Is_Online: true
            }
        });

        return res.json({
            success: true,
            computer: {
                id: computer.Computer_ID,
                name: computer.Name,
                room_id: computer.Room_ID,
                room_name: computer.Room?.Name,
                mac_address: computer.Mac_Address
            },
            message: `Successfully registered to ${computer.Name}`
        });

    } catch (error) {
        console.error('Auto-detect error:', error);

        // Return available computers on any error
        const availableComputers = await prisma.computer.findMany({
            where: { Is_Online: false },
            include: {
                Room: {
                    select: {
                        Room_ID: true,
                        Name: true
                    }
                }
            }
        });

        return res.status(500).json({
            success: false,
            error: 'AUTO_DETECT_FAILED',
            message: error.message || 'Failed to auto-detect computer',
            available_computers: availableComputers.map(c => ({
                id: c.Computer_ID,
                name: c.Name,
                room_id: c.Room_ID,
                room_name: c.Room?.Name
            }))
        });
    }
}));

// ============================================
// POST /api/heartbeat - Receive heartbeat signal
// ============================================
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
    const { computer_id, session_id, status, is_page_hidden } = req.body;
    const user = req.user;

    // Validate required fields
    if (!computer_id) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_FIELD',
            message: 'computer_id is required'
        });
    }

    if (!session_id) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_FIELD',
            message: 'session_id is required'
        });
    }

    if (!status) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_FIELD',
            message: 'status is required'
        });
    }

    // Process heartbeat via service
    const result = await HeartbeatService.processHeartbeat({
        current_user_id: user.User_ID,
        computer_id: parseInt(computer_id),
        session_id: session_id,
        status: status,
        is_page_hidden: is_page_hidden || false
    });

    // Get computer details for response
    const computer = await prisma.computer.findUnique({
        where: { Computer_ID: parseInt(computer_id) },
        select: {
            Computer_ID: true,
            Name: true,
            Is_Online: true
        }
    });

    res.json({
        success: true,
        next_interval: result.next_interval || 30, // Default 30 seconds
        computer: {
            id: computer.Computer_ID,
            name: computer.Name,
            status: computer.Is_Online ? 'ONLINE' : 'OFFLINE'
        }
    });
}));

// ============================================
// GET /api/heartbeat/status - Get status summary
// ============================================
router.get('/status',
    authenticateToken,
    authorize(ROLES.LAB_TECH, ROLES.LAB_HEAD, ROLES.ADMIN),
    asyncHandler(async (req, res) => {
        const { room_id, include_computers } = req.query;
        const includeComputers = include_computers === 'true';

        // If room_id provided, get status for that room only
        if (room_id) {
            const summary = await HeartbeatService.getStatusSummary(parseInt(room_id), includeComputers);

            if (!summary || summary.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Room not found or has no computers'
                });
            }

            return res.json({
                success: true,
                room: summary[0] // Single room
            });
        }

        // Get status for all rooms
        const summary = await HeartbeatService.getStatusSummary(null, includeComputers);

        res.json({
            success: true,
            rooms: summary
        });
    })
);

// ============================================
// GET /api/heartbeat/computer/:id - Get detailed history
// ============================================
router.get('/computer/:id',
    authenticateToken,
    authorize(ROLES.LAB_TECH, ROLES.LAB_HEAD, ROLES.ADMIN),
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        // Find computer with heartbeat history
        const computer = await prisma.computer.findUnique({
            where: { Computer_ID: parseInt(id) },
            include: {
                Room: {
                    select: {
                        Room_ID: true,
                        Name: true
                    }
                },
                Current_User: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                ComputerHeartbeat: {
                    take: 100,
                    orderBy: { Timestamp: 'desc' },
                    include: {
                        User: {
                            select: {
                                User_ID: true,
                                First_Name: true,
                                Last_Name: true,
                                Email: true
                            }
                        }
                    }
                }
            }
        });

        if (!computer) {
            return res.status(404).json({
                success: false,
                message: 'Computer not found'
            });
        }

        res.json({
            success: true,
            computer: {
                id: computer.Computer_ID,
                name: computer.Name,
                mac_address: computer.Mac_Address,
                is_online: computer.Is_Online,
                room: computer.Room,
                current_user: computer.Current_User
            },
            heartbeats: computer.ComputerHeartbeat.map(h => ({
                id: h.Heartbeat_ID,
                session_id: h.Session_ID,
                status: h.Status,
                timestamp: h.Timestamp,
                session_start: h.Session_Start,
                session_end: h.Session_End,
                is_active: h.Is_Active,
                user: h.User
            }))
        });
    })
);

// ============================================
// DELETE /api/heartbeat/session/:sessionId - End session
// ============================================
router.delete('/session/:sessionId', authenticateToken, asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const user = req.user;

    // Find active heartbeat by session ID
    const heartbeat = await prisma.computerHeartbeat.findFirst({
        where: {
            Session_ID: sessionId,
            Is_Active: true
        },
        include: {
            Computer: true
        }
    });

    if (!heartbeat) {
        return res.status(404).json({
            success: false,
            message: 'Active session not found'
        });
    }

    // Verify user owns this session
    if (heartbeat.User_ID !== user.User_ID) {
        return res.status(403).json({
            success: false,
            message: 'You can only end your own sessions'
        });
    }

    const now = new Date();

    // Update heartbeat to mark as ended
    await prisma.computerHeartbeat.update({
        where: { Heartbeat_ID: heartbeat.Heartbeat_ID },
        data: {
            Status: 'OFFLINE',
            Is_Active: false,
            Session_End: now
        }
    });

    // Update computer status
    await prisma.computer.update({
        where: { Computer_ID: heartbeat.Computer_ID },
        data: {
            Is_Online: false,
            Current_User_ID: null
        }
    });

    res.json({
        success: true,
        message: `Session ended for ${heartbeat.Computer.Name}`
    });
}));

module.exports = router;
