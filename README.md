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

3. Set up PostgreSQL and environment variables:
   - Install PostgreSQL from https://www.postgresql.org/download/windows/
   - During installation:
     - Set a password for the postgres user
     - Keep the default port (5432)
     - Add PostgreSQL to PATH
     - Install pgAdmin4 (the GUI tool)
   - Create a database named 'bitsdb' using pgAdmin4
   - Create a .env file in the root:
   ```env
   DATABASE_URL=postgresql://postgres:your_password@localhost:5432/bitsdb
   
4. Run migrations:
   ```bash
   npx prisma migrate dev --name init

5. Run migrations:
   ```bash
   npm run dev

Testingi daw balik   
