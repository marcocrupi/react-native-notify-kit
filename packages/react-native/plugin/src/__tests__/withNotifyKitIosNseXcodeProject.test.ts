/**
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';
import xcode from 'xcode';

import { patchXcodeProjectForNotifyKitNse } from '../shared/nse/patchXcodeProject';

const enabledOptions = {
  enabled: true,
  targetName: 'NotifyKitNSE',
  bundleSuffix: '.NotifyKitNSE',
};

const FIXTURE_PBXPROJ_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'c' + 'li',
  'src',
  '__tests__',
  'fixtures',
  'sample-rn-app',
  'ios',
  'MyApp.xcodeproj',
  'project.pbxproj',
);

const XCODE_BUILD_SETTING_KEYS = [
  'INFOPLIST_FILE',
  'PRODUCT_BUNDLE_IDENTIFIER',
  'TARGETED_DEVICE_FAMILY',
  'IPHONEOS_DEPLOYMENT_TARGET',
  'SWIFT_VERSION',
  'CODE_SIGN_ENTITLEMENTS',
  'GENERATE_INFOPLIST_FILE',
  'MARKETING_VERSION',
  'CURRENT_PROJECT_VERSION',
];

function parseFixtureProject(): ReturnType<typeof xcode.project> {
  const proj = xcode.project(FIXTURE_PBXPROJ_PATH);
  proj.parseSync();
  return proj;
}

function getNativeTarget(
  proj: ReturnType<typeof xcode.project>,
  targetName: string,
): { uuid: string; target: Record<string, unknown> } | undefined {
  for (const [uuid, value] of Object.entries(proj.pbxNativeTargetSection())) {
    if (typeof value !== 'object' || uuid.endsWith('_comment')) continue;
    const target = value as Record<string, unknown>;
    if (String(target.name ?? '').replace(/"/g, '') === targetName) {
      return { uuid, target };
    }
  }
  return undefined;
}

function countNativeTargets(proj: ReturnType<typeof xcode.project>, targetName: string): number {
  return Object.entries(proj.pbxNativeTargetSection()).filter(([, value]) => {
    if (typeof value !== 'object') return false;
    const target = value as Record<string, unknown>;
    return String(target.name ?? '').replace(/"/g, '') === targetName;
  }).length;
}

function getBuildSettingsByConfiguration(
  proj: ReturnType<typeof xcode.project>,
  targetProductName: string,
): Array<Record<string, string | undefined>> {
  return Object.entries(proj.pbxXCBuildConfigurationSection())
    .filter(([, value]) => typeof value === 'object')
    .map(([, value]) => value as Record<string, unknown>)
    .filter(config => {
      const settings = config.buildSettings as Record<string, string> | undefined;
      return settings?.PRODUCT_NAME === `"${targetProductName}"`;
    })
    .map(config => {
      const settings = config.buildSettings as Record<string, string>;
      const selected: Record<string, string | undefined> = {};
      for (const key of XCODE_BUILD_SETTING_KEYS) {
        selected[key] = settings[key]?.replace(/"/g, '');
      }
      return selected;
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function mutateVersionBuildSettings(
  proj: ReturnType<typeof xcode.project>,
  targetProductName: string,
  update: (settings: Record<string, string>) => void,
): number {
  let count = 0;

  for (const [, value] of Object.entries(proj.pbxXCBuildConfigurationSection())) {
    if (typeof value !== 'object') continue;
    const config = value as Record<string, unknown>;
    const settings = config.buildSettings as Record<string, string> | undefined;
    if (settings?.PRODUCT_NAME !== `"${targetProductName}"`) continue;

    update(settings);
    count += 1;
  }

  return count;
}

function getTargetDependencyCount(
  proj: ReturnType<typeof xcode.project>,
  hostTargetName: string,
  dependencyTargetName: string,
): number {
  const hostTarget = getNativeTarget(proj, hostTargetName);
  const dependencyTarget = getNativeTarget(proj, dependencyTargetName);
  if (!hostTarget || !dependencyTarget) return 0;

  const dependencies = Array.isArray(hostTarget.target.dependencies)
    ? hostTarget.target.dependencies
    : [];
  const dependencyObjects = (proj as any).hash.project.objects.PBXTargetDependency as
    | Record<string, unknown>
    | undefined;

  return dependencies.filter(depRef => {
    const depUuid = (depRef as Record<string, unknown>)?.value;
    if (typeof depUuid !== 'string') return false;
    const dependency = dependencyObjects?.[depUuid];
    if (typeof dependency !== 'object') return false;
    return (dependency as Record<string, unknown>).target === dependencyTarget.uuid;
  }).length;
}

function countSourceBuildFiles(
  proj: ReturnType<typeof xcode.project>,
  targetName: string,
  sourceComment: string,
): number {
  const target = getNativeTarget(proj, targetName);
  if (!target || !Array.isArray(target.target.buildPhases)) return 0;

  const sourcesPhaseRef = target.target.buildPhases.find(
    phase => (phase as Record<string, unknown>).comment === 'Sources',
  ) as Record<string, unknown> | undefined;
  const sourcesPhaseUuid = sourcesPhaseRef?.value;
  if (typeof sourcesPhaseUuid !== 'string') return 0;

  const phases = (proj as any).hash.project.objects.PBXSourcesBuildPhase as
    | Record<string, unknown>
    | undefined;
  const phase = phases?.[sourcesPhaseUuid] as Record<string, unknown> | undefined;
  const files = Array.isArray(phase?.files) ? phase.files : [];

  return files.filter(file => (file as Record<string, unknown>).comment === sourceComment).length;
}

function getTargetBuildPhaseCount(
  proj: ReturnType<typeof xcode.project>,
  targetName: string,
): number {
  const target = getNativeTarget(proj, targetName);
  return Array.isArray(target?.target.buildPhases) ? target.target.buildPhases.length : 0;
}

function getHostCopyFilesPhases(
  proj: ReturnType<typeof xcode.project>,
  hostTargetName: string,
): Array<Record<string, unknown>> {
  const hostTarget = getNativeTarget(proj, hostTargetName);
  if (!hostTarget || !Array.isArray(hostTarget.target.buildPhases)) return [];

  const copyFilesPhases = (proj as any).hash.project.objects.PBXCopyFilesBuildPhase as
    | Record<string, unknown>
    | undefined;
  if (!copyFilesPhases) return [];

  return hostTarget.target.buildPhases
    .map(phaseRef => {
      const phaseUuid = (phaseRef as Record<string, unknown>)?.value;
      return typeof phaseUuid === 'string'
        ? (copyFilesPhases[phaseUuid] as Record<string, unknown> | undefined)
        : undefined;
    })
    .filter((phase): phase is Record<string, unknown> => typeof phase === 'object');
}

function getShellScriptPhase(
  proj: ReturnType<typeof xcode.project>,
  phaseName: string,
): Record<string, unknown> | undefined {
  const phases = (proj as any).hash.project.objects.PBXShellScriptBuildPhase as
    | Record<string, unknown>
    | undefined;
  if (!phases) return undefined;
  for (const [, value] of Object.entries(phases)) {
    if (typeof value !== 'object') continue;
    const phase = value as Record<string, unknown>;
    if (String(phase.name ?? '').replace(/"/g, '') === phaseName) {
      return phase;
    }
  }
  return undefined;
}

describe('NotifyKit Expo Xcode project mod', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('leaves config unchanged and does not register withXcodeProject when NSE is disabled', async () => {
    const withXcodeProject = jest.fn();
    jest.doMock('expo/config-plugins', () => ({ withXcodeProject }), { virtual: true });

    const { withNotifyKitIosNseXcodeProject } =
      await import('../ios/withNotifyKitIosNseXcodeProject');
    const config = {};

    expect(
      withNotifyKitIosNseXcodeProject(config, {
        ...enabledOptions,
        enabled: false,
      }),
    ).toBe(config);
    expect(withXcodeProject).not.toHaveBeenCalled();
  });

  it('patches the Xcode project with default targetName, bundleIdentifier, dependency, and Copy Files phase', async () => {
    const withXcodeProject = jest.fn((config, action) =>
      action({
        ...config,
        modRequest: {
          projectName: 'NotifeeExample',
        },
        modResults: parseFixtureProject(),
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withXcodeProject }), { virtual: true });

    const { withNotifyKitIosNseXcodeProject } =
      await import('../ios/withNotifyKitIosNseXcodeProject');
    const config = withNotifyKitIosNseXcodeProject(
      {
        version: '8.0.0',
        ios: {
          bundleIdentifier: 'com.notifykit.exposmoke',
          buildNumber: '800',
        },
      },
      enabledOptions,
    );
    const proj = config.modResults;

    expect(withXcodeProject).toHaveBeenCalledTimes(1);
    expect(getNativeTarget(proj, 'NotifyKitNSE')).toBeDefined();
    expect(getBuildSettingsByConfiguration(proj, 'NotifyKitNSE')).toEqual([
      {
        CODE_SIGN_ENTITLEMENTS: 'NotifyKitNSE/NotifyKitNSE.entitlements',
        CURRENT_PROJECT_VERSION: '800',
        GENERATE_INFOPLIST_FILE: 'NO',
        INFOPLIST_FILE: 'NotifyKitNSE/Info.plist',
        IPHONEOS_DEPLOYMENT_TARGET: '15.1',
        MARKETING_VERSION: '8.0.0',
        PRODUCT_BUNDLE_IDENTIFIER: 'com.notifykit.exposmoke.NotifyKitNSE',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '1,2',
      },
      {
        CODE_SIGN_ENTITLEMENTS: 'NotifyKitNSE/NotifyKitNSE.entitlements',
        CURRENT_PROJECT_VERSION: '800',
        GENERATE_INFOPLIST_FILE: 'NO',
        INFOPLIST_FILE: 'NotifyKitNSE/Info.plist',
        IPHONEOS_DEPLOYMENT_TARGET: '15.1',
        MARKETING_VERSION: '8.0.0',
        PRODUCT_BUNDLE_IDENTIFIER: 'com.notifykit.exposmoke.NotifyKitNSE',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '1,2',
      },
    ]);
    expect(
      countSourceBuildFiles(proj, 'NotifyKitNSE', 'NotificationService.swift in Sources'),
    ).toBe(1);
    expect(getTargetDependencyCount(proj, 'NotifeeExample', 'NotifyKitNSE')).toBe(1);

    const copyFilesPhases = getHostCopyFilesPhases(proj, 'NotifeeExample');
    expect(copyFilesPhases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dstSubfolderSpec: 13,
          files: expect.arrayContaining([
            expect.objectContaining({
              comment: 'NotifyKitNSE.appex in Copy Files',
            }),
          ]),
        }),
      ]),
    );
    expect(
      getShellScriptPhase(proj, '[CP-User] [RNFB] Core Configuration')?.inputPaths,
    ).toBeUndefined();
  });

  it('updates version build settings on an existing NSE target without duplicating target structures', () => {
    const proj = parseFixtureProject();
    const bundleIdentifier = 'com.notifykit.exposmoke.NotifyKitNSE';
    const createResult = patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier,
      parentTargetName: 'NotifeeExample',
      marketingVersion: '7.0.0',
      currentProjectVersion: '100',
    });
    const targetUuid = getNativeTarget(proj, 'NotifyKitNSE')?.uuid;
    const hostUuid = getNativeTarget(proj, 'NotifeeExample')?.uuid;
    const buildPhaseCount = getTargetBuildPhaseCount(proj, 'NotifyKitNSE');
    const copyFilesPhaseCount = getHostCopyFilesPhases(proj, 'NotifeeExample').length;

    expect(createResult.didChange).toBe(true);
    expect(targetUuid).toBeDefined();
    expect(
      mutateVersionBuildSettings(proj, 'NotifyKitNSE', settings => {
        settings.MARKETING_VERSION = '7.0.0';
        delete settings.CURRENT_PROJECT_VERSION;
      }),
    ).toBeGreaterThan(0);

    const updateResult = patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier,
      parentTargetName: 'NotifeeExample',
      marketingVersion: '8.0.0',
      currentProjectVersion: '123',
    });

    expect(updateResult.didChange).toBe(true);
    expect(updateResult.targetUuid).toBe(targetUuid);
    expect(updateResult.hostTargetUuid).toBe(hostUuid);
    expect(countNativeTargets(proj, 'NotifyKitNSE')).toBe(1);
    expect(getBuildSettingsByConfiguration(proj, 'NotifyKitNSE')).toEqual([
      expect.objectContaining({
        CURRENT_PROJECT_VERSION: '123',
        MARKETING_VERSION: '8.0.0',
      }),
      expect.objectContaining({
        CURRENT_PROJECT_VERSION: '123',
        MARKETING_VERSION: '8.0.0',
      }),
    ]);
    expect(getTargetBuildPhaseCount(proj, 'NotifyKitNSE')).toBe(buildPhaseCount);
    expect(
      countSourceBuildFiles(proj, 'NotifyKitNSE', 'NotificationService.swift in Sources'),
    ).toBe(1);
    expect(getTargetDependencyCount(proj, 'NotifeeExample', 'NotifyKitNSE')).toBe(1);
    expect(getHostCopyFilesPhases(proj, 'NotifeeExample')).toHaveLength(copyFilesPhaseCount);

    const projectAfterUpdate = proj.writeSync();
    const idempotentResult = patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier,
      parentTargetName: 'NotifeeExample',
      marketingVersion: '8.0.0',
      currentProjectVersion: '123',
    });

    expect(idempotentResult).toEqual({ didChange: false, warnings: [] });
    expect(proj.writeSync()).toBe(projectAfterUpdate);
    expect(countNativeTargets(proj, 'NotifyKitNSE')).toBe(1);
    expect(getTargetBuildPhaseCount(proj, 'NotifyKitNSE')).toBe(buildPhaseCount);
  });

  it('uses the configured targetName and bundle suffix', async () => {
    const withXcodeProject = jest.fn((config, action) =>
      action({
        ...config,
        modRequest: {
          projectName: 'NotifeeExample',
        },
        modResults: parseFixtureProject(),
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withXcodeProject }), { virtual: true });

    const { withNotifyKitIosNseXcodeProject } =
      await import('../ios/withNotifyKitIosNseXcodeProject');
    const config = withNotifyKitIosNseXcodeProject(
      {
        ios: {
          bundleIdentifier: 'com.notifykit.exposmoke',
        },
      },
      {
        ...enabledOptions,
        targetName: 'CustomNotifyKitNSE',
        bundleSuffix: '.CustomNotifyKitNSE',
      },
    );
    const proj = config.modResults;

    expect(getNativeTarget(proj, 'CustomNotifyKitNSE')).toBeDefined();
    expect(getBuildSettingsByConfiguration(proj, 'CustomNotifyKitNSE')).toEqual([
      expect.objectContaining({
        CODE_SIGN_ENTITLEMENTS: 'CustomNotifyKitNSE/CustomNotifyKitNSE.entitlements',
        INFOPLIST_FILE: 'CustomNotifyKitNSE/Info.plist',
        PRODUCT_BUNDLE_IDENTIFIER: 'com.notifykit.exposmoke.CustomNotifyKitNSE',
      }),
      expect.objectContaining({
        CODE_SIGN_ENTITLEMENTS: 'CustomNotifyKitNSE/CustomNotifyKitNSE.entitlements',
        INFOPLIST_FILE: 'CustomNotifyKitNSE/Info.plist',
        PRODUCT_BUNDLE_IDENTIFIER: 'com.notifykit.exposmoke.CustomNotifyKitNSE',
      }),
    ]);
    expect(getTargetDependencyCount(proj, 'NotifeeExample', 'CustomNotifyKitNSE')).toBe(1);
    expect(getHostCopyFilesPhases(proj, 'NotifeeExample')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dstSubfolderSpec: 13,
          files: expect.arrayContaining([
            expect.objectContaining({
              comment: 'CustomNotifyKitNSE.appex in Copy Files',
            }),
          ]),
        }),
      ]),
    );
  });

  it('throws when a newly-created NSE target cannot be linked to the host app target', async () => {
    const withXcodeProject = jest.fn((config, action) =>
      action({
        ...config,
        modRequest: {
          projectName: 'MissingHostTarget',
        },
        modResults: parseFixtureProject(),
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withXcodeProject }), { virtual: true });

    const { withNotifyKitIosNseXcodeProject } =
      await import('../ios/withNotifyKitIosNseXcodeProject');

    expect(() =>
      withNotifyKitIosNseXcodeProject(
        {
          ios: {
            bundleIdentifier: 'com.notifykit.exposmoke',
          },
        },
        enabledOptions,
      ),
    ).toThrow(/Failed to link NotifyKit NSE target/);
  });

  it('does not import from the CLI implementation', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../ios/withNotifyKitIosNseXcodeProject.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/packages\/cli|\.\.\/\.\.\/\.\.\/cli|react-native-notify-kit\/cli/);
  });
});
