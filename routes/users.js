const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get all users
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;
    const users = await prisma.User.findMany({
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

// Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await prisma.User.findUnique({
      where: { User_ID: parseInt(req.params.id) },
      include: {
        Item: true,
        Borrow_Item: true,
        Borrowing_Comp: true,
        Form_Form_Approver_IDToUser: true,
        Form_Form_Creator_IDToUser: true,
        Ticket: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error(`Error fetching user ${req.params.id}:`, error);
    res.status(500).json({ 
      error: 'Failed to fetch user',
      details: error.message 
    });
  }
});

// Create new user
router.post('/', async (req, res) => {
  try {
    const { 
      User_Type, 
      First_Name, 
      Last_Name, 
      Email, 
      Password,
      Middle_Name = '',
      Is_Active = true
    } = req.body;

    // Validate required fields
    if (!User_Type || !First_Name || !Last_Name || !Email || !Password) {
      return res.status(400).json({
        error: 'User_Type, First_Name, Last_Name, Email, and Password are required'
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
        User_Type,
        First_Name,
        Last_Name,
        Middle_Name,
        Email,
        Password,
        Is_Active,
        Created_At: currentTime,
        Updated_At: null  // Set to null for new users
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

// Update user (creates new version)
router.put('/:id', async (req, res) => {
  const transaction = [];
  
  try {
    const userId = parseInt(req.params.id);
    const updates = req.body;
    const currentTime = new Date();

    // 1. Get current user data
    const currentUser = await prisma.User.findUnique({
      where: { User_ID: userId }
    });

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Mark current user as inactive
    transaction.push(
      prisma.User.update({
        where: { User_ID: userId },
        data: { 
          Is_Active: false,
          Updated_At: currentTime
        }
      })
    );

    // 3. Create new user version with updated data
    const { User_ID, ...userData } = currentUser;
    const newUserData = {
      ...userData,
      ...updates,
      Is_Active: true,
      Created_At: currentTime, // Set to current time for new version
      Updated_At: null, // Set to null for new version
      Email: updates.Email || currentUser.Email // Ensure email is not removed
    };

    transaction.push(
      prisma.User.create({
        data: newUserData
      })
    );

    // 4. Log the update in audit log
    transaction.push(
      prisma.Audit_Log.create({
        data: {
          User_ID: currentUser.User_ID,
          Action: `USER_UPDATED: ${Object.keys(updates).join(', ')}`,
          Timestamp: currentTime
        }
      })
    );

    // Execute all operations in a transaction
    const [_, newUser] = await prisma.$transaction(transaction);

    // Remove password from response
    const { Password, ...userWithoutPassword } = newUser;
    
    res.json(userWithoutPassword);
  } catch (error) {
    console.error(`Error updating user ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to update user',
      details: error.message
    });
  }
});

// Soft delete user (mark as inactive)
router.delete('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    // Check if user exists
    const user = await prisma.User.findUnique({
      where: { User_ID: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Mark as inactive instead of deleting
    const deletedUser = await prisma.User.update({
      where: { User_ID: userId },
      data: { 
        Is_Active: false,
        Updated_At: new Date() 
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

module.exports = router;
