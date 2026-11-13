import * as fs from 'fs';
import * as path from 'path';

const BASIC_PODFILE = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!
end
`;

const PODFILE_WITH_STATIC_USE_FRAMEWORKS = `platform :ios, '15.1'

target 'MyApp' do
  use_frameworks! :linkage => :static
  use_react_native!
end
`;

const PODFILE_WITH_USE_FRAMEWORKS = `platform :ios, '15.1'

target 'MyApp' do
  use_frameworks!
  use_react_native!
end
`;

const PODFILE_WITH_DYNAMIC_USE_FRAMEWORKS = `platform :ios, '15.1'

target 'MyApp' do
  use_frameworks! :linkage => :dynamic
  use_react_native!
end
`;

const PODFILE_WITH_GLOBAL_STATIC_USE_FRAMEWORKS = `platform :ios, '15.1'

use_frameworks! :linkage => :static

target 'MyApp' do
  use_react_native!
end
`;

const PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS = `platform :ios, '15.1'

target 'MyApp' do
  use_frameworks! :linkage => podfile_properties['ios.useFrameworks'].to_sym if podfile_properties['ios.useFrameworks']
  use_frameworks! :linkage => ENV['USE_FRAMEWORKS'].to_sym if ENV['USE_FRAMEWORKS']
  use_react_native!
end
`;

const PODFILE_WITH_EXISTING_NSE_USE_FRAMEWORKS = `${BASIC_PODFILE}
target 'NotifyKitNSE' do
  use_frameworks!
  pod 'RNNotifeeCore', :path => '../../../packages/react-native'
end
`;

const PODFILE_WITH_EXPO_CONDITIONAL_AND_EXISTING_NSE_USE_FRAMEWORKS = `${PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS}
target 'NotifyKitNSE' do
  use_frameworks!
  pod 'RNNotifeeCore', :path => '../../../packages/react-native'
end
`;

const PODFILE_WITH_STATIC_USE_FRAMEWORKS_AND_EXISTING_NSE_GENERIC = `${PODFILE_WITH_STATIC_USE_FRAMEWORKS}
target 'NotifyKitNSE' do
  use_frameworks!
  pod 'RNNotifeeCore', :path => '../../../packages/react-native'
