require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { PrismaClient } = require('@prisma/client')

const app = express()
const prisma = new PrismaClient()
const authRoutes = require('./middleware/auth');

// Middleware
app.use(cors())
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/inventory', require('../routes/inventory'))
app.use('/api/users', require('../routes/users'));
app.use('/api/tickets', require('../routes/tickets'))
app.use('/api/rooms', require('../routes/rooms'))
app.use('/api/bookings', require('../routes/bookings'))
app.use('/api/computers', require('../routes/computers'))
app.use('/api/borrowing', require('../routes/borrowing'))

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
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
