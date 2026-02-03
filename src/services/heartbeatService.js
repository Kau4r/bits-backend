const { exec } = require('child_process');
const { promisify } = require('util');
const prisma = require('../lib/prisma');
const NotificationService = require('./notificationService');

const execAsync = promisify(exec);

/**
 * HeartbeatService - Core heartbeat processing and computer status management
 * Handles heartbeat upserts, adaptive intervals, offline detection, and status broadcasting
 */
class HeartbeatService {
    // Threshold constants
    static OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
    static HIGH_FREQUENCY_INTERVAL = 10; // seconds
    static NORMAL_INTERVAL = 30; // seconds
    static LOW_FREQUENCY_INTERVAL = 120; // seconds

    /**
     * Main heartbeat processing handler
     * Upserts heartbeat record and updates Computer.Is_Online and Last_Seen
     *
     * @param {Object} data - Heartbeat data
     * @param {number} data.computer_id - Computer ID
     * @param {string} data.mac_address - MAC address
     * @param {string} data.ip_address - IP address
     * @param {number} data.current_user_id - Current user ID (nullable)
     * @param {boolean} data.is_page_hidden - Whether browser tab is hidden
     * @param {number} data.session_id - Session ID (nullable)
     * @returns {Promise<Object>} Upserted heartbeat record with next_interval
     */
    static async processHeartbeat(data) {
        try {
            const {
                computer_id,
                mac_address,
                ip_address,
                current_user_id,
                is_page_hidden,
                session_id
            } = data;

            // Find the computer
            const computer = await this.findComputer(computer_id, mac_address);
            if (!computer) {
                throw new Error(`Computer not found: ID=${computer_id}, MAC=${mac_address}`);
            }

            // Calculate next interval (no active session needed - use computer state)
            const next_interval = await this.calculateNextInterval(computer, null, is_page_hidden);

            // Upsert heartbeat record (Session_ID is @unique)
            const heartbeat = await prisma.computerHeartbeat.upsert({
                where: {
                    Session_ID: session_id || `auto-${computer.Computer_ID}-${Date.now()}`
                },
                update: {
                    Timestamp: new Date(),
                    IP_Address: ip_address,
                    User_ID: current_user_id || null,
                    Status: 'ONLINE',
                    Interval_Used: next_interval,
                    Is_Active: true
                },
                create: {
                    Computer_ID: computer.Computer_ID,
                    User_ID: current_user_id || null,
                    Session_ID: session_id || `auto-${computer.Computer_ID}-${Date.now()}`,
                    Status: 'ONLINE',
                    IP_Address: ip_address,
                    Timestamp: new Date(),
                    Interval_Used: next_interval,
                    Session_Start: new Date(),
                    Is_Active: true
                }
            });

            // Update Computer.Is_Online and Last_Seen
            await prisma.computer.update({
                where: { Computer_ID: computer.Computer_ID },
                data: {
                    Is_Online: true,
                    Last_Seen: new Date()
                }
            });

            // Broadcast status update
            await this.broadcastStatusUpdate(computer);

            console.log(`[HeartbeatService] Heartbeat processed for Computer_ID=${computer.Computer_ID}, next_interval=${next_interval}s`);

            return {
                ...heartbeat,
                next_interval
            };

        } catch (error) {
            console.error('[HeartbeatService] Error processing heartbeat:', error.message);
            throw error;
        }
    }

    /**
     * Find computer by ID or MAC address
     *
     * @param {number} computer_id - Computer ID
     * @param {string} mac_address - MAC address
     * @returns {Promise<Object|null>} Computer record or null
     */
    static async findComputer(computer_id, mac_address) {
        try {
            let computer = null;

            // Try finding by computer_id first
            if (computer_id) {
                computer = await prisma.computer.findUnique({
                    where: { Computer_ID: computer_id },
                    include: {
                        Room: true
                    }
                });
            }

            // Fallback to MAC address lookup
            if (!computer && mac_address) {
                computer = await prisma.computer.findFirst({
                    where: { Mac_Address: mac_address },
                    include: {
                        Room: true
                    }
                });
            }

            return computer;

        } catch (error) {
            console.error('[HeartbeatService] Error finding computer:', error.message);
            return null;
        }
    }

