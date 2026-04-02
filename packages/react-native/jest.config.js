const path = require('path');

const rnPreset = require('react-native/jest-preset');

module.exports = {
  ...rnPreset,
  transform: {
    '^.+\\.(js|jsx)$': require.resolve('babel-jest'),
    '\\.(ts|tsx)$': [
      require.resolve('ts-jest'),
      {
        tsconfig: path.resolve(__dirname, 'tsconfig.jest.json'),
        diagnostics: false,
      },
    ],
  },
  rootDir: '.',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^react-native-notify-kit/src/(.*)$': '<rootDir>/src/$1',
    '^react-native-notify-kit/(.*)$': '<rootDir>/$1',
    '^react-native-notify-kit$': '<rootDir>/src/index.ts',
  },
  collectCoverage: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,tsx}', '!**/node_modules/**', '!**/vendor/**'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/jest-setup.js'],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
};
