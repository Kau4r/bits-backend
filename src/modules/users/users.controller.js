const prisma = require('../../lib/prisma');

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

    const where = {};
    if (active === 'true') {
      where.Is_Active = true;
    }
    if (role) {
      where.User_Role = role;
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
  deleteUser,
  getUserHistory,
  bulkCreateUsers
};