    /**
     * Get MAC address from IP using ARP lookup
     * Cross-platform support: Linux, macOS, Windows
     *
     * @param {string} clientIP - Client IP address
     * @returns {Promise<string|null>} MAC address or null if not found
     */
    static async getMacFromIP(clientIP) {
        try {
            const platform = process.platform;
            let command;

            // Determine ARP command based on platform
            if (platform === 'win32') {
                command = `arp -a ${clientIP}`;
            } else {
                // Linux and macOS both use 'arp -n'
                command = `arp -n ${clientIP}`;
            }

            const { stdout } = await execAsync(command);

            // Parse MAC address from ARP output
            // Matches formats: XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX
            const macRegex = /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/;
            const match = stdout.match(macRegex);

            if (match) {
                // Normalize to colon-separated format
                const mac = match[0].replace(/-/g, ':').toUpperCase();
                console.log(`[HeartbeatService] MAC found for IP ${clientIP}: ${mac}`);
                return mac;
            }

            console.warn(`[HeartbeatService] No MAC found for IP ${clientIP}`);
            return null;

        } catch (error) {
            console.warn(`[HeartbeatService] ARP lookup failed for IP ${clientIP}:`, error.message);
            return null;
        }
    }

    /**
     * Calculate next heartbeat interval based on computer state
     * Returns 10s (high), 30s (normal), or 120s (low) based on conditions
     *
     * @param {Object} computer - Computer record
     * @param {Object} session - Current session (nullable)
     * @param {boolean} is_page_hidden - Whether browser tab is hidden
     * @returns {Promise<number>} Next interval in seconds (10, 30, or 120)
     */
    static async calculateNextInterval(computer, session, is_page_hidden = false) {
        try {
            // HIGH FREQUENCY (10s): Recent tickets OR 2+ offline events/hour OR maintenance status
            const hasIssues = await this.hasActiveIssues(computer);
            if (hasIssues || computer.Status === 'MAINTENANCE') {
                return this.HIGH_FREQUENCY_INTERVAL;
            }

            // LOW FREQUENCY (120s): Page hidden OR after hours OR no current user
            const afterHours = this.isAfterHours();
            const noCurrentUser = !session || !session.User_ID;

            if (is_page_hidden || afterHours || noCurrentUser) {
                return this.LOW_FREQUENCY_INTERVAL;
            }

            // NORMAL (30s): Default
            return this.NORMAL_INTERVAL;

        } catch (error) {
            console.error('[HeartbeatService] Error calculating next interval:', error.message);
            return this.NORMAL_INTERVAL; // Fallback to normal
        }
    }

    /**
     * Check if computer has active issues (tickets, offline events, maintenance)
     *
     * @param {Object} computer - Computer record
     * @returns {Promise<boolean>} True if active issues exist
     */
    static async hasActiveIssues(computer) {
        try {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

            // TODO: Add Computer_ID to Ticket model, then uncomment
            // Check for recent open/in-progress tickets
            // const recentTickets = await prisma.ticket.count({
            //     where: {
            //         Computer_ID: computer.Computer_ID,
            //         Status: {
            //             in: ['PENDING', 'IN_PROGRESS']
            //         },
            //         Created_At: {
            //             gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) // Last 24 hours
            //         }
            //     }
            // });
            // if (recentTickets > 0) {
            //     return true;
            // }

            // Check for 2+ offline heartbeat events in the last hour
            const offlineEvents = await prisma.computerHeartbeat.count({
                where: {
                    Computer_ID: computer.Computer_ID,
                    Status: 'OFFLINE',
                    Timestamp: {
                        gte: oneHourAgo
                    }
                }
            });

            if (offlineEvents >= 2) {
                return true;
            }

            return false;

        } catch (error) {
            console.error('[HeartbeatService] Error checking active issues:', error.message);
            return false;
        }
    }

    /**
     * Check if current time is after hours (before 7am or after 6pm)
     *
     * @returns {boolean} True if after hours
     */
    static isAfterHours() {
        const hour = new Date().getHours();
        return hour < 7 || hour >= 18;
    }

