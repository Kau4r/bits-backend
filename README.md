# bits-backend

Backend for the Booking, Inventory, and Tracking System of the Department of Computer, Information System and Mathematics.

## Overview

This backend uses Express.js, Prisma ORM, and PostgreSQL. It provides a RESTful API to serve the frontend application with authentication, inventory management, and booking services.

## Tech Stack

- Node.js
- Express.js
- Prisma ORM
- PostgreSQL
- JSON Web Token (JWT) for authentication
- Passport.js (optional, modular auth)

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_ORG/bits-backend.git

2. Install dependencies:
   ```bash
   npm install

3. Set up environment variables:
   Create a .env file in the root:
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/bitsdb
   JWT_SECRET=your_jwt_secret
   PORT=5000
   
4. Run migrations:
   ```bash
   npx prisma migrate dev --name init

5. Run migrations:
   ```bash
   npm run dev

   
