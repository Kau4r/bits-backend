/**
 * Shared PrismaClient singleton
 * Prevents connection pool exhaustion by reusing a single instance
 */
const { PrismaClient } = require('@prisma/client');

let prisma;

if (process.env.NODE_ENV === 'production') {
    prisma = new PrismaClient({
        log: ['error', 'warn'],
    });
} else {
    // In development, reuse the prisma instance across hot-reloads
    if (!global.__prisma) {
        global.__prisma = new PrismaClient({
            log: ['query', 'error', 'warn'],
        });
    }
    prisma = global.__prisma;
}

module.exports = prisma;
