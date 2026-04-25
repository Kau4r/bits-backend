const prisma = require('../../lib/prisma');
const { normalizeRole } = require('../../middleware/authorize');

// Get current authenticated user
const getCurrentUser = async (req, res) => {
  try {
    res.json({ success: true, data: req.user });
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
};

// Get all users (with optional filters: active, role)
const getUsers = async (req, res) => {
  try {
    const { active, role } = req.query;
    const requesterRole = normalizeRole(req.user?.User_Role);

    const where = {};

    if (requesterRole === 'ADMIN') {
      if (role) {
        const requestedRole = normalizeRole(role);
        if (!requestedRole) {
          return res.status(400).json({ success: false, error: 'Invalid role filter' });
        }
        where.User_Role = requestedRole;
      }
    } else if (requesterRole === 'LAB_HEAD') {
      const requestedRole = normalizeRole(role);
      if (role && requestedRole !== 'LAB_TECH') {
        return res.status(403).json({ success: false, error: 'Lab Heads can only list Lab Tech users' });
      }
      where.User_Role = 'LAB_TECH';
      where.Is_Active = true;
    } else {
      return res.status(403).json({ success: false, error: 'You do not have permission to list users' });
    }

    if (active === 'true') {
      where.Is_Active = true;
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { Last_Name: 'asc' },
      select: {
        User_ID: true,
        Username: true,
        First_Name: true,
        Last_Name: true,
        Email: true,
        User_Role: true,
        Is_Active: true,
        Created_At: true,
        Updated_At: true
      }
    });
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
};

// Create new user
const createUser = async (req, res) => {
  try {
    const {
      User_Role,
      First_Name,
      Last_Name,
      Email,
      Password = '',
      Username,
      Middle_Name = '',
      Is_Active = true
    } = req.body;

    // Validate required fields
    if (!User_Role || !First_Name || !Last_Name || !Email) {
      return res.status(400).json({
        success: false,
        error: 'User_Role, First_Name, Last_Name, and Email are required'
      });
    }

    // Check if email already exists
    const existingUser = await prisma.User.findFirst({
      where: { Email }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Check if username already exists
    if (Username) {
      const existingUsername = await prisma.User.findFirst({
        where: { Username }
      });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          error: 'User with this username already exists'
        });
      }
    }

    // Create the user
    const currentTime = new Date();
    const user = await prisma.User.create({
      data: {
        User_Role,
        First_Name,
        Last_Name,
        Middle_Name,
        Email,
        Password,
        Username: Username || null,
        Is_Active,
        Created_At: currentTime,
        Updated_At: currentTime
      }
    });

    // Remove password from response
    const { Password: _, ...userWithoutPassword } = user;

    res.status(201).json({ success: true, data: userWithoutPassword });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
};

// Update user (simple, no versioning)
const updateUser = async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const updates = req.body;

    // Prevent users from deactivating their own account
    if (req.user.User_ID === userId && updates.Is_Active === false) {
      return res.status(400).json({
        success: false,
        error: 'You cannot deactivate your own account'
      });
    }

    // Find the user
    const currentUser = await prisma.User.findUnique({
      where: { User_ID: userId }
    });

    if (!currentUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Update the user
    const updatedUser = await prisma.User.update({
      where: { User_ID: userId },
      data: {
        ...updates,
        Updated_At: new Date() // always update the timestamp
      }
    });

    // Remove password before sending response
    const { Password, ...userWithoutPassword } = updatedUser;
    res.json({ success: true, data: userWithoutPassword });

  } catch (error) {
    console.error(`Error updating user ${req.params.id}:`, error);

    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'A user with this email already exists'
      });
    }

    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
};

// ============================================================================
// Role-change failsafe endpoints
//
// Two-step flow: GET /users/:id/role-change-impact returns a list of in-flight
// items that depend on the user's current role. Sysad reviews this, then
// PATCH /users/:id/role applies the change in a transaction (audit logged) and
// invalidates the user's existing JWTs by bumping Token_Valid_After.
// ============================================================================

const VALID_ROLES_ENUM = ['ADMIN', 'LAB_HEAD', 'LAB_TECH', 'FACULTY', 'SECRETARY', 'STUDENT'];

