import * as fs from 'fs';
import * as path from 'path';
import xcode from 'xcode';

export interface ProjectInfo {
  xcodeProjectPath: string;
  pbxprojPath: string;
  iosDir: string;
  parentBundleId: string | null;
  parentTargetName: string;
}

/**
 * Detects the iOS project directory and parses key metadata.
 */
export function detectIosProject(iosPath?: string): ProjectInfo {
  const iosDir = iosPath ?? path.join(process.cwd(), 'ios');

  if (!fs.existsSync(iosDir)) {
    throw new Error(
      `Could not find iOS directory at ${iosDir}\n` +
        '  Run this command from the root of your React Native project, or use --ios-path.',
    );
  }

  const entries = fs.readdirSync(iosDir);
  const xcodeProjects = entries.filter(e => e.endsWith('.xcodeproj'));

  if (xcodeProjects.length === 0) {
    throw new Error(
      `Could not find .xcodeproj under ${iosDir}\n` +
        '  Run this command from the root of your React Native project, or use --ios-path.',
    );
  }

  if (xcodeProjects.length > 1) {
    throw new Error(
      `Multiple .xcodeproj found under ${iosDir}:\n` +
        xcodeProjects.map(p => `  - ${p}`).join('\n') +
        '\n  Use --ios-path to specify the correct project.',
    );
  }

  const xcodeProjectPath = path.join(iosDir, xcodeProjects[0]);
  const pbxprojPath = path.join(xcodeProjectPath, 'project.pbxproj');

  if (!fs.existsSync(pbxprojPath)) {
    throw new Error(`project.pbxproj not found at ${pbxprojPath}`);
  }

  const { bundleId, targetName } = readParentTarget(pbxprojPath);

  return {
    xcodeProjectPath,
    pbxprojPath,
    iosDir,
    parentBundleId: bundleId,
    parentTargetName: targetName,
  };
}

/**
 * Derives the NSE bundle ID from the parent target.
 */
export function deriveBundleId(parentBundleId: string | null, suffix: string): string {
  if (!parentBundleId || parentBundleId.includes('$(')) {
    // Variable-based bundle ID — can't derive statically.
    // Return a placeholder; the user must set it in Xcode.
    return `$(PRODUCT_BUNDLE_IDENTIFIER:default)${suffix}`;
  }
  return parentBundleId + suffix;
}

function readParentTarget(pbxprojPath: string): {
  bundleId: string | null;
  targetName: string;
} {
  const proj = xcode.project(pbxprojPath);
  proj.parseSync();

  const targets = proj.pbxNativeTargetSection();
  let targetName = 'MyApp';
  let bundleId: string | null = null;

  for (const [, value] of Object.entries(targets)) {
    if (typeof value !== 'object' || !(value as Record<string, unknown>).name) {
      continue;
    }
    const target = value as Record<string, unknown>;
    const name = String(target.name).replace(/"/g, '');
    const productType = String(target.productType ?? '');

    // Only look at the main app target (not extensions, test targets)
    if (productType.includes('application')) {
      targetName = name;

      // Read bundle ID from the first build configuration
      const configListRef = target.buildConfigurationList as string | undefined;
      if (configListRef) {
        const configs = proj.pbxXCBuildConfigurationSection();
        for (const [, cfg] of Object.entries(configs)) {
          if (typeof cfg !== 'object') continue;
          const config = cfg as Record<string, unknown>;
          const settings = config.buildSettings as Record<string, string> | undefined;
          if (settings?.PRODUCT_BUNDLE_IDENTIFIER) {
            bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER.replace(/"/g, '');
            break;
          }
        }
      }
      break;
    }
  }

  return { bundleId, targetName };
}
