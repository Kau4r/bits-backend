const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken'); // add this

// Middleware to extract user from JWT
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Invalid token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.userId = decoded.userId; // attach userId to request
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Get current authenticated user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId; // comes from JWT
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { User_ID: userId },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Remove password from response
    const { Password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ error: 'Failed to fetch user', details: error.message });
  }
});

// Get all users
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;
    const users = await prisma.user.findMany({
      where: active === 'true' ? { Is_Active: true } : {},
      orderBy: { Last_Name: 'asc' }
    });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      error: 'Failed to fetch users',
      details: error.message
    });
  }
});

// Create new user
router.post('/', async (req, res) => {
  try {
    const {
      User_Role,
      First_Name,
      Last_Name,
      Email,
      Password,
      Middle_Name = '',
      Is_Active = true
    } = req.body;

    // Validate required fields
    if (!User_Role || !First_Name || !Last_Name || !Email || !Password) {
      return res.status(400).json({
        error: 'User_Role, First_Name, Last_Name, Email, and Password are required'
      });
    }

    // Check if email already exists
    const existingUser = await prisma.User.findFirst({
      where: { Email }
    });

    if (existingUser) {
      return res.status(400).json({
        error: 'User with this email already exists'
      });
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
        Is_Active,
        Created_At: currentTime,
        Updated_At: currentTime  // Set to current time for new users
      }
    });

    // Remove password from response
    const { Password: _, ...userWithoutPassword } = user;

    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      error: 'Failed to create user',
      details: error.message
    });
  }
});

// Update user (simple, no versioning)
router.put('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const updates = req.body;

    // Find the user
    const currentUser = await prisma.User.findUnique({
      where: { User_ID: userId }
    });

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
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
    res.json(userWithoutPassword);

  } catch (error) {
    console.error(`Error updating user ${req.params.id}:`, error);

    if (error.code === 'P2002') {
      return res.status(400).json({
        error: 'Database error',
        details: 'A user with this email already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to update user',
      details: error.message || 'Unknown error'
    });
  }
});

// Soft delete user (mark as inactive)
router.delete('/:id', async (req, res) => {
  const prisma = new PrismaClient();

  try {
    const userId = parseInt(req.params.id);

    // Check if user exists and is active
    const user = await prisma.User.findFirst({
      where: {
        User_ID: userId,
        Is_Active: true
      }
    });

    if (!user) {
      return res.status(404).json({
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
      message: 'User marked as inactive',
      user: userWithoutPassword
    });
  } catch (error) {
    console.error(`Error deleting user ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to delete user',
      details: error.message
    });
  } finally {
    await prisma.$disconnect();
  }
});

// Get user history (from audit log)
router.get('/:id/history', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Get user to verify they exist
    const user = await prisma.User.findUnique({
      where: { User_ID: userId },
      select: { Email: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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

    res.json(userHistory);
  } catch (error) {
    console.error(`Error fetching user history for ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to fetch user history',
      details: error.message
    });
  }
});

// Bulk create users
router.post('/bulk', async (req, res) => {
  try {
    const { users } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        details: 'Expected an array of users in the request body'
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
      message: `Successfully created ${createdUsers.length} users`,
      count: createdUsers.length,
      users: createdUsers.map(u => ({
        User_ID: u.User_ID,
        Email: u.Email,
        User_Role: u.User_Role
      }))
    });

  } catch (error) {
    console.error('Error in bulk user creation:', error);
    res.status(500).json({
      error: 'Failed to create users',
      details: error.message,
      ...(error.code && { code: error.code })
    });
  }
});

module.exports = router;