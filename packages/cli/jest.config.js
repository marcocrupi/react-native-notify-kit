/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/__tests__/**',
    '!**/templates/**',
    '!**/types/**',
    '!cli.ts',
  ],
  coverageThreshold: {
    global: { branches: 65, functions: 95, lines: 90, statements: 90 },
  },
};
