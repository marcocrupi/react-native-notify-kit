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
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
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

describe('patchXcodeProject', () => {
  let ctx: ReturnType<typeof setupTmpProject>;

  beforeEach(() => {
    ctx = setupTmpProject();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('adds NotifyKitNSE target as app_extension', () => {
    patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    const proj = parseProject(ctx.pbxprojPath);
    expect(getTargetNames(proj)).toContain('NotifyKitNSE');
  });

  it('sets IPHONEOS_DEPLOYMENT_TARGET to 15.1', () => {
    patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    const proj = parseProject(ctx.pbxprojPath);
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'IPHONEOS_DEPLOYMENT_TARGET')).toBe('15.1');
  });

  it('sets SWIFT_VERSION to 5.0', () => {
    patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    const proj = parseProject(ctx.pbxprojPath);
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'SWIFT_VERSION')).toBe('5.0');
  });

  it('sets PRODUCT_BUNDLE_IDENTIFIER correctly', () => {
    patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    const proj = parseProject(ctx.pbxprojPath);
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'PRODUCT_BUNDLE_IDENTIFIER')).toBe('com.test.nse');
  });

  it('sets INFOPLIST_FILE to target path', () => {
    patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    const proj = parseProject(ctx.pbxprojPath);
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'INFOPLIST_FILE')).toBe('NotifyKitNSE/Info.plist');
  });

  it('is idempotent: running twice returns false on second run', () => {
    const first = patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    const second = patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    const proj = parseProject(ctx.pbxprojPath);
    const nseTargets = getTargetNames(proj).filter(n => n === 'NotifyKitNSE');
    expect(nseTargets).toHaveLength(1);
  });

  it('dry-run does not write to disk', () => {
    const originalContent = fs.readFileSync(ctx.pbxprojPath, 'utf-8');
    patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: true,
    });
    const afterContent = fs.readFileSync(ctx.pbxprojPath, 'utf-8');
    expect(afterContent).toBe(originalContent);
  });

  it('creates build configurations for both Debug and Release', () => {
    patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    const proj = parseProject(ctx.pbxprojPath);
    const configs = proj.pbxXCBuildConfigurationSection();
    const nseConfigs = Object.entries(configs)
      .filter(([, v]) => typeof v === 'object' && (v as Record<string, unknown>).buildSettings)
      .filter(([, v]) => {
        const s = (v as Record<string, unknown>).buildSettings as Record<string, string>;
        return s?.PRODUCT_NAME === '"NotifyKitNSE"';
      });
    expect(nseConfigs.length).toBeGreaterThanOrEqual(2);
  });

  it('removes the RNFB Info.plist input path to avoid host-extension build cycles', () => {
    patchXcodeProject({
      pbxprojPath: ctx.pbxprojPath,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      iosDir: ctx.iosDir,
      dryRun: false,
    });
    const proj = parseProject(ctx.pbxprojPath);
    const rnfbPhase = getShellScriptPhase(proj, '[CP-User] [RNFB] Core Configuration');
    expect(rnfbPhase).toBeDefined();
    expect(rnfbPhase?.inputPaths).toBeUndefined();
  });
});