    /**
     * Check for computers with stale heartbeats (>2 minutes)
     * Mark them as offline and create alerts
     *
     * @returns {Promise<number>} Count of computers marked offline
     */
    static async checkOfflineComputers() {
        try {
            const threshold = new Date(Date.now() - this.OFFLINE_THRESHOLD_MS);

            // Find computers with stale heartbeats
            const staleHeartbeats = await prisma.computerHeartbeat.findMany({
                where: {
                    Timestamp: {
                        lt: threshold
                    },
                    Is_Active: true
                },
                include: {
                    Computer: {
                        include: {
                            Room: true
                        }
                    }
                }
            });

            let offlineCount = 0;

            for (const heartbeat of staleHeartbeats) {
                const computer = heartbeat.Computer;

                // Only mark offline if currently marked as online
                if (computer.Is_Online) {
                    await this.markComputerOffline(computer);
                    offlineCount++;
                }
            }

            if (offlineCount > 0) {
                console.log(`[HeartbeatService] Marked ${offlineCount} computers as offline`);
            }

            return offlineCount;

        } catch (error) {
            console.error('[HeartbeatService] Error checking offline computers:', error.message);
            return 0;
        }
    }

    /**
     * Mark computer as offline
     * Updates status, creates offline event, sends alert, broadcasts update
     *
     * @param {Object} computer - Computer record
     * @returns {Promise<void>}
     */
    static async markComputerOffline(computer) {
        try {
            // Update Computer.Is_Online = false
            await prisma.computer.update({
                where: { Computer_ID: computer.Computer_ID },
                data: { Is_Online: false }
            });

            // Create offline heartbeat record
            await prisma.computerHeartbeat.create({
                data: {
                    Computer_ID: computer.Computer_ID,
                    Session_ID: `offline-${computer.Computer_ID}-${Date.now()}`,
                    Status: 'OFFLINE',
                    Timestamp: new Date(),
                    Interval_Used: 0,
                    Session_Start: new Date(),
                    Is_Active: false
                }
            });

            // Create offline alert
            await this.createOfflineAlert(computer);

            // Broadcast status update
            await this.broadcastStatusUpdate(computer);

            console.log(`[HeartbeatService] Computer marked offline: ${computer.Name} (ID=${computer.Computer_ID})`);

        } catch (error) {
            console.error('[HeartbeatService] Error marking computer offline:', error.message);
            throw error;
        }
    }

    /**
     * Create offline alert notification
     * Sends to LAB_TECH and LAB_HEAD users
     *
     * @param {Object} computer - Computer record
     * @returns {Promise<void>}
     */
    static async createOfflineAlert(computer) {
        try {
            const message = `Computer ${computer.Name} in ${computer.Room?.Name || 'Unknown Room'} has gone offline`;

            const notificationPayload = {
                type: 'COMPUTER_OFFLINE',
                title: 'Computer Offline Alert',
                message,
                timestamp: new Date().toISOString(),
                data: {
                    computer_id: computer.Computer_ID,
                    computer_name: computer.Name,
                    room_id: computer.Room_ID,
                    room_name: computer.Room?.Name
                }
            };

            // Notify LAB_TECH and LAB_HEAD roles
            await NotificationService.notifyRole(
                ['LAB_TECH', 'LAB_HEAD'],
                notificationPayload
            );

            console.log(`[HeartbeatService] Offline alert sent for Computer_ID=${computer.Computer_ID}`);

        } catch (error) {
            console.error('[HeartbeatService] Error creating offline alert:', error.message);
            // Don't throw - notification failure should not break main flow
        }
    }

    /**
     * Broadcast computer status update via WebSocket
     *
     * @param {Object} computer - Computer record
     * @returns {Promise<void>}
     */
    static async broadcastStatusUpdate(computer) {
        try {
            // Get fresh computer data with online status
            const freshComputer = await prisma.computer.findUnique({
                where: { Computer_ID: computer.Computer_ID },
                include: {
                    Room: true,
                    ComputerHeartbeat: true
                }
            });

            if (!freshComputer) {
                console.warn(`[HeartbeatService] Computer not found for broadcast: ID=${computer.Computer_ID}`);
                return;
            }

            const statusPayload = {
                type: 'COMPUTER_STATUS_UPDATE',
                data: {
                    computer_id: freshComputer.Computer_ID,
                    computer_name: freshComputer.Name,
                    room_id: freshComputer.Room_ID,
                    room_name: freshComputer.Room?.Name,
                    is_online: freshComputer.Is_Online,
                    last_seen: freshComputer.Last_Seen,
                    last_heartbeat: freshComputer.ComputerHeartbeat?.[0]?.Timestamp
                }
            };

            // Broadcast to LAB_TECH and LAB_HEAD users
            await NotificationService.notifyRole(
                ['LAB_TECH', 'LAB_HEAD'],
                statusPayload
            );

        } catch (error) {
            console.error('[HeartbeatService] Error broadcasting status update:', error.message);
            // Don't throw - broadcast failure should not break main flow
        }
    }

