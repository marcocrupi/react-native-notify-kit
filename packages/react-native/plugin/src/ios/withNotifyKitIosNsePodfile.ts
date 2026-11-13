import * as fs from 'fs';
import * as path from 'path';

import type { NormalizedIosNotificationServiceExtensionOptions } from '../options';
import { patchPodfileForNotifyKitNse } from '../shared/nse/patchPodfile';
import type { ExpoConfigLike } from './withNotifyKitIosNseAppExtension';

type PodfileUseFrameworks = false | true | 'static' | 'dynamic';
type ActivePodfileUseFrameworks = Exclude<PodfileUseFrameworks, false>;

interface PodfileUseFrameworksDetectionOptions {
  ignoredTargetName?: string;
  podfileProperties?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}

type PodfileModConfig<TConfig extends ExpoConfigLike> = TConfig & {
  modRequest: {
    projectRoot: string;
    platformProjectRoot: string;
    [key: string]: unknown;
  };
  modResults: {
    contents: string;
    [key: string]: unknown;
  };
};

type WithPodfile = <TConfig extends ExpoConfigLike>(
  config: TConfig,
  action: (
    config: PodfileModConfig<TConfig>,
  ) => PodfileModConfig<TConfig> | Promise<PodfileModConfig<TConfig>>,
) => TConfig;

declare const require: {
  (id: string): unknown;
  resolve(id: string, options?: { paths?: string[] }): string;
};

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

export function withNotifyKitIosNsePodfile<TConfig extends ExpoConfigLike>(
  config: TConfig,
  nseOptions: NormalizedIosNotificationServiceExtensionOptions,
): TConfig {
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
    const result = patchPodfileForNotifyKitNse(modConfig.modResults.contents, {
      targetName: nseOptions.targetName,
      packagePathFromIos,
      placement: 'topLevel',
      useFrameworks,
    });

    modConfig.modResults.contents = result.contents;
    return modConfig;
  });
}

export function resolveNotifyKitPackagePathFromIos(
  projectRoot: string,
  platformProjectRoot: string,
): string {
  const packageJsonPath = require.resolve('react-native-notify-kit/package.json', {
    paths: [projectRoot],
  });
  const packageDir = path.dirname(packageJsonPath);

  return normalizePodfilePath(path.relative(platformProjectRoot, packageDir));
}

