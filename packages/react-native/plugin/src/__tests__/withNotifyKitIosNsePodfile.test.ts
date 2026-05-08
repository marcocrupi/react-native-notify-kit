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

const PODFILE_WITH_EXPO_PROPERTY_USE_FRAMEWORKS = `platform :ios, '15.1'

target 'MyApp' do
  use_frameworks! :linkage => podfile_properties['ios.useFrameworks'].to_sym if podfile_properties['ios.useFrameworks']
  use_react_native!
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

describe('NotifyKit Expo Podfile mod', () => {
  beforeEach(() => {
    jest.resetModules();
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

  it('propagates expo-build-properties static use_frameworks to the Expo NSE target', async () => {
    const withPodfile = jest.fn((config, action) =>
      action({
        ...config,
        modRequest: {
          projectRoot: expoSmokeRoot,
          platformProjectRoot: expoSmokeIosRoot,
        },
        modResults: {
          contents: PODFILE_WITH_EXPO_PROPERTY_USE_FRAMEWORKS,
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
    expect(detectPodfileUseFrameworks(PODFILE_WITH_EXPO_PROPERTY_USE_FRAMEWORKS)).toBe(true);
    expect(detectPodfileUseFrameworks('use_frameworks! :linkage => :dynamic\n')).toBe('dynamic');
    expect(detectPodfileUseFrameworks('use_frameworks!\n')).toBe(true);
    expect(detectPodfileUseFrameworks('# use_frameworks! :linkage => :static\n')).toBe(false);
  });

  it('does not import from the CLI implementation', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../ios/withNotifyKitIosNsePodfile.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/packages\/cli|\.\.\/\.\.\/\.\.\/cli|react-native-notify-kit\/cli/);
  });
});
