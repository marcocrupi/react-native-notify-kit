import * as path from 'path';
import xcode from 'xcode';

import * as cliCore from '../../../../cli/src/lib/initNseCore';
import { patchPodfileForNotifyKitNse as patchCliPodfileForNotifyKitNse } from '../../../../cli/src/lib/patchPodfile';
import { patchXcodeProjectForNotifyKitNse as patchCliXcodeProjectForNotifyKitNse } from '../../../../cli/src/lib/patchXcodeProject';
import * as pluginCore from '../shared/nse/initNseCore';
import { patchPodfileForNotifyKitNse as patchPluginPodfileForNotifyKitNse } from '../shared/nse/patchPodfile';
import { patchXcodeProjectForNotifyKitNse as patchPluginXcodeProjectForNotifyKitNse } from '../shared/nse/patchXcodeProject';

const RNFB_POST_INSTALL_MARKER =
  'NotifyKitNSE: avoid an Xcode build cycle between the embedded app extension';
const RNFB_INFO_PLIST_INPUT_PATH = '$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)';

const BASIC_PODFILE = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!
end
`;

const PODFILE_WITH_POST_INSTALL = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!

  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

const FIXTURE_PBXPROJ_PATH = path.resolve(
  __dirname,
  '../../../../cli/src/__tests__/fixtures/sample-rn-app/ios/MyApp.xcodeproj/project.pbxproj',
);

const XCODE_BUILD_SETTING_KEYS = [
  'INFOPLIST_FILE',
  'PRODUCT_BUNDLE_IDENTIFIER',
  'TARGETED_DEVICE_FAMILY',
  'IPHONEOS_DEPLOYMENT_TARGET',
  'SWIFT_VERSION',
  'CODE_SIGN_ENTITLEMENTS',
  'GENERATE_INFOPLIST_FILE',
];

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

function getTopLevelTargetBlock(content: string, targetName: string): string {
  const escapedTargetName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(
    new RegExp(`^target '${escapedTargetName}' do\\n[\\s\\S]*?^end\\n?`, 'm'),
  );
  return match?.[0] ?? '';
}

function parseFixtureProject(): ReturnType<typeof xcode.project> {
  const proj = xcode.project(FIXTURE_PBXPROJ_PATH);
  proj.parseSync();
  return proj;
}

function getTargetNames(proj: ReturnType<typeof xcode.project>): string[] {
  return Object.entries(proj.pbxNativeTargetSection())
    .filter(([, value]) => typeof value === 'object' && (value as Record<string, unknown>).name)
    .map(([, value]) => String((value as Record<string, unknown>).name).replace(/"/g, ''))
    .sort();
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

function getProductFileReference(
  proj: ReturnType<typeof xcode.project>,
  targetName: string,
): Record<string, unknown> | undefined {
  const target = getNativeTarget(proj, targetName);
  const productReference = target?.target.productReference;
  if (typeof productReference !== 'string') return undefined;

  const fileRefs = (proj as any).hash.project.objects.PBXFileReference as
    | Record<string, unknown>
    | undefined;
  const fileRef = fileRefs?.[productReference];
  return typeof fileRef === 'object' ? (fileRef as Record<string, unknown>) : undefined;
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

describe('plugin shared NSE core helpers', () => {
  it('validates target names and bundle suffixes with the plugin helper API', () => {
    expect(() => pluginCore.validateNseTargetName('NotifyKitNSE')).not.toThrow();
    expect(() => pluginCore.validateNseTargetName('NotifyKit-NSE.1_Test')).not.toThrow();
    expect(() => pluginCore.validateNseTargetName('bad target')).toThrow(/Invalid target name/);

    expect(() => pluginCore.validateNseBundleSuffix('.NotifyKitNSE')).not.toThrow();
    expect(() => pluginCore.validateNseBundleSuffix('NotifyKitNSE')).toThrow(
      /Invalid bundle suffix/,
    );
  });

  it('keeps core helper behavior equivalent to the CLI source helpers', () => {
    expect(pluginCore.renderNotificationServiceSwift()).toBe(
      cliCore.renderNotificationServiceSwift(),
    );
    expect(pluginCore.renderNseInfoPlist({ targetName: 'CustomNSE' })).toBe(
      cliCore.renderNseInfoPlist({ targetName: 'CustomNSE' }),
    );
    expect(pluginCore.renderNseEntitlementsPlist()).toBe(cliCore.renderNseEntitlementsPlist());

    for (const [parentBundleId, suffix, parentTargetName] of [
      ['com.example.app', '.NotifyKitNSE', undefined],
      [
        'org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)',
        '.NotifyKitNSE',
        'Notifee Example',
      ],
      [null, '.NotifyKitNSE', undefined],
      ['com.example.$(CONFIGURATION)', '.NotifyKitNSE', undefined],
    ] as Array<[string | null, string, string | undefined]>) {
      expect(pluginCore.deriveNseBundleIdentifier(parentBundleId, suffix, parentTargetName)).toBe(
        cliCore.deriveNseBundleIdentifier(parentBundleId, suffix, parentTargetName),
      );
    }
  });

  it('keeps the committed CJS build helper loadable through an internal path', async () => {
    const built = await import('../../build/shared/nse');

    expect(typeof built.validateNseTargetName).toBe('function');
    expect(typeof built.patchPodfileForNotifyKitNse).toBe('function');
    expect(typeof built.patchXcodeProjectForNotifyKitNse).toBe('function');
    expect(built.renderNseInfoPlist({ targetName: 'BuildNSE' })).toBe(
      pluginCore.renderNseInfoPlist({ targetName: 'BuildNSE' }),
    );
  });
});

describe('plugin shared NSE Podfile patcher', () => {
  it('keeps Podfile output equivalent to the CLI pure patcher', () => {
    const cases = [
      {
        text: BASIC_PODFILE,
        options: { targetName: 'NotifyKitNSE' },
      },
      {
        text: BASIC_PODFILE,
        options: {
          targetName: 'NotifyKitNSE',
          packagePathFromIos: '../../node_modules/react-native-notify-kit',
        },
      },
      {
        text: PODFILE_WITH_POST_INSTALL,
        options: { targetName: 'NotifyKitNSE' },
      },
      {
        text: BASIC_PODFILE.replace('end', "  target 'NotifyKitNSE' do\n  end\nend"),
        options: { targetName: 'NotifyKitNSE' },
      },
      {
        text: '',
        options: { targetName: 'NotifyKitNSE' },
      },
    ];

    for (const testCase of cases) {
      expect(patchPluginPodfileForNotifyKitNse(testCase.text, testCase.options)).toEqual(
        patchCliPodfileForNotifyKitNse(testCase.text, testCase.options),
      );
    }
  });

  it('preserves default path, custom path, RNFirebase workaround, and idempotency', () => {
    const first = patchPluginPodfileForNotifyKitNse(BASIC_PODFILE, {
      targetName: 'NotifyKitNSE',
    });
    const second = patchPluginPodfileForNotifyKitNse(first.contents, {
      targetName: 'NotifyKitNSE',
    });
    const customPath = patchPluginPodfileForNotifyKitNse(BASIC_PODFILE, {
      targetName: 'NotifyKitNSE',
      packagePathFromIos: '../../node_modules/react-native-notify-kit',
    });

    expect(first.didChange).toBe(true);
    expect(first.contents).toContain("  target 'NotifyKitNSE' do");
    expect(first.contents).not.toMatch(/^target 'NotifyKitNSE' do/m);
    expect(first.contents).toContain('    inherit! :search_paths');
    expect(first.contents).not.toContain('use_frameworks!');
    expect(first.contents).toContain(
      "pod 'RNNotifeeCore', :path => '../node_modules/react-native-notify-kit'",
    );
    expect(first.contents).toContain(RNFB_POST_INSTALL_MARKER);
    expect(first.contents).toContain(
      `rnfb_info_plist_input_path = '${RNFB_INFO_PLIST_INPUT_PATH}'`,
    );
    expect(first.contents).toContain(
      'script_phase[:input_files].delete(rnfb_info_plist_input_path)',
    );
    expect(first.contents).toContain('phase.input_paths.delete(rnfb_info_plist_input_path)');
    expect(countOccurrences(first.contents, "target 'NotifyKitNSE' do")).toBe(1);
    expect(countOccurrences(first.contents, RNFB_POST_INSTALL_MARKER)).toBe(1);
    expect(second).toEqual({ contents: first.contents, didChange: false });

    expect(customPath.didChange).toBe(true);
    expect(customPath.contents).toContain(
      "pod 'RNNotifeeCore', :path => '../../node_modules/react-native-notify-kit'",
    );
    expect(customPath.contents).not.toContain(
      "pod 'RNNotifeeCore', :path => '../node_modules/react-native-notify-kit'",
    );
  });

  it('supports top-level placement without search path inheritance', () => {
    const first = patchPluginPodfileForNotifyKitNse(BASIC_PODFILE, {
      targetName: 'NotifyKitNSE',
      packagePathFromIos: '../../../packages/react-native',
      placement: 'topLevel',
    });
    const second = patchPluginPodfileForNotifyKitNse(first.contents, {
      targetName: 'NotifyKitNSE',
      packagePathFromIos: '../../../packages/react-native',
      placement: 'topLevel',
    });
    const customPath = patchPluginPodfileForNotifyKitNse(BASIC_PODFILE, {
      targetName: 'CustomNotifyKitNSE',
      packagePathFromIos: '../../custom/react-native-notify-kit',
      placement: 'topLevel',
    });
    const hostTargetBlock = getTopLevelTargetBlock(first.contents, 'MyApp');
    const nseTargetBlock = getTopLevelTargetBlock(first.contents, 'NotifyKitNSE');
    const customTargetBlock = getTopLevelTargetBlock(customPath.contents, 'CustomNotifyKitNSE');

    expect(first.didChange).toBe(true);
    expect(first.contents).toMatch(/^target 'NotifyKitNSE' do/m);
    expect(first.contents).not.toMatch(/^ {2}target 'NotifyKitNSE' do/m);
    expect(hostTargetBlock).not.toContain("target 'NotifyKitNSE' do");
    expect(nseTargetBlock).not.toContain('inherit! :search_paths');
    expect(nseTargetBlock).not.toContain('use_frameworks!');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(first.contents).toContain(RNFB_POST_INSTALL_MARKER);
    expect(countOccurrences(first.contents, "target 'NotifyKitNSE' do")).toBe(1);
    expect(countOccurrences(first.contents, RNFB_POST_INSTALL_MARKER)).toBe(1);
    expect(second).toEqual({ contents: first.contents, didChange: false });

    expect(customTargetBlock).not.toContain('inherit! :search_paths');
    expect(customTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../custom/react-native-notify-kit'",
    );
  });

  it('supports top-level placement with static use_frameworks', () => {
    const first = patchPluginPodfileForNotifyKitNse(BASIC_PODFILE, {
      targetName: 'NotifyKitNSE',
      packagePathFromIos: '../../../packages/react-native',
      placement: 'topLevel',
      useFrameworks: 'static',
    });
    const second = patchPluginPodfileForNotifyKitNse(first.contents, {
      targetName: 'NotifyKitNSE',
      packagePathFromIos: '../../../packages/react-native',
      placement: 'topLevel',
      useFrameworks: 'static',
    });
    const nseTargetBlock = getTopLevelTargetBlock(first.contents, 'NotifyKitNSE');

    expect(first.didChange).toBe(true);
    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :static');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(nseTargetBlock).not.toContain('inherit! :search_paths');
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
    expect(countOccurrences(first.contents, "target 'NotifyKitNSE' do")).toBe(1);
    expect(countOccurrences(first.contents, RNFB_POST_INSTALL_MARKER)).toBe(1);
    expect(second).toEqual({ contents: first.contents, didChange: false });
  });
});

describe('plugin shared NSE Xcode patcher', () => {
  it('keeps structural Xcode invariants equivalent to the CLI patcher', () => {
    const pluginProj = parseFixtureProject();
    const cliProj = parseFixtureProject();

    const pluginResult = patchPluginXcodeProjectForNotifyKitNse(pluginProj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });
    const cliResult = patchCliXcodeProjectForNotifyKitNse(cliProj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });

    expect(pluginResult.didChange).toBe(cliResult.didChange);
    expect(pluginResult.warnings).toEqual(cliResult.warnings);
    expect(pluginResult.targetUuid).toBe(getNativeTarget(pluginProj, 'NotifyKitNSE')?.uuid);
    expect(pluginResult.productUuid).toBe(
      getNativeTarget(pluginProj, 'NotifyKitNSE')?.target.productReference,
    );
    expect(pluginResult.hostTargetUuid).toBe(getNativeTarget(pluginProj, 'NotifeeExample')?.uuid);
    expect(Boolean(pluginResult.targetUuid)).toBe(true);
    expect(Boolean(pluginResult.productUuid)).toBe(true);

    expect(getTargetNames(pluginProj)).toEqual(getTargetNames(cliProj));
    expect(getBuildSettingsByConfiguration(pluginProj, 'NotifyKitNSE')).toEqual(
      getBuildSettingsByConfiguration(cliProj, 'NotifyKitNSE'),
    );
    expect(getBuildSettingsByConfiguration(pluginProj, 'NotifyKitNSE')).toEqual([
      {
        CODE_SIGN_ENTITLEMENTS: 'NotifyKitNSE/NotifyKitNSE.entitlements',
        GENERATE_INFOPLIST_FILE: 'NO',
        INFOPLIST_FILE: 'NotifyKitNSE/Info.plist',
        IPHONEOS_DEPLOYMENT_TARGET: '15.1',
        PRODUCT_BUNDLE_IDENTIFIER: 'com.test.nse',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '1,2',
      },
      {
        CODE_SIGN_ENTITLEMENTS: 'NotifyKitNSE/NotifyKitNSE.entitlements',
        GENERATE_INFOPLIST_FILE: 'NO',
        INFOPLIST_FILE: 'NotifyKitNSE/Info.plist',
        IPHONEOS_DEPLOYMENT_TARGET: '15.1',
        PRODUCT_BUNDLE_IDENTIFIER: 'com.test.nse',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '1,2',
      },
    ]);
    expect(getTargetDependencyCount(pluginProj, 'NotifeeExample', 'NotifyKitNSE')).toBe(1);
    expect(getTargetDependencyCount(pluginProj, 'NotifeeExample', 'NotifyKitNSE')).toBe(
      getTargetDependencyCount(cliProj, 'NotifeeExample', 'NotifyKitNSE'),
    );
    expect(
      countSourceBuildFiles(pluginProj, 'NotifyKitNSE', 'NotificationService.swift in Sources'),
    ).toBe(1);
    expect(
      countSourceBuildFiles(pluginProj, 'NotifyKitNSE', 'NotificationService.swift in Sources'),
    ).toBe(countSourceBuildFiles(cliProj, 'NotifyKitNSE', 'NotificationService.swift in Sources'));

    const pluginProductFileReference = getProductFileReference(pluginProj, 'NotifyKitNSE');
    const cliProductFileReference = getProductFileReference(cliProj, 'NotifyKitNSE');
    expect(pluginProductFileReference?.name).toBe(cliProductFileReference?.name);
    expect(pluginProductFileReference).not.toHaveProperty('fileEncoding');
    expect(pluginProductFileReference).not.toHaveProperty('lastKnownFileType');

    expect(getShellScriptPhase(pluginProj, '[CP-User] [RNFB] Core Configuration')).toBeDefined();
    expect(
      getShellScriptPhase(pluginProj, '[CP-User] [RNFB] Core Configuration')?.inputPaths,
    ).toBeUndefined();
  });

  it('is idempotent and does not duplicate source files or dependencies', () => {
    const pluginProj = parseFixtureProject();
    const cliProj = parseFixtureProject();

    const first = patchPluginXcodeProjectForNotifyKitNse(pluginProj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });
    const cliFirst = patchCliXcodeProjectForNotifyKitNse(cliProj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });
    const pluginProjectAfterFirstRun = pluginProj.writeSync();

    const second = patchPluginXcodeProjectForNotifyKitNse(pluginProj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });
    const cliSecond = patchCliXcodeProjectForNotifyKitNse(cliProj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });

    expect(first.didChange).toBe(cliFirst.didChange);
    expect(second).toEqual(cliSecond);
    expect(second).toEqual({ didChange: false, warnings: [] });
    expect(pluginProj.writeSync()).toBe(pluginProjectAfterFirstRun);
    expect(getTargetNames(pluginProj).filter(name => name === 'NotifyKitNSE')).toHaveLength(1);
    expect(
      countSourceBuildFiles(pluginProj, 'NotifyKitNSE', 'NotificationService.swift in Sources'),
    ).toBe(1);
    expect(getTargetDependencyCount(pluginProj, 'NotifeeExample', 'NotifyKitNSE')).toBe(1);
  });

  it('keeps custom deployment target behavior equivalent to the CLI patcher', () => {
    const pluginProj = parseFixtureProject();
    const cliProj = parseFixtureProject();

    patchPluginXcodeProjectForNotifyKitNse(pluginProj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
      deploymentTarget: '16.2',
    });
    patchCliXcodeProjectForNotifyKitNse(cliProj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
      deploymentTarget: '16.2',
    });

    expect(getBuildSettingsByConfiguration(pluginProj, 'NotifyKitNSE')).toEqual(
      getBuildSettingsByConfiguration(cliProj, 'NotifyKitNSE'),
    );
    expect(
      getBuildSettingsByConfiguration(pluginProj, 'NotifyKitNSE').every(
        settings => settings.IPHONEOS_DEPLOYMENT_TARGET === '16.2',
      ),
    ).toBe(true);
  });
});
