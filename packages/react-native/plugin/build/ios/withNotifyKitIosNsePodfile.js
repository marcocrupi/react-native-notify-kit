'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.withNotifyKitIosNsePodfile = withNotifyKitIosNsePodfile;
exports.resolveNotifyKitPackagePathFromIos = resolveNotifyKitPackagePathFromIos;
exports.normalizePodfilePath = normalizePodfilePath;
exports.detectPodfileUseFrameworks = detectPodfileUseFrameworks;
const fs = require('fs');
const path = require('path');
const patchPodfile_1 = require('../shared/nse/patchPodfile');
function withNotifyKitIosNsePodfile(config, nseOptions) {
  if (!nseOptions.enabled) {
    return config;
  }
  const { withPodfile } = requireExpoConfigPlugins();
  const configuredUseFrameworks = detectConfiguredExpoBuildPropertiesUseFrameworks(config);
  return withPodfile(config, modConfig => {
    const { projectRoot, platformProjectRoot } = modConfig.modRequest;
    const packagePathFromIos = resolveNotifyKitPackagePathFromIos(projectRoot, platformProjectRoot);
    // Podfile mods can run before expo-build-properties writes its properties
    // mod. Read the configuration that the host will consume at pod install,
    // rather than a missing/stale file left by a clean/incremental prebuild.
    const podfileProperties = readExpoPodfileProperties(platformProjectRoot);
    if (configuredUseFrameworks === 'static' || configuredUseFrameworks === 'dynamic') {
      podfileProperties['ios.useFrameworks'] = configuredUseFrameworks;
    }
    const hostUseFrameworks = detectPodfileUseFrameworks(modConfig.modResults.contents, {
      ignoredTargetName: nseOptions.targetName,
      podfileProperties,
      env: process.env,
    });
    const useFrameworks = resolveNseUseFrameworks(hostUseFrameworks, configuredUseFrameworks);
    const result = (0, patchPodfile_1.patchPodfileForNotifyKitNse)(modConfig.modResults.contents, {
      targetName: nseOptions.targetName,
      packagePathFromIos,
      placement: 'topLevel',
      useFrameworks,
    });
    modConfig.modResults.contents = result.contents;
    return modConfig;
  });
}
function resolveNotifyKitPackagePathFromIos(projectRoot, platformProjectRoot) {
  const packageJsonPath = require.resolve('react-native-notify-kit/package.json', {
    paths: [projectRoot],
  });
  const packageDir = path.dirname(packageJsonPath);
  return normalizePodfilePath(path.relative(platformProjectRoot, packageDir));
}
function normalizePodfilePath(filePath) {
  return filePath.replace(/\\/g, '/');
}
function detectPodfileUseFrameworks(contents, optionsOrIgnoredTargetName) {
  const options =
    typeof optionsOrIgnoredTargetName === 'string'
      ? { ignoredTargetName: optionsOrIgnoredTargetName }
      : (optionsOrIgnoredTargetName ?? {});
  const targetBlocks = findTargetBlocks(contents);
  const firstHostTarget = targetBlocks.find(
    block => block.targetName !== options.ignoredTargetName,
  );
  let globalUseFrameworks = false;
  let hostUseFrameworks = false;
  let charIndex = 0;
  for (const line of contents.split('\n')) {
    const detectedUseFrameworks = parseUseFrameworksLine(line, options);
    if (detectedUseFrameworks === null) {
      charIndex += line.length + 1;
      continue;
    }
    const targetBlock = findMostSpecificTargetBlock(targetBlocks, charIndex);
    if (!targetBlock) {
      globalUseFrameworks = mergeUseFrameworksDetection(globalUseFrameworks, detectedUseFrameworks);
    } else if (targetBlock === firstHostTarget) {
      hostUseFrameworks = mergeUseFrameworksDetection(hostUseFrameworks, detectedUseFrameworks);
    }
    charIndex += line.length + 1;
  }
  return hostUseFrameworks !== false ? hostUseFrameworks : globalUseFrameworks;
}
function readExpoPodfileProperties(platformProjectRoot) {
  const propertiesPath = path.join(platformProjectRoot, 'Podfile.properties.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(propertiesPath, 'utf8'));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }
    throw error;
  }
}
function isFileNotFoundError(error) {
  return isPlainObject(error) && error.code === 'ENOENT';
}
function resolveNseUseFrameworks(hostUseFrameworks, configuredUseFrameworks) {
  if (hostUseFrameworks === false) {
    return false;
  }
  if (hostUseFrameworks === true && configuredUseFrameworks !== false) {
    return configuredUseFrameworks;
  }
  return hostUseFrameworks;
}
function detectConfiguredExpoBuildPropertiesUseFrameworks(config) {
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  let detected = false;
  for (const plugin of plugins) {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') {
      continue;
    }
    const options = isPlainObject(plugin[1]) ? plugin[1] : null;
    const ios = isPlainObject(options?.ios) ? options.ios : null;
    const useFrameworks = ios?.useFrameworks;
    if (useFrameworks === 'static' || useFrameworks === 'dynamic') {
      detected = useFrameworks;
    } else if (useFrameworks === true || useFrameworks === false) {
      detected = useFrameworks;
    }
  }
  return detected;
}
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function findTargetBlocks(contents) {
  const targetPattern = /^[ \t]*target\s+['"]([^'"]+)['"]\s+do\b.*$/gm;
  const blocks = [];
  let match;
  while ((match = targetPattern.exec(contents)) !== null) {
    const endLineStart = findMatchingRubyBlockEnd(contents, match.index);
    if (endLineStart === -1) {
      continue;
    }
    blocks.push({
      targetName: match[1],
      startIndex: match.index,
      endIndex: findLineEnd(contents, endLineStart),
    });
  }
  return blocks;
}
function findMostSpecificTargetBlock(targetBlocks, charIndex) {
  return targetBlocks
    .filter(block => charIndex >= block.startIndex && charIndex < block.endIndex)
    .sort((a, b) => b.startIndex - a.startIndex)[0];
}
function parseUseFrameworksLine(line, options) {
  const stripped = stripRubyLineComment(line).trim();
  if (!/^use_frameworks!(?:\s|$)/.test(stripped)) {
    return null;
  }
  if (!isUseFrameworksConditionActive(stripped, options)) {
    return null;
  }
  const podfilePropertyLinkage = getPodfilePropertyUseFrameworksLinkage(stripped, options);
  if (podfilePropertyLinkage !== null) {
    return podfilePropertyLinkage;
  }
  const envLinkage = getEnvUseFrameworksLinkage(stripped, options);
  if (envLinkage !== null) {
    return envLinkage;
  }
  if (/:linkage\s*=>\s*:static\b/.test(stripped) || /\blinkage:\s*:static\b/.test(stripped)) {
    return 'static';
  }
  if (/:linkage\s*=>\s*:dynamic\b/.test(stripped) || /\blinkage:\s*:dynamic\b/.test(stripped)) {
    return 'dynamic';
  }
  return true;
}
function mergeUseFrameworksDetection(current, detected) {
  return detected;
}
function isUseFrameworksConditionActive(strippedLine, options) {
  const condition = strippedLine.match(/\s+if\s+(.+)$/)?.[1]?.trim();
  if (!condition) {
    return true;
  }
  const podfilePropertyName = getPodfilePropertyName(condition);
  if (podfilePropertyName !== null) {
    return isRubyTruthy(options.podfileProperties?.[podfilePropertyName]);
  }
  const envName = getEnvName(condition);
  if (envName !== null) {
    return isRubyTruthy(options.env?.[envName]);
  }
  return true;
}
function getPodfilePropertyUseFrameworksLinkage(strippedLine, options) {
  const propertyName = strippedLine.match(
    /(?:\:linkage\s*=>|linkage:)\s*podfile_properties\[['"]([^'"]+)['"]\](?:\.to_sym)?/,
  )?.[1];
  return propertyName
    ? normalizeUseFrameworksValue(options.podfileProperties?.[propertyName])
    : null;
}
function getEnvUseFrameworksLinkage(strippedLine, options) {
  const envName = strippedLine.match(
    /(?:\:linkage\s*=>|linkage:)\s*ENV\[['"]([^'"]+)['"]\](?:\.to_sym)?/,
  )?.[1];
  return envName ? normalizeUseFrameworksValue(options.env?.[envName]) : null;
}
function normalizeUseFrameworksValue(value) {
  if (value === 'static' || value === 'dynamic' || value === true) {
    return value;
  }
  return null;
}
function getPodfilePropertyName(expression) {
  return expression.match(/^podfile_properties\[['"]([^'"]+)['"]\]$/)?.[1] ?? null;
}
function getEnvName(expression) {
  return expression.match(/^ENV\[['"]([^'"]+)['"]\]$/)?.[1] ?? null;
}
function isRubyTruthy(value) {
  return value !== undefined && value !== null && value !== false;
}
function findLineEnd(content, lineStartIndex) {
  const newlineIndex = content.indexOf('\n', lineStartIndex);
  return newlineIndex === -1 ? content.length : newlineIndex + 1;
}
function findMatchingRubyBlockEnd(content, startIndex) {
  const afterStart = content.slice(startIndex);
  const lines = afterStart.split('\n');
  let depth = 0;
  let charIndex = startIndex;
  for (const line of lines) {
    const trimmed = stripRubyLineComment(line).trim();
    depth += countRubyBlockOpeners(trimmed);
    if (trimmed === 'end') {
      depth--;
      if (depth === 0) {
        return charIndex;
      }
    }
    charIndex += line.length + 1;
  }
  return -1;
}
function countRubyBlockOpeners(line) {
  if (line.length === 0) {
    return 0;
  }
  const startsWithKeywordBlock = /^(if|unless|case|begin|while|until|for|def|class|module)\b/.test(
    line,
  );
  if (startsWithKeywordBlock) {
    return 1;
  }
  if (/\bdo\b(\s*\|[^|]*\|)?\s*$/.test(line)) {
    return 1;
  }
  return 0;
}
function stripRubyLineComment(line) {
  return line.replace(/#.*$/, '');
}
function requireExpoConfigPlugins() {
  try {
    return require('expo/config-plugins');
  } catch (error) {
    try {
      const expoConfigPluginsPath = require.resolve('expo/config-plugins', {
        paths: [process.cwd()],
      });
      return require(expoConfigPluginsPath);
    } catch {
      throw error;
    }
  }
}