const collectRoleChangeImpact = async (userId) => {
  const [
    activeAssignedTickets,
    activeBorrowingsAsBorrower,
    pendingFormsAsApprover,
    pendingBookingsAsApprover,
    futureBookingsAsRequester,
  ] = await Promise.all([
    prisma.ticket.findMany({
      where: { Technician_ID: userId, Status: { not: 'RESOLVED' }, Archived: false },
      select: { Ticket_ID: true, Status: true, Priority: true, Report_Problem: true, Created_At: true },
    }),
    prisma.borrow_Item.findMany({
      where: {
        Borrower_ID: userId,
        Status: { in: ['BORROWED', 'OVERDUE', 'APPROVED'] },
      },
      select: { Borrow_Item_ID: true, Status: true, Return_Date: true, Item: { select: { Item_Code: true, Item_Type: true } } },
    }),
    prisma.form.findMany({
      where: { Approver_ID: userId, Status: { in: ['PENDING', 'IN_REVIEW'] }, Is_Archived: false },
      select: { Form_ID: true, Form_Code: true, Status: true, Department: true },
    }),
    prisma.booked_Room.findMany({
      where: { Approved_By: userId, Status: 'PENDING' },
      select: { Booked_Room_ID: true, Status: true, Start_Time: true, Room: { select: { Name: true } } },
    }).catch(() => []),
    prisma.booked_Room.findMany({
      where: { User_ID: userId, Start_Time: { gt: new Date() }, Status: { in: ['APPROVED', 'PENDING'] } },
      select: { Booked_Room_ID: true, Status: true, Start_Time: true, Room: { select: { Name: true } } },
    }),
  ]);

  // Anything in this list is "blocking" — sysad must resolve before the change
  // is allowed unless force=true. The frontend surfaces these prominently.
  const blockers = [];
  if (activeBorrowingsAsBorrower.length > 0) {
    blockers.push({
      kind: 'BORROWED_ITEMS',
      message: `User has ${activeBorrowingsAsBorrower.length} unreturned item(s).`,
    });
  }
  if (pendingFormsAsApprover.length > 0) {
    blockers.push({
      kind: 'PENDING_FORM_APPROVALS',
      message: `User is the approver on ${pendingFormsAsApprover.length} in-flight form(s).`,
    });
  }

  return {
    activeAssignedTickets,
    activeBorrowingsAsBorrower,
    pendingFormsAsApprover,
    pendingBookingsAsApprover,
    futureBookingsAsRequester,
    counts: {
      tickets: activeAssignedTickets.length,
      borrowings: activeBorrowingsAsBorrower.length,
      formsAsApprover: pendingFormsAsApprover.length,
      pendingBookingsAsApprover: pendingBookingsAsApprover.length,
      futureBookingsAsRequester: futureBookingsAsRequester.length,
    },
    blockers,
  };
};

// GET /users/:id/role-change-impact
const getRoleChangeImpact = async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }
    const user = await prisma.user.findUnique({
      where: { User_ID: userId },
      select: { User_ID: true, First_Name: true, Last_Name: true, User_Role: true, Is_Active: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const impact = await collectRoleChangeImpact(userId);
    res.json({ success: true, data: { user, impact } });
  } catch (error) {
    console.error('[Users] role-change-impact error:', error);
    res.status(500).json({ success: false, error: 'Failed to compute role change impact' });
  }
};

// PATCH /users/:id/role
//   body: { newRole, reason, force? }
const changeUserRole = async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { newRole, reason, force } = req.body || {};

    if (!Number.isFinite(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }
    if (!newRole || !VALID_ROLES_ENUM.includes(newRole)) {
      return res.status(400).json({
        success: false,
        error: `newRole must be one of: ${VALID_ROLES_ENUM.join(', ')}`,
      });
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({ success: false, error: 'Reason is required (min 5 chars)' });
    }
    if (req.user.User_ID === userId) {
      return res.status(400).json({ success: false, error: 'You cannot change your own role' });
    }

    const target = await prisma.user.findUnique({ where: { User_ID: userId } });
    if (!target) return res.status(404).json({ success: false, error: 'User not found' });

    if (target.User_Role === newRole) {
      return res.status(400).json({ success: false, error: 'User already has that role' });
    }

    // Failsafe: refuse if user has unresolved blockers, unless explicitly forced.
    const impact = await collectRoleChangeImpact(userId);
    if (impact.blockers.length > 0 && !force) {
      return res.status(409).json({
        success: false,
        error: 'Role change blocked by in-flight items',
        blockers: impact.blockers,
        impact,
        details: 'Resolve the blocking items, or pass force=true to override.',
      });
    }

    const oldRole = target.User_Role;
    const tokenValidAfter = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { User_ID: userId },
        data: {
          User_Role: newRole,
          Token_Valid_After: tokenValidAfter,
          Updated_At: tokenValidAfter,
        },
      });
      // If demoting away from a role that holds tickets, unassign the user
      // from active tickets so they can be reassigned.
      const technicianRoles = new Set(['LAB_TECH', 'LAB_HEAD', 'ADMIN']);
      if (technicianRoles.has(oldRole) && !technicianRoles.has(newRole)) {
        await tx.ticket.updateMany({
          where: { Technician_ID: userId, Status: { not: 'RESOLVED' } },
          data: { Technician_ID: null },
        });
      }

      await tx.audit_Log.create({
        data: {
          User_ID: req.user.User_ID,
          Action: 'USER_ROLE_CHANGED',
          Details: `${req.user.First_Name} ${req.user.Last_Name} changed ${target.First_Name} ${target.Last_Name}'s role from ${oldRole} to ${newRole}. Reason: ${reason.trim()}`,
          Notification_Data: {
            targetUserId: userId,
            oldRole,
            newRole,
            reason: reason.trim(),
            forced: !!force,
            blockerCount: impact.blockers.length,
          },
        },
      });
    });

    res.json({
      success: true,
      data: {
        message: 'Role updated. The affected user will be required to log in again.',
        userId,
        oldRole,
        newRole,
        tokenValidAfter,
        impactSnapshot: impact.counts,
      },
    });
  } catch (error) {
    console.error('[Users] changeUserRole error:', error);
    res.status(500).json({ success: false, error: 'Failed to change user role' });
  }
};

