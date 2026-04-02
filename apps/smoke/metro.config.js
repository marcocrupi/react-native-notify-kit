const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const monorepoRoot = path.resolve(__dirname, '../..');
const smokeNodeModules = path.resolve(__dirname, 'node_modules');

// Escape path for use in RegExp (handles macOS / and Windows \)
const escape = (p) => p.replace(/[/\\]/g, '[/\\\\]');

const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      smokeNodeModules,
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    // Block duplicate react-native/react from packages/react-native/node_modules
    blockList: [
      new RegExp(
        escape(
          path.resolve(
            monorepoRoot,
            'packages/react-native/node_modules/react-native',
          ),
        ) + '/.*',
      ),
      new RegExp(
        escape(
          path.resolve(
            monorepoRoot,
            'packages/react-native/node_modules/react',
          ),
        ) + '/.*',
      ),
    ],
    // Force singleton resolution for these critical packages
    extraNodeModules: {
      'react-native': path.resolve(smokeNodeModules, 'react-native'),
      react: path.resolve(smokeNodeModules, 'react'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
