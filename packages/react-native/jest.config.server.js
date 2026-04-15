const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname, 'server/src'),
  coverageDirectory: path.resolve(__dirname, 'server/coverage'),
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      require.resolve('ts-jest'),
      {
        tsconfig: path.resolve(__dirname, 'server/tsconfig.json'),
        diagnostics: true,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js'],
  collectCoverageFrom: [
    '<rootDir>/**/*.ts',
    '!<rootDir>/__tests__/**',
    '!<rootDir>/types.ts',
    '!<rootDir>/index.ts',
  ],
  coverageThreshold: {
    global: { branches: 90, functions: 95, lines: 95, statements: 95 },
  },
};
