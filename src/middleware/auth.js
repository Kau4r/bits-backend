const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      success: false,
      error: 'Access token is required' 
    });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', async (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false,
        error: 'Invalid or expired token' 
      });
    }
    
    try {
      // Fetch the user from the database to ensure they still exist
      const dbUser = await prisma.user.findUnique({
        where: { User_ID: user.userId }
      });
      
      if (!dbUser) {
        return res.status(403).json({ 
          success: false,
          error: 'User not found' 
        });
      }
      
      // Attach user to request object
      req.user = dbUser;
      next();
    } catch (error) {
      console.error('Error fetching user:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Server error during authentication' 
      });
    }
  });
};

// Login endpoint
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const user = await prisma.user.findFirst({ where: { Email: email } });
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

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
};

// Export the middleware functions
module.exports = {
  authenticateToken,
  login
};