// Soft delete user (mark as inactive)
const deleteUser = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent users from deactivating their own account
    if (req.user.User_ID === userId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot deactivate your own account'
      });
    }

    // Check if user exists and is active
    const user = await prisma.User.findFirst({
      where: {
        User_ID: userId,
        Is_Active: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found or already inactive'
      });
    }

    // Mark as inactive instead of deleting
    const deletedUser = await prisma.User.update({
      where: { User_ID: userId },
      data: {
        Is_Active: false,
        Updated_At: new Date()
      }
    });

    // Log the deletion
    await prisma.Audit_Log.create({
      data: {
        User_ID: userId,
        Action: 'USER_DEACTIVATED',
        Timestamp: new Date()
      }
    });

    // Remove password from response
    const { Password, ...userWithoutPassword } = deletedUser;

    res.json({
      success: true,
      data: { message: 'User marked as inactive', user: userWithoutPassword }
    });
  } catch (error) {
    console.error(`Error deleting user ${req.params.id}:`, error);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
};

// Get user history (from audit log)
const getUserHistory = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const requesterRole = normalizeRole(req.user?.User_Role);

    if (requesterRole !== 'ADMIN' && req.user?.User_ID !== userId) {
      return res.status(403).json({ success: false, error: 'You do not have permission to view this user history' });
    }

    // Get user to verify they exist
    const user = await prisma.User.findUnique({
      where: { User_ID: userId },
      select: { Email: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Get user's audit log entries
    const userHistory = await prisma.Audit_Log.findMany({
      where: { User_ID: userId },
      orderBy: { Timestamp: 'desc' },
      select: {
        Log_ID: true,
        Action: true,
        Timestamp: true,
        Details: true
      }
    });

    res.json({ success: true, data: userHistory });
  } catch (error) {
    console.error(`Error fetching user history for ${req.params.id}:`, error);
    res.status(500).json({ success: false, error: 'Failed to fetch user history' });
  }
};

// Bulk create users
const bulkCreateUsers = async (req, res) => {
  try {
    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Expected an array of users in the request body'
      });
    }

    // Hash passwords and prepare user data
    const userPromises = users.map(async (user) => {
      const hashedPassword = user.Password
        ? await bcrypt.hash(user.Password, 10)
        : await bcrypt.hash('defaultPassword123', 10); // Default password if not provided

      return {
        First_Name: user.First_Name,
        Middle_Name: user.Middle_Name || '',
        Last_Name: user.Last_Name,
        Email: user.Email,
        Password: hashedPassword,
        User_Role: user.User_Role || 'STUDENT', // Default to STUDENT if not specified
        Is_Active: user.Is_Active !== undefined ? user.Is_Active : true,
        Created_At: new Date(),
        Updated_At: new Date()
      };
    });

    const userData = await Promise.all(userPromises);

    // Use transaction to create all users
    const createdUsers = await prisma.$transaction(
      userData.map(user =>
        prisma.user.create({ data: user })
      )
    );

    res.status(201).json({
      success: true,
      data: {
        message: `Successfully created ${createdUsers.length} users`,
        count: createdUsers.length,
        users: createdUsers.map(u => ({
          User_ID: u.User_ID,
          Email: u.Email,
          User_Role: u.User_Role
        }))
      }
    });

  } catch (error) {
    console.error('Error in bulk user creation:', error);
    res.status(500).json({ success: false, error: 'Failed to create users' });
  }
};

module.exports = {
  getCurrentUser,
  getUsers,
  createUser,
  updateUser,
  getRoleChangeImpact,
  changeUserRole,
  deleteUser,
  getUserHistory,
  bulkCreateUsers
};
