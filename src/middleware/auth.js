const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const user = await prisma.user.findUnique({ where: { Email: email } });
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    if (user.Is_Active === false) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    console.log('User from DB:', user);

    // if password column is capitalized
    if (user.Password !== password) return res.status(401).json({ message: 'Invalid email or password' });

    const token = jwt.sign({ userId: user.User_ID }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '1h' });

    const { Password, ...userData } = user;
    res.json({ token, user: userData });
  } catch (err) {
    console.error('Login route error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
