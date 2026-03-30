import reactNativeConfig from '@react-native/eslint-config/flat';
import tseslint from 'typescript-eslint';
import eslintPluginPrettier from 'eslint-plugin-prettier/recommended';

// Filter out the Flow plugin config (eslint-plugin-ft-flow uses deprecated
// context.getAllComments() API incompatible with ESLint v9, and this project
// has no Flow files — all TypeScript)
const rnConfigWithoutFlow = reactNativeConfig.filter(
  config => !(config.plugins && 'ft-flow' in config.plugins),
);

export default tseslint.config(
  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/docs/**',
      '**/android/**',
      '**/ios/**',
      'scripts/**',
      '**/plugin/build/**',
      'sendPushNotification.js',
      '**/version.ts',
      '**/version.js',
    ],
  },

  // React Native community flat config (minus Flow plugin)
  ...rnConfigWithoutFlow,

  // TypeScript-eslint recommended rules
  ...tseslint.configs.recommended,

  // Prettier (must be last to override formatting rules)
  eslintPluginPrettier,

  // Project-specific overrides
  {
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      camelcase: 'off',
      'react/jsx-uses-vars': 'warn',
      'jest/no-identical-title': 'off',
      'eslint-comments/no-unlimited-disable': 'off',
    },
  },

  // CommonJS files (config files, scripts — Node.js globals)
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        exports: 'readonly',
        path: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Test files
  {
    files: ['tests_react_native/**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // packages/react-native/src overrides
  {
    files: ['packages/react-native/src/**/*.ts'],
    rules: {
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
    },
  },

  // TurboModule spec files intentionally use Object in the codegen surface.
  {
    files: ['packages/react-native/src/specs/**/*.ts'],
    rules: {
      '@typescript-eslint/no-wrapper-object-types': 'off',
    },
  },

  // React Native 0.84 no longer exports a compatible top-level EventEmitter type.
  {
    files: ['packages/react-native/src/NotifeeJSEventEmitter.ts'],
    rules: {
      '@react-native/no-deep-imports': 'off',
    },
  },
);
