import * as fs from 'fs';
import * as path from 'path';

import { generateImageAsync } from '@expo/image-utils';

import {
  normalizeAndroidNotificationIcons,
  type NormalizedAndroidNotificationIconOptions,
} from '../options';
import type { ExpoConfigLike } from '../ios/withNotifyKitIosNseAppExtension';

export const ANDROID_NOTIFICATION_ICON_DENSITIES = [
  { density: 'mdpi', size: 24 },
  { density: 'hdpi', size: 36 },
  { density: 'xhdpi', size: 48 },
  { density: 'xxhdpi', size: 72 },
  { density: 'xxxhdpi', size: 96 },
] as const;

const NOTIFY_KIT_KEEP_FILE_NAME = 'notifykit_keep.xml';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type DangerousModConfig<TConfig extends ExpoConfigLike> = TConfig & {
  modRequest: {
    projectRoot: string;
    platformProjectRoot: string;
    [key: string]: unknown;
  };
};

type WithDangerousMod = <TConfig extends ExpoConfigLike>(
  config: TConfig,
  action: [
    'android',
    (
      config: DangerousModConfig<TConfig>,
    ) => DangerousModConfig<TConfig> | Promise<DangerousModConfig<TConfig>>,
  ],
) => TConfig;

interface PreparedAndroidNotificationIcon {
  icon: NormalizedAndroidNotificationIconOptions;
  sourcePath: string;
}

interface GeneratedAndroidNotificationIcon {
  outputPath: string;
  source: Buffer;
}

declare const require: {
  (id: string): unknown;
  resolve(id: string, options?: { paths?: string[] }): string;
};

declare const process: {
  cwd(): string;
};

export function withNotifyKitAndroidNotificationIcons<TConfig extends ExpoConfigLike>(
  config: TConfig,
  icons: NormalizedAndroidNotificationIconOptions[],
): TConfig {
  if (icons.length === 0) {
    return config;
  }

  const { withDangerousMod } = requireExpoConfigPlugins();

  return withDangerousMod(config, [
    'android',
    async modConfig => {
      await generateNotifyKitAndroidNotificationIconResources(
        modConfig.modRequest.projectRoot,
        modConfig.modRequest.platformProjectRoot,
        icons,
      );

      return modConfig;
    },
  ]);
}

export async function generateNotifyKitAndroidNotificationIconResources(
  projectRoot: string,
  platformProjectRoot: string,
  icons: NormalizedAndroidNotificationIconOptions[],
): Promise<void> {
  const normalizedIcons = normalizeAndroidNotificationIcons(icons);

  if (normalizedIcons.length === 0) {
    return;
  }

  const preparedIcons = normalizedIcons.map(icon => {
    const sourcePath = resolveAndroidNotificationIconSource(projectRoot, icon);
    validateAndroidNotificationIconPngSignature(icon, sourcePath);

    return { icon, sourcePath };
  });
  const { resolvedPlatformProjectRoot, canonicalPlatformProjectRoot } =
    resolveAndroidPlatformProjectRoot(platformProjectRoot);
  const resourceRoot = path.join(resolvedPlatformProjectRoot, 'app', 'src', 'main', 'res');
  const outputPaths = getAndroidNotificationIconOutputPaths(resourceRoot, preparedIcons);

  validateAndroidOutputDestinations(
    resolvedPlatformProjectRoot,
    canonicalPlatformProjectRoot,
    outputPaths,
  );
  validateAndroidResourceCollisions(resolvedPlatformProjectRoot, resourceRoot, preparedIcons);
  validateKeepFileDestination(resourceRoot);

  const generatedIcons = await generateAllAndroidNotificationIconBuffers(
    projectRoot,
    resourceRoot,
    preparedIcons,
  );

  prepareAndroidOutputDirectories(
    resolvedPlatformProjectRoot,
    canonicalPlatformProjectRoot,
    outputPaths,
  );

  for (const generatedIcon of generatedIcons) {
    fs.writeFileSync(generatedIcon.outputPath, generatedIcon.source);
  }

  const keepFilePath = path.join(resourceRoot, 'raw', NOTIFY_KIT_KEEP_FILE_NAME);
  fs.writeFileSync(keepFilePath, renderNotifyKitAndroidNotificationIconsKeepXml(normalizedIcons));
}

export function renderNotifyKitAndroidNotificationIconsKeepXml(
  icons: NormalizedAndroidNotificationIconOptions[],
): string {
  const resources = icons.map(icon => `@drawable/${icon.name}`).join(',');

  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<resources xmlns:tools="http://schemas.android.com/tools"\n' +
    `    tools:keep="${resources}" />\n`
  );
}