export function normalizePodfilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function detectPodfileUseFrameworks(
  contents: string,
  optionsOrIgnoredTargetName?: string | PodfileUseFrameworksDetectionOptions,
): PodfileUseFrameworks {
  const options =
    typeof optionsOrIgnoredTargetName === 'string'
      ? { ignoredTargetName: optionsOrIgnoredTargetName }
      : (optionsOrIgnoredTargetName ?? {});
  const targetBlocks = findTargetBlocks(contents);
  const firstHostTarget = targetBlocks.find(
    block => block.targetName !== options.ignoredTargetName,
  );
  let globalUseFrameworks: PodfileUseFrameworks = false;
  let hostUseFrameworks: PodfileUseFrameworks = false;
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

function readExpoPodfileProperties(platformProjectRoot: string): Record<string, unknown> {
  const propertiesPath = path.join(platformProjectRoot, 'Podfile.properties.json');

  try {
    const parsed = JSON.parse(fs.readFileSync(propertiesPath, 'utf8')) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }

    throw error;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return isPlainObject(error) && error.code === 'ENOENT';
}

function resolveNseUseFrameworks(
  hostUseFrameworks: PodfileUseFrameworks,
  configuredUseFrameworks: PodfileUseFrameworks,
): PodfileUseFrameworks {
  if (hostUseFrameworks === false) {
    return false;
  }

  if (hostUseFrameworks === true && configuredUseFrameworks !== false) {
    return configuredUseFrameworks;
  }

  return hostUseFrameworks;
}

function detectConfiguredExpoBuildPropertiesUseFrameworks(
  config: ExpoConfigLike,
): PodfileUseFrameworks {
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  let detected: PodfileUseFrameworks = false;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface PodfileTargetBlock {
  targetName: string;
  startIndex: number;
  endIndex: number;
}

function findTargetBlocks(contents: string): PodfileTargetBlock[] {
  const targetPattern = /^[ \t]*target\s+['"]([^'"]+)['"]\s+do\b.*$/gm;
  const blocks: PodfileTargetBlock[] = [];
  let match: RegExpExecArray | null;

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

function findMostSpecificTargetBlock(
  targetBlocks: PodfileTargetBlock[],
  charIndex: number,
): PodfileTargetBlock | undefined {
  return targetBlocks
    .filter(block => charIndex >= block.startIndex && charIndex < block.endIndex)
    .sort((a, b) => b.startIndex - a.startIndex)[0];
}

function parseUseFrameworksLine(
  line: string,
  options: PodfileUseFrameworksDetectionOptions,
): ActivePodfileUseFrameworks | null {
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

function mergeUseFrameworksDetection(
  current: PodfileUseFrameworks,
  detected: ActivePodfileUseFrameworks,
): PodfileUseFrameworks {
  return detected;
}

function isUseFrameworksConditionActive(
  strippedLine: string,
  options: PodfileUseFrameworksDetectionOptions,
): boolean {
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

function getPodfilePropertyUseFrameworksLinkage(
  strippedLine: string,
  options: PodfileUseFrameworksDetectionOptions,
): ActivePodfileUseFrameworks | null {
  const propertyName = strippedLine.match(
    /(?:\:linkage\s*=>|linkage:)\s*podfile_properties\[['"]([^'"]+)['"]\](?:\.to_sym)?/,
  )?.[1];

  return propertyName
    ? normalizeUseFrameworksValue(options.podfileProperties?.[propertyName])
    : null;
}

function getEnvUseFrameworksLinkage(
  strippedLine: string,
  options: PodfileUseFrameworksDetectionOptions,
): ActivePodfileUseFrameworks | null {
  const envName = strippedLine.match(
    /(?:\:linkage\s*=>|linkage:)\s*ENV\[['"]([^'"]+)['"]\](?:\.to_sym)?/,
  )?.[1];

  return envName ? normalizeUseFrameworksValue(options.env?.[envName]) : null;
}

function normalizeUseFrameworksValue(value: unknown): ActivePodfileUseFrameworks | null {
  if (value === 'static' || value === 'dynamic' || value === true) {
    return value;
  }

  return null;
}

function getPodfilePropertyName(expression: string): string | null {
  return expression.match(/^podfile_properties\[['"]([^'"]+)['"]\]$/)?.[1] ?? null;
}

function getEnvName(expression: string): string | null {
  return expression.match(/^ENV\[['"]([^'"]+)['"]\]$/)?.[1] ?? null;
}

function isRubyTruthy(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

function findLineEnd(content: string, lineStartIndex: number): number {
  const newlineIndex = content.indexOf('\n', lineStartIndex);
  return newlineIndex === -1 ? content.length : newlineIndex + 1;
}

function findMatchingRubyBlockEnd(content: string, startIndex: number): number {
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

function countRubyBlockOpeners(line: string): number {
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

function stripRubyLineComment(line: string): string {
  return line.replace(/#.*$/, '');
}

function requireExpoConfigPlugins(): {
  withPodfile: WithPodfile;
} {
  try {
    return require('expo/config-plugins') as ReturnType<typeof requireExpoConfigPlugins>;
  } catch (error) {
    try {
      const expoConfigPluginsPath = require.resolve('expo/config-plugins', {
        paths: [process.cwd()],
      });

      return require(expoConfigPluginsPath) as ReturnType<typeof requireExpoConfigPlugins>;
    } catch {
      throw error;
    }
  }
}
