// Global test setup
const prisma = require('./__mocks__/prisma');

afterAll(async () => {
  await prisma.$disconnect();
});