    /**
     * Calculate computer status based on online state and recent activity
     * Business logic:
     * - OFFLINE: Is_Online = false
     * - WARNING: Is_Online = true AND 2+ offline events in past 24 hours
     * - IDLE: Is_Online = true AND most recent heartbeat has Status = 'IDLE'
     * - ONLINE: Is_Online = true AND most recent heartbeat has Status = 'ONLINE'
     *
     * @param {Object} computer - Computer record with Is_Online field
     * @param {Object} mostRecentHeartbeat - Most recent heartbeat record (nullable)
     * @returns {Promise<string>} Status: ONLINE, IDLE, WARNING, or OFFLINE
     */
    static async calculateComputerStatus(computer, mostRecentHeartbeat = null) {
        try {
            // OFFLINE: Computer is not online
            if (!computer.Is_Online) {
                return 'OFFLINE';
            }

            // Check for WARNING condition: 2+ offline events in past 24 hours
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const offlineEvents = await prisma.computerHeartbeat.count({
                where: {
                    Computer_ID: computer.Computer_ID,
                    Status: 'OFFLINE',
                    Timestamp: {
                        gte: twentyFourHoursAgo
                    }
                }
            });

            if (offlineEvents >= 2) {
                return 'WARNING';
            }

            // IDLE or ONLINE: Check most recent heartbeat status
            if (mostRecentHeartbeat && mostRecentHeartbeat.Status === 'IDLE') {
                return 'IDLE';
            }

            // Default to ONLINE
            return 'ONLINE';

        } catch (error) {
            console.error('[HeartbeatService] Error calculating computer status:', error.message);
            return 'ONLINE'; // Fallback to ONLINE on error
        }
    }

    /**
     * Get status summary grouped by room
     * Returns online/offline counts per room
     *
     * @param {number} room_id - Optional room filter
     * @param {boolean} includeComputers - Whether to include detailed computer arrays
     * @returns {Promise<Array>} Array of room status summaries
     */
    static async getStatusSummary(room_id = null, includeComputers = false) {
        try {
            const where = room_id ? { Room_ID: room_id } : {};

            // Get all computers with their rooms
            const computers = await prisma.computer.findMany({
                where,
                include: {
                    Room: true,
                    Current_User: includeComputers ? {
                        select: {
                            User_ID: true,
                            First_Name: true,
                            Last_Name: true,
                            Email: true
                        }
                    } : false,
                    ComputerHeartbeat: includeComputers ? {
                        take: 1,
                        orderBy: { Timestamp: 'desc' }
                    } : false
                }
            });

            // Group by room
            const roomMap = new Map();

            for (const computer of computers) {
                const roomId = computer.Room_ID;
                const roomName = computer.Room?.Name || 'Unknown Room';

                if (!roomMap.has(roomId)) {
                    roomMap.set(roomId, {
                        room_id: roomId,
                        room_name: roomName,
                        online_count: 0,
                        offline_count: 0,
                        total_count: 0,
                        ...(includeComputers && { computers: [] })
                    });
                }

                const summary = roomMap.get(roomId);
                summary.total_count++;

                if (computer.Is_Online) {
                    summary.online_count++;
                } else {
                    summary.offline_count++;
                }

                // Add computer details if requested
                if (includeComputers) {
                    const mostRecentHeartbeat = computer.ComputerHeartbeat?.[0] || null;
                    const status = await this.calculateComputerStatus(computer, mostRecentHeartbeat);

                    summary.computers.push({
                        Computer_ID: computer.Computer_ID,
                        Name: computer.Name,
                        Status: status,
                        Current_User: computer.Current_User || null,
                        Last_Seen: computer.Last_Seen,
                        Is_Online: computer.Is_Online
                    });
                }
            }

            // Convert map to array
            const summaries = Array.from(roomMap.values());

            console.log(`[HeartbeatService] Status summary generated for ${summaries.length} rooms (includeComputers=${includeComputers})`);

            return summaries;

        } catch (error) {
            console.error('[HeartbeatService] Error getting status summary:', error.message);
            throw error;
        }
    }
}

module.exports = HeartbeatService;
