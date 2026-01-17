console.log('Starting server initialization...');
require('dotenv').config();
console.log('Dotenv loaded');
const express = require('express')
const cors = require('cors')
const { PrismaClient } = require('@prisma/client')

console.log('Initializing Express and Prisma...');
const app = express()
const prisma = new PrismaClient()
const { login, logout, authenticateToken } = require('./middleware/auth');

// Middleware
app.use(cors())
app.use(express.json())

// Auth routes
console.log('Registering routes...');
app.post('/api/auth/login', login);
app.post('/api/auth/logout', authenticateToken, logout);
app.use('/api/inventory', require('../routes/inventory'))
app.use('/api/users', require('../routes/users'));
app.use('/api/tickets', require('../routes/tickets'))
app.use('/api/rooms', require('../routes/rooms'))
app.use('/api/bookings', require('../routes/bookings'))
app.use('/api/computers', require('../routes/computers'))
app.use('/api/borrowing', require('../routes/borrowing'))
console.log('Registering notifications route...');
app.use('/api/notifications', require('../routes/notifications')) // Uncommented SSE
app.use('/api/forms', require('../routes/forms'))
console.log('Registering dashboard route...');
app.use('/api/dashboard', require('../routes/dashboard'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong!' })
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

const PORT = process.env.PORT || 3000
console.log(`Attempting to listen on port ${PORT}...`);
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
console.log('Server setup complete, listener registered.');