end
`;

const enabledOptions = {
  enabled: true,
  targetName: 'NotifyKitNSE',
  bundleSuffix: '.NotifyKitNSE',
};

const repoRoot = path.resolve(__dirname, '../../../../..');
const expoSmokeRoot = path.join(repoRoot, 'apps/expo-smoke');
const expoSmokeIosRoot = path.join(expoSmokeRoot, 'ios');
const expoSmokePodfilePropertiesPath = path.join(expoSmokeIosRoot, 'Podfile.properties.json');
let originalUseFrameworksEnv: string | undefined;

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

function mockPodfileProperties(properties: Record<string, unknown>): void {
  jest.doMock('fs', () => {
    const actualFs = jest.requireActual<typeof import('fs')>('fs');

    return {
      ...actualFs,
      readFileSync: (filePath: fs.PathOrFileDescriptor, options?: unknown) => {
        if (
          typeof filePath === 'string' &&
          path.resolve(filePath) === expoSmokePodfilePropertiesPath
        ) {
          return JSON.stringify(properties);
        }

        return actualFs.readFileSync(filePath, options as never);
      },
    };
  });
}

async function runPodfileMod(
  podfileContents: string,
  configOverrides: Record<string, unknown> = {},
): Promise<string> {
  const withPodfile = jest.fn((config, action) =>
    action({
      ...config,
      modRequest: {
        projectRoot: expoSmokeRoot,
        platformProjectRoot: expoSmokeIosRoot,
      },
      modResults: {
        contents: podfileContents,
      },
    }),
  );
  jest.doMock('expo/config-plugins', () => ({ withPodfile }), { virtual: true });

  const { withNotifyKitIosNsePodfile } = await import('../ios/withNotifyKitIosNsePodfile');
  const config = withNotifyKitIosNsePodfile(configOverrides, enabledOptions) as {
    modResults: { contents: string };
  };

  return config.modResults.contents;
}

describe('NotifyKit Expo Podfile mod', () => {
  beforeEach(() => {
    originalUseFrameworksEnv = process.env.USE_FRAMEWORKS;
    delete process.env.USE_FRAMEWORKS;
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('fs');
    if (originalUseFrameworksEnv === undefined) {
      delete process.env.USE_FRAMEWORKS;
    } else {
      process.env.USE_FRAMEWORKS = originalUseFrameworksEnv;
    }
  });

  it('leaves config unchanged and does not register withPodfile when NSE is disabled', async () => {
    const withPodfile = jest.fn();
    jest.doMock('expo/config-plugins', () => ({ withPodfile }), { virtual: true });

    const { withNotifyKitIosNsePodfile } = await import('../ios/withNotifyKitIosNsePodfile');
    const config = {};

    expect(
      withNotifyKitIosNsePodfile(config, {
        ...enabledOptions,
        enabled: false,
      }),
    ).toBe(config);
    expect(withPodfile).not.toHaveBeenCalled();
  });

  it('patches modResults.contents when NSE is enabled', async () => {
    const withPodfile = jest.fn((config, action) =>
      action({
        ...config,
        modRequest: {
          projectRoot: expoSmokeRoot,
          platformProjectRoot: expoSmokeIosRoot,
        },
        modResults: {
          contents: BASIC_PODFILE,
        },
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withPodfile }), { virtual: true });

    const { withNotifyKitIosNsePodfile } = await import('../ios/withNotifyKitIosNsePodfile');
    const config = withNotifyKitIosNsePodfile({}, enabledOptions);

    expect(withPodfile).toHaveBeenCalledTimes(1);
    const contents = config.modResults.contents;
    const hostTargetBlock = getTopLevelTargetBlock(contents, 'MyApp');
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(contents).toMatch(/^target 'NotifyKitNSE' do/m);
    expect(contents).not.toMatch(/^ {2}target 'NotifyKitNSE' do/m);
    expect(hostTargetBlock).not.toContain("target 'NotifyKitNSE' do");
    expect(nseTargetBlock).not.toContain('inherit! :search_paths');
    expect(nseTargetBlock).not.toContain('use_frameworks!');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(contents).toContain(
      'NotifyKitNSE: avoid an Xcode build cycle between the embedded app extension',
    );
  });

  it('propagates static host use_frameworks to the Expo NSE target', async () => {
    const withPodfile = jest.fn((config, action) =>
      action({
        ...config,
        modRequest: {
          projectRoot: expoSmokeRoot,
          platformProjectRoot: expoSmokeIosRoot,
        },
        modResults: {
          contents: PODFILE_WITH_STATIC_USE_FRAMEWORKS,
        },
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withPodfile }), { virtual: true });

    const { withNotifyKitIosNsePodfile } = await import('../ios/withNotifyKitIosNsePodfile');
    const config = withNotifyKitIosNsePodfile({}, enabledOptions);
    const nseTargetBlock = getTopLevelTargetBlock(config.modResults.contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :static');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(nseTargetBlock).not.toContain('inherit! :search_paths');
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
  });

  it('propagates generic host use_frameworks to the Expo NSE target', async () => {
    const contents = await runPodfileMod(PODFILE_WITH_USE_FRAMEWORKS);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks!');
    expect(nseTargetBlock).not.toContain(':linkage =>');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
  });

  it('propagates dynamic host use_frameworks to the Expo NSE target', async () => {
    const contents = await runPodfileMod(PODFILE_WITH_DYNAMIC_USE_FRAMEWORKS);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :dynamic');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
  });

  it('propagates global static use_frameworks to the Expo NSE target', async () => {
    const contents = await runPodfileMod(PODFILE_WITH_GLOBAL_STATIC_USE_FRAMEWORKS);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :static');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
  });

  it('ignores inactive Expo conditional use_frameworks lines in the host target', async () => {
    mockPodfileProperties({});

    const contents = await runPodfileMod(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).not.toContain('use_frameworks!');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(0);
  });

  it('propagates Expo Podfile.properties static use_frameworks to the Expo NSE target', async () => {
    mockPodfileProperties({ 'ios.useFrameworks': 'static' });

    const contents = await runPodfileMod(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :static');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
  });

  it('propagates Expo Podfile.properties dynamic use_frameworks to the Expo NSE target', async () => {
    mockPodfileProperties({ 'ios.useFrameworks': 'dynamic' });

    const contents = await runPodfileMod(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :dynamic');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
  });

  it('propagates Expo USE_FRAMEWORKS env static use_frameworks to the Expo NSE target', async () => {
    mockPodfileProperties({});
    process.env.USE_FRAMEWORKS = 'static';

    const contents = await runPodfileMod(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :static');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
  });

  it('repairs a stale Expo NSE use_frameworks line when Expo conditionals are inactive', async () => {
    const { patchPodfileForNotifyKitNse } = await import('../shared/nse/patchPodfile');
    const { detectPodfileUseFrameworks } = await import('../ios/withNotifyKitIosNsePodfile');
    const patchOptions = {
      targetName: 'NotifyKitNSE',
      packagePathFromIos: '../../../packages/react-native',
      placement: 'topLevel' as const,
    };
    const firstUseFrameworks = detectPodfileUseFrameworks(
      PODFILE_WITH_EXPO_CONDITIONAL_AND_EXISTING_NSE_USE_FRAMEWORKS,
      {
        ignoredTargetName: 'NotifyKitNSE',
        podfileProperties: {},
        env: {},
      },
    );
    const first = patchPodfileForNotifyKitNse(
      PODFILE_WITH_EXPO_CONDITIONAL_AND_EXISTING_NSE_USE_FRAMEWORKS,
      {
        ...patchOptions,
        useFrameworks: firstUseFrameworks,
      },
    );
    const secondUseFrameworks = detectPodfileUseFrameworks(first.contents, {
      ignoredTargetName: 'NotifyKitNSE',
      podfileProperties: {},
      env: {},
    });
    const second = patchPodfileForNotifyKitNse(first.contents, {
      ...patchOptions,
      useFrameworks: secondUseFrameworks,
    });
    const nseTargetBlock = getTopLevelTargetBlock(first.contents, 'NotifyKitNSE');

    expect(firstUseFrameworks).toBe(false);
    expect(first.didChange).toBe(true);
    expect(nseTargetBlock).not.toContain('use_frameworks!');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(secondUseFrameworks).toBe(false);
    expect(second.didChange).toBe(false);
    expect(second.contents).toBe(first.contents);
  });

  for (const linkage of ['static', 'dynamic'] as const) {
    for (const state of ['missing', 'stale'] as const) {
      for (const order of ['before', 'after'] as const) {
        it(`issue95 ${linkage} config ${order} build-properties with ${state} disk properties`, async () => {
          mockPodfileProperties(
            state === 'missing'
              ? {}
              : { 'ios.useFrameworks': linkage === 'static' ? 'dynamic' : 'static' },
          );
          const buildProperties = ['expo-build-properties', { ios: { useFrameworks: linkage } }];
          const notifyKit = [
            'react-native-notify-kit',
            { ios: { notificationServiceExtension: { enabled: true } } },
          ];
          const plugins =
            order === 'before' ? [notifyKit, buildProperties] : [buildProperties, notifyKit];
          const output = await runPodfileMod(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS, {
            plugins,
          });
          expect(getTopLevelTargetBlock(output, 'NotifyKitNSE')).toContain(
            `use_frameworks! :linkage => :${linkage}`,
          );
          expect(await runPodfileMod(output, { plugins })).toBe(output);
        });
      }
    }
  }

  it('issue95 preserves active USE_FRAMEWORKS precedence over future configured properties', async () => {
    mockPodfileProperties({});
    process.env.USE_FRAMEWORKS = 'static';
    const output = await runPodfileMod(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS, {
      plugins: [['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }]],
    });
    expect(getTopLevelTargetBlock(output, 'NotifyKitNSE')).toContain(
      'use_frameworks! :linkage => :static',
    );
  });

  it('issue95 does not enable NSE frameworks when the host does not consume the properties', async () => {
    mockPodfileProperties({});
    const output = await runPodfileMod(BASIC_PODFILE, {
      plugins: [['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }]],
    });
    expect(getTopLevelTargetBlock(output, 'NotifyKitNSE')).not.toContain('use_frameworks!');
  });

  it('propagates expo-build-properties static use_frameworks to the Expo NSE target', async () => {
    mockPodfileProperties({ 'ios.useFrameworks': 'static' });
    const withPodfile = jest.fn((config, action) =>
      action({
        ...config,
        modRequest: {
          projectRoot: expoSmokeRoot,
          platformProjectRoot: expoSmokeIosRoot,
        },
        modResults: {
          contents: PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS,
        },
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withPodfile }), { virtual: true });

    const { withNotifyKitIosNsePodfile } = await import('../ios/withNotifyKitIosNsePodfile');
    const config = withNotifyKitIosNsePodfile(
      {
        plugins: [
          [
            'expo-build-properties',
            {
              ios: {
                useFrameworks: 'static',
              },
            },
          ],
        ],
      },
      enabledOptions,
    );
    const nseTargetBlock = getTopLevelTargetBlock(config.modResults.contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :static');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(nseTargetBlock).not.toContain('inherit! :search_paths');
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
  });

  it('repairs an existing Expo NSE target by removing use_frameworks when the host does not use it', async () => {
    const contents = await runPodfileMod(PODFILE_WITH_EXISTING_NSE_USE_FRAMEWORKS);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).not.toContain('use_frameworks!');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(contents, "target 'NotifyKitNSE' do")).toBe(1);
    expect(countOccurrences(nseTargetBlock, "pod 'RNNotifeeCore'")).toBe(1);
  });

  it('repairs an existing Expo NSE target by matching static host use_frameworks', async () => {
    const contents = await runPodfileMod(
      PODFILE_WITH_STATIC_USE_FRAMEWORKS_AND_EXISTING_NSE_GENERIC,
    );
    const second = await runPodfileMod(contents);
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(nseTargetBlock).toContain('  use_frameworks! :linkage => :static');
    expect(nseTargetBlock).toContain(
      "pod 'RNNotifeeCore', :path => '../../../packages/react-native'",
    );
    expect(countOccurrences(contents, "target 'NotifyKitNSE' do")).toBe(1);
    expect(countOccurrences(nseTargetBlock, 'use_frameworks!')).toBe(1);
    expect(countOccurrences(nseTargetBlock, "pod 'RNNotifeeCore'")).toBe(1);
    expect(second).toBe(contents);
  });

  it('keeps the Expo Podfile patch idempotent on repeated mod runs', async () => {
    const withPodfile = jest.fn((config, action) => {
      const first = action({
        ...config,
        modRequest: {
          projectRoot: expoSmokeRoot,
          platformProjectRoot: expoSmokeIosRoot,
        },
        modResults: {
          contents: BASIC_PODFILE,
        },
      });

      return action({
        ...first,
        modRequest: {
          projectRoot: expoSmokeRoot,
          platformProjectRoot: expoSmokeIosRoot,
        },
        modResults: {
          contents: first.modResults.contents,
        },
      });
    });
    jest.doMock('expo/config-plugins', () => ({ withPodfile }), { virtual: true });

    const { withNotifyKitIosNsePodfile } = await import('../ios/withNotifyKitIosNsePodfile');
    const config = withNotifyKitIosNsePodfile({}, enabledOptions);
    const contents = config.modResults.contents;
    const nseTargetBlock = getTopLevelTargetBlock(contents, 'NotifyKitNSE');

    expect(countOccurrences(contents, "target 'NotifyKitNSE' do")).toBe(1);
    expect(
      countOccurrences(
        contents,
        'NotifyKitNSE: avoid an Xcode build cycle between the embedded app extension',
      ),
    ).toBe(1);
    expect(nseTargetBlock).not.toContain('inherit! :search_paths');
    expect(nseTargetBlock).not.toContain('use_frameworks!');
  });

  it('passes the configured targetName to the Podfile patcher', async () => {
    const withPodfile = jest.fn((config, action) =>
      action({
        ...config,
        modRequest: {
          projectRoot: expoSmokeRoot,
          platformProjectRoot: expoSmokeIosRoot,
        },
        modResults: {
          contents: BASIC_PODFILE,
        },
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withPodfile }), { virtual: true });

    const { withNotifyKitIosNsePodfile } = await import('../ios/withNotifyKitIosNsePodfile');
    const config = withNotifyKitIosNsePodfile(
      {},
      {
        ...enabledOptions,
        targetName: 'CustomNotifyKitNSE',
      },
    );

    expect(config.modResults.contents).toContain("target 'CustomNotifyKitNSE' do");
    expect(config.modResults.contents).not.toContain("target 'NotifyKitNSE' do");
  });

  it('calculates packagePathFromIos from projectRoot and platformProjectRoot', async () => {
    const { resolveNotifyKitPackagePathFromIos } =
      await import('../ios/withNotifyKitIosNsePodfile');

    expect(resolveNotifyKitPackagePathFromIos(expoSmokeRoot, expoSmokeIosRoot)).toBe(
      '../../../packages/react-native',
    );
  });

  it('normalizes Windows backslashes in Podfile paths', async () => {
    const { normalizePodfilePath } = await import('../ios/withNotifyKitIosNsePodfile');

    expect(normalizePodfilePath('..\\..\\packages\\react-native')).toBe(
      '../../packages/react-native',
    );
  });

  it('detects Podfile use_frameworks linkage from in-memory contents', async () => {
    const { detectPodfileUseFrameworks } = await import('../ios/withNotifyKitIosNsePodfile');

    expect(detectPodfileUseFrameworks(BASIC_PODFILE)).toBe(false);
    expect(detectPodfileUseFrameworks(PODFILE_WITH_STATIC_USE_FRAMEWORKS)).toBe('static');
    expect(detectPodfileUseFrameworks(PODFILE_WITH_DYNAMIC_USE_FRAMEWORKS)).toBe('dynamic');
    expect(detectPodfileUseFrameworks(PODFILE_WITH_GLOBAL_STATIC_USE_FRAMEWORKS)).toBe('static');
    expect(detectPodfileUseFrameworks(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS)).toBe(false);
    expect(
      detectPodfileUseFrameworks(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS, {
        podfileProperties: { 'ios.useFrameworks': 'static' },
        env: {},
      }),
    ).toBe('static');
    expect(
      detectPodfileUseFrameworks(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS, {
        podfileProperties: { 'ios.useFrameworks': 'dynamic' },
        env: {},
      }),
    ).toBe('dynamic');
    expect(
      detectPodfileUseFrameworks(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS, {
        podfileProperties: {},
        env: { USE_FRAMEWORKS: 'static' },
      }),
    ).toBe('static');
    expect(
      detectPodfileUseFrameworks(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS, {
        podfileProperties: {},
        env: { USE_FRAMEWORKS: 'dynamic' },
      }),
    ).toBe('dynamic');
    expect(
      detectPodfileUseFrameworks(PODFILE_WITH_EXPO_CONDITIONAL_USE_FRAMEWORKS, {
        podfileProperties: { 'ios.useFrameworks': 'static' },
        env: { USE_FRAMEWORKS: 'dynamic' },
      }),
    ).toBe('dynamic');
    expect(detectPodfileUseFrameworks('use_frameworks! :linkage => :dynamic\n')).toBe('dynamic');
    expect(detectPodfileUseFrameworks('use_frameworks!\n')).toBe(true);
    expect(detectPodfileUseFrameworks('# use_frameworks! :linkage => :static\n')).toBe(false);
    expect(detectPodfileUseFrameworks(PODFILE_WITH_EXISTING_NSE_USE_FRAMEWORKS)).toBe(false);
    expect(
      detectPodfileUseFrameworks(PODFILE_WITH_EXISTING_NSE_USE_FRAMEWORKS, 'NotifyKitNSE'),
    ).toBe(false);
  });

  it('does not import from the CLI implementation', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../ios/withNotifyKitIosNsePodfile.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/packages\/cli|\.\.\/\.\.\/\.\.\/cli|react-native-notify-kit\/cli/);
  });
});