function resolveAndroidNotificationIconSource(
  projectRoot: string,
  icon: NormalizedAndroidNotificationIconOptions,
): string {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedSourcePath = path.resolve(resolvedProjectRoot, icon.path);

  if (!isPathInside(resolvedProjectRoot, resolvedSourcePath)) {
    throw new Error(
      `[react-native-notify-kit] android.icons source '${icon.path}' for '${icon.name}' ` +
        'resolves outside the Expo project root.',
    );
  }

  if (!fs.existsSync(resolvedSourcePath)) {
    throw new Error(
      `[react-native-notify-kit] android.icons source does not exist for '${icon.name}': ${resolvedSourcePath}`,
    );
  }

  let sourceStats: fs.Stats;
  try {
    sourceStats = fs.statSync(resolvedSourcePath);
  } catch (error) {
    throw new Error(
      `[react-native-notify-kit] Unable to inspect android.icons source for '${icon.name}': ` +
        `${resolvedSourcePath}. ${formatError(error)}`,
    );
  }

  if (!sourceStats.isFile()) {
    throw new Error(
      `[react-native-notify-kit] android.icons source for '${icon.name}' must be a file: ${resolvedSourcePath}`,
    );
  }

  try {
    fs.accessSync(resolvedSourcePath, fs.constants.R_OK);
  } catch (error) {
    throw new Error(
      `[react-native-notify-kit] android.icons source for '${icon.name}' is not readable: ` +
        `${resolvedSourcePath}. ${formatError(error)}`,
    );
  }

  const realProjectRoot = fs.realpathSync(resolvedProjectRoot);
  const realSourcePath = fs.realpathSync(resolvedSourcePath);
  if (!isPathInside(realProjectRoot, realSourcePath)) {
    throw new Error(
      `[react-native-notify-kit] android.icons source '${icon.path}' for '${icon.name}' ` +
        'resolves outside the Expo project root through a symbolic link.',
    );
  }

  return resolvedSourcePath;
}

function validateAndroidNotificationIconPngSignature(
  icon: NormalizedAndroidNotificationIconOptions,
  sourcePath: string,
): void {
  let sourceHeader: Buffer;
  try {
    sourceHeader = fs.readFileSync(sourcePath).subarray(0, PNG_SIGNATURE.length);
  } catch (error) {
    throw new Error(
      `[react-native-notify-kit] Unable to read android.icons source content for '${icon.name}' ` +
        `from '${icon.path}' (${sourcePath}): ${formatError(error)}`,
    );
  }

  if (sourceHeader.length !== PNG_SIGNATURE.length || !sourceHeader.equals(PNG_SIGNATURE)) {
    throw new Error(
      `[react-native-notify-kit] android.icons source content for '${icon.name}' from ` +
        `'${icon.path}' (${sourcePath}) is not a valid PNG: the PNG signature is missing.`,
    );
  }
}

function resolveAndroidPlatformProjectRoot(platformProjectRoot: string): {
  resolvedPlatformProjectRoot: string;
  canonicalPlatformProjectRoot: string;
} {
  const resolvedPlatformProjectRoot = path.resolve(platformProjectRoot);
  let platformProjectRootStats: fs.Stats;
  let canonicalPlatformProjectRoot: string;

  try {
    platformProjectRootStats = fs.statSync(resolvedPlatformProjectRoot);
    canonicalPlatformProjectRoot = fs.realpathSync(resolvedPlatformProjectRoot);
  } catch (error) {
    throw new Error(
      `[react-native-notify-kit] Unable to inspect Android platform project root ` +
        `${resolvedPlatformProjectRoot}: ${formatError(error)}`,
    );
  }

  if (!platformProjectRootStats.isDirectory()) {
    throw new Error(
      `[react-native-notify-kit] Android platform project root is not a directory: ` +
        resolvedPlatformProjectRoot,
    );
  }

  return { resolvedPlatformProjectRoot, canonicalPlatformProjectRoot };
}

function getAndroidNotificationIconOutputPaths(
  resourceRoot: string,
  preparedIcons: PreparedAndroidNotificationIcon[],
): string[] {
  const outputPaths = preparedIcons.flatMap(({ icon }) =>
    ANDROID_NOTIFICATION_ICON_DENSITIES.map(({ density }) =>
      path.join(resourceRoot, `drawable-${density}`, `${icon.name}.png`),
    ),
  );

  outputPaths.push(path.join(resourceRoot, 'raw', NOTIFY_KIT_KEEP_FILE_NAME));
  return outputPaths;
}

