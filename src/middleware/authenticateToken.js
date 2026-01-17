const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) return res.status(401).json({ error: 'Null token' });

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', async (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });

        try {
            const dbUser = await prisma.user.findUnique({ where: { User_ID: user.userId } });
            if (!dbUser) return res.status(403).json({ error: 'User not found' });
            req.user = dbUser;
            next();
        } catch (dbError) {
            console.error('Auth middleware error:', dbError);
            return res.status(500).json({ error: 'Internal server error during auth' });
        }
    });
};

module.exports = { authenticateToken };
