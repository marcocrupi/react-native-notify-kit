import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import xcode from 'xcode';
import { patchXcodeProject } from '../lib/patchXcodeProject';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sample-rn-app');

function setupTmpProject(): { pbxprojPath: string; iosDir: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-xcode-'));
  const iosDir = path.join(tmp, 'ios');
  const xcodeDir = path.join(iosDir, 'MyApp.xcodeproj');
  fs.mkdirSync(xcodeDir, { recursive: true });
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'ios', 'MyApp.xcodeproj', 'project.pbxproj'),
    path.join(xcodeDir, 'project.pbxproj'),
  );
  return {
    pbxprojPath: path.join(xcodeDir, 'project.pbxproj'),
    iosDir,
    cleanup: () => fs.rmSync(tmp, { recursive: true }),
  };
}

function parseProject(pbxprojPath: string) {
  const proj = xcode.project(pbxprojPath);
  proj.parseSync();
  return proj;
}

function getTargetNames(proj: ReturnType<typeof xcode.project>): string[] {
  const targets = proj.pbxNativeTargetSection();
  return Object.entries(targets)
    .filter(([, v]) => typeof v === 'object' && (v as Record<string, unknown>).name)
    .map(([, v]) => String((v as Record<string, unknown>).name).replace(/"/g, ''));
}

function getBuildSetting(
  proj: ReturnType<typeof xcode.project>,
  targetProductName: string,
  key: string,
): string | undefined {
  const configs = proj.pbxXCBuildConfigurationSection();
  for (const [, value] of Object.entries(configs)) {
    if (typeof value !== 'object') continue;
    const config = value as Record<string, unknown>;
    const settings = config.buildSettings as Record<string, string> | undefined;
    if (settings?.PRODUCT_NAME === `"${targetProductName}"` && settings[key]) {
      return settings[key].replace(/"/g, '');
    }
  }
  return undefined;
}

describe('patchXcodeProject', () => {
  it('adds NotifyKitNSE target as app_extension', () => {
    const { pbxprojPath, iosDir, cleanup } = setupTmpProject();
    patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: false,
    });
    const proj = parseProject(pbxprojPath);
    expect(getTargetNames(proj)).toContain('NotifyKitNSE');
    cleanup();
  });

  it('sets IPHONEOS_DEPLOYMENT_TARGET to 15.1', () => {
    const { pbxprojPath, iosDir, cleanup } = setupTmpProject();
    patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: false,
    });
    const proj = parseProject(pbxprojPath);
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'IPHONEOS_DEPLOYMENT_TARGET')).toBe('15.1');
    cleanup();
  });

  it('sets SWIFT_VERSION to 5.0', () => {
    const { pbxprojPath, iosDir, cleanup } = setupTmpProject();
    patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: false,
    });
    const proj = parseProject(pbxprojPath);
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'SWIFT_VERSION')).toBe('5.0');
    cleanup();
  });

  it('sets PRODUCT_BUNDLE_IDENTIFIER correctly', () => {
    const { pbxprojPath, iosDir, cleanup } = setupTmpProject();
    patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: false,
    });
    const proj = parseProject(pbxprojPath);
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'PRODUCT_BUNDLE_IDENTIFIER')).toBe('com.test.nse');
    cleanup();
  });

  it('sets INFOPLIST_FILE to target path', () => {
    const { pbxprojPath, iosDir, cleanup } = setupTmpProject();
    patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: false,
    });
    const proj = parseProject(pbxprojPath);
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'INFOPLIST_FILE')).toBe('NotifyKitNSE/Info.plist');
    cleanup();
  });

  it('is idempotent: running twice returns false on second run', () => {
    const { pbxprojPath, iosDir, cleanup } = setupTmpProject();
    const first = patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: false,
    });
    const second = patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: false,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    // Verify no duplicate target
    const proj = parseProject(pbxprojPath);
    const nseTargets = getTargetNames(proj).filter(n => n === 'NotifyKitNSE');
    expect(nseTargets).toHaveLength(1);
    cleanup();
  });

  it('dry-run does not write to disk', () => {
    const { pbxprojPath, iosDir, cleanup } = setupTmpProject();
    const originalContent = fs.readFileSync(pbxprojPath, 'utf-8');
    patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: true,
    });
    const afterContent = fs.readFileSync(pbxprojPath, 'utf-8');
    expect(afterContent).toBe(originalContent);
    cleanup();
  });

  it('creates build configurations for both Debug and Release', () => {
    const { pbxprojPath, iosDir, cleanup } = setupTmpProject();
    patchXcodeProject({
      pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir,
      dryRun: false,
    });
    const proj = parseProject(pbxprojPath);
    const configs = proj.pbxXCBuildConfigurationSection();
    const nseConfigs = Object.entries(configs)
      .filter(([, v]) => typeof v === 'object' && (v as Record<string, unknown>).buildSettings)
      .filter(([, v]) => {
        const s = (v as Record<string, unknown>).buildSettings as Record<string, string>;
        return s?.PRODUCT_NAME === '"NotifyKitNSE"';
      });
    // Should have at least Debug and Release
    expect(nseConfigs.length).toBeGreaterThanOrEqual(2);
    cleanup();
  });
});