function validateAndroidOutputDestinations(
  resolvedPlatformProjectRoot: string,
  canonicalPlatformProjectRoot: string,
  outputPaths: string[],
): void {
  for (const outputPath of outputPaths) {
    validateAndroidOutputDestination(
      resolvedPlatformProjectRoot,
      canonicalPlatformProjectRoot,
      outputPath,
    );
  }
}

function validateAndroidOutputDestination(
  resolvedPlatformProjectRoot: string,
  canonicalPlatformProjectRoot: string,
  outputPath: string,
): void {
  const resolvedOutputPath = path.resolve(outputPath);
  if (!isPathInside(resolvedPlatformProjectRoot, resolvedOutputPath)) {
    throw new Error(
      `[react-native-notify-kit] Android output destination resolves outside the platform ` +
        `project root: ${resolvedOutputPath}`,
    );
  }

  const relativeOutputPath = path.relative(resolvedPlatformProjectRoot, resolvedOutputPath);
  const pathComponents = relativeOutputPath.split(path.sep).filter(Boolean);
  let currentPath = resolvedPlatformProjectRoot;

  for (const [index, pathComponent] of pathComponents.entries()) {
    currentPath = path.join(currentPath, pathComponent);
    const currentStats = lstatAndroidOutputPathIfExists(currentPath);
    if (currentStats === undefined) {
      return;
    }

    if (currentStats.isSymbolicLink()) {
      throw new Error(
        `[react-native-notify-kit] Android output destination must not contain a symbolic link: ` +
          currentPath,
      );
    }

    const isFinalComponent = index === pathComponents.length - 1;
    if (!isFinalComponent && !currentStats.isDirectory()) {
      throw new Error(
        `[react-native-notify-kit] Android output destination path component is not a directory: ` +
          currentPath,
      );
    }

    if (currentStats.isDirectory()) {
      let canonicalDirectoryPath: string;
      try {
        canonicalDirectoryPath = fs.realpathSync(currentPath);
      } catch (error) {
        throw new Error(
          `[react-native-notify-kit] Unable to resolve Android output directory ${currentPath}: ` +
            formatError(error),
        );
      }

      if (!isPathInside(canonicalPlatformProjectRoot, canonicalDirectoryPath)) {
        throw new Error(
          `[react-native-notify-kit] Android output directory resolves outside the canonical ` +
            `platform project root: ${currentPath}`,
        );
      }
    }
  }
}

function lstatAndroidOutputPathIfExists(outputPath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw new Error(
      `[react-native-notify-kit] Unable to inspect Android output destination ${outputPath}: ` +
        formatError(error),
    );
  }
}

function prepareAndroidOutputDirectories(
  resolvedPlatformProjectRoot: string,
  canonicalPlatformProjectRoot: string,
  outputPaths: string[],
): void {
  const outputDirectories = [...new Set(outputPaths.map(outputPath => path.dirname(outputPath)))];
  for (const outputDirectory of outputDirectories) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  validateAndroidOutputDestinations(
    resolvedPlatformProjectRoot,
    canonicalPlatformProjectRoot,
    outputPaths,
  );
}

function validateAndroidResourceCollisions(
  platformProjectRoot: string,
  resourceRoot: string,
  preparedIcons: PreparedAndroidNotificationIcon[],
): void {
  const sourceSetRoot = path.join(platformProjectRoot, 'app', 'src');
  const mipmapDirectories = findResourceDirectories(sourceSetRoot, 'mipmap');

  for (const { icon } of preparedIcons) {
    for (const mipmapDirectory of mipmapDirectories) {
      const collision = findLogicalResourceCollision(mipmapDirectory, icon.name);
      if (collision !== undefined) {
        throw new Error(
          `[react-native-notify-kit] Android mipmap resource collision for '${icon.name}': ` +
            `${collision}. Remove or rename the mipmap resource before generating a drawable icon.`,
        );
      }
    }

    for (const { density } of ANDROID_NOTIFICATION_ICON_DENSITIES) {
      const drawableDirectory = path.join(resourceRoot, `drawable-${density}`);
      validateDrawableDestination(drawableDirectory, icon.name);
    }
  }
}

