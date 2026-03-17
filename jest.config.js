module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!**/node_modules/**',
  ],
  testTimeout: 10000,
  moduleNameMapper: {
    // Intercept all prisma imports regardless of relative path depth
    '(.*)/lib/prisma$': '<rootDir>/tests/__mocks__/prisma',
    // Mock WebSocket to prevent open handles
    '^ws$': '<rootDir>/tests/__mocks__/ws',
  },
};
