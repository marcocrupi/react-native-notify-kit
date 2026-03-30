const rnPreset = require('./node_modules/react-native/jest-preset.js');

module.exports = {
  maxConcurrency: 30,
  ...rnPreset,
  transform: {
    '^.+\\.(js)$': require.resolve('babel-jest'),
    '\\.(ts|tsx)$': require.resolve('ts-jest'),
  },
  globals: {
    'ts-jest': {
      tsconfig: require('path').resolve(__dirname, 'tsconfig.jest.json'),
      diagnostics: false,
    },
  },
  rootDir: '..',
  testMatch: [
    '<rootDir>/tests_react_native/__tests__/**/*.test.ts',
    '<rootDir>/packages/react-native/plugin/__tests__/**/*.test.ts',
  ],
  modulePaths: ['node_modules', '<rootDir>/tests_react_native/node_modules'],
  collectCoverage: true,

  collectCoverageFrom: [
    '<rootDir>/packages/react-native/src/**/*.{ts,tsx}',
    '<rootDir>/packages/react-native/plugin/**/*.{ts,tsx}',
    '!**/node_modules/**',
    '!**/vendor/**',
  ],

  setupFilesAfterEnv: ['<rootDir>/tests_react_native/jest-mock.js'],

  moduleFileExtensions: ['ts', 'tsx', 'js'],
};