function findResourceDirectories(sourceSetRoot: string, resourceType: string): string[] {
  if (!fs.existsSync(sourceSetRoot)) {
    return [];
  }

  const directories: string[] = [];
  for (const sourceSet of fs.readdirSync(sourceSetRoot, { withFileTypes: true })) {
    if (!sourceSet.isDirectory()) {
      continue;
    }

    const sourceSetResourceRoot = path.join(sourceSetRoot, sourceSet.name, 'res');
    if (
      !fs.existsSync(sourceSetResourceRoot) ||
      !fs.statSync(sourceSetResourceRoot).isDirectory()
    ) {
      continue;
    }

    for (const qualifier of fs.readdirSync(sourceSetResourceRoot, { withFileTypes: true })) {
      if (
        qualifier.isDirectory() &&
        (qualifier.name === resourceType || qualifier.name.startsWith(`${resourceType}-`))
      ) {
        directories.push(path.join(sourceSetResourceRoot, qualifier.name));
      }
    }
  }

  return directories;
}

function findLogicalResourceCollision(
  resourceDirectory: string,
  resourceName: string,
): string | undefined {
  for (const entry of fs.readdirSync(resourceDirectory, { withFileTypes: true })) {
    if (
      (entry.isFile() || entry.isSymbolicLink()) &&
      hasLogicalResourceName(entry.name, resourceName)
    ) {
      return path.join(resourceDirectory, entry.name);
    }
  }

  return undefined;
}

function validateDrawableDestination(drawableDirectory: string, resourceName: string): void {
  if (!fs.existsSync(drawableDirectory)) {
    return;
  }

  if (!fs.statSync(drawableDirectory).isDirectory()) {
    throw new Error(
      `[react-native-notify-kit] Android drawable destination is not a directory: ${drawableDirectory}`,
    );
  }

  const exactPngName = `${resourceName}.png`;
  for (const entry of fs.readdirSync(drawableDirectory, { withFileTypes: true })) {
    if (!hasLogicalResourceName(entry.name, resourceName)) {
      continue;
    }

    const collisionPath = path.join(drawableDirectory, entry.name);
    if (entry.name === exactPngName && entry.isFile()) {
      continue;
    }

    throw new Error(
      `[react-native-notify-kit] Android drawable resource collision for '${resourceName}': ` +
        `${collisionPath}. Only the exact ${exactPngName} destination may be overwritten.`,
    );
  }
}

function validateKeepFileDestination(resourceRoot: string): void {
  const rawDirectory = path.join(resourceRoot, 'raw');
  if (fs.existsSync(rawDirectory) && !fs.statSync(rawDirectory).isDirectory()) {
    throw new Error(
      `[react-native-notify-kit] Android raw resource destination is not a directory: ${rawDirectory}`,
    );
  }

  const keepFilePath = path.join(rawDirectory, NOTIFY_KIT_KEEP_FILE_NAME);
  if (fs.existsSync(keepFilePath) && !fs.statSync(keepFilePath).isFile()) {
    throw new Error(
      `[react-native-notify-kit] NotifyKit keep file destination is not a file: ${keepFilePath}`,
    );
  }
}

async function generateAllAndroidNotificationIconBuffers(
  projectRoot: string,
  resourceRoot: string,
  preparedIcons: PreparedAndroidNotificationIcon[],
): Promise<GeneratedAndroidNotificationIcon[]> {
  const generatedIcons: GeneratedAndroidNotificationIcon[] = [];

  for (const { icon, sourcePath } of preparedIcons) {
    for (const { density, size } of ANDROID_NOTIFICATION_ICON_DENSITIES) {
      try {
        const generatedImage = await generateImageAsync(
          { projectRoot },
          {
            src: sourcePath,
            name: `${icon.name}.png`,
            width: size,
            height: size,
            resizeMode: 'cover',
            backgroundColor: 'transparent',
          },
        );

        generatedIcons.push({
          outputPath: path.join(resourceRoot, `drawable-${density}`, `${icon.name}.png`),
          source: generatedImage.source,
        });
      } catch (error) {
        throw new Error(
          `[react-native-notify-kit] Unable to generate Android notification icon '${icon.name}' ` +
            `from '${icon.path}' at ${size}x${size}: ${formatError(error)}`,
        );
      }
    }
  }

  return generatedIcons;
}

function hasLogicalResourceName(fileName: string, resourceName: string): boolean {
  return fileName === resourceName || fileName.startsWith(`${resourceName}.`);
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);

  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireExpoConfigPlugins(): {
  withDangerousMod: WithDangerousMod;
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
