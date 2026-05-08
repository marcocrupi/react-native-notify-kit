import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import xcode from 'xcode';
import { patchXcodeProject, patchXcodeProjectForNotifyKitNse } from '../lib/patchXcodeProject';

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

function getNativeTarget(
  proj: ReturnType<typeof xcode.project>,
  targetName: string,
): { uuid: string; target: Record<string, unknown> } | undefined {
  const targets = proj.pbxNativeTargetSection();
  for (const [uuid, value] of Object.entries(targets)) {
    if (typeof value !== 'object' || uuid.endsWith('_comment')) continue;
    const target = value as Record<string, unknown>;
    if (String(target.name ?? '').replace(/"/g, '') === targetName) {
      return { uuid, target };
    }
  }
  return undefined;
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

describe('patchXcodeProject', () => {
  let ctx: ReturnType<typeof setupTmpProject>;

  beforeEach(() => {
    ctx = setupTmpProject();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('patchXcodeProjectForNotifyKitNse returns didChange true on a base project', () => {
    const proj = parseProject(ctx.pbxprojPath);
    const result = patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });

    const nseTarget = getNativeTarget(proj, 'NotifyKitNSE');
    const hostTarget = getNativeTarget(proj, 'NotifeeExample');

    expect(result).toEqual({
      didChange: true,
      targetUuid: nseTarget?.uuid,
      productUuid: nseTarget?.target.productReference,
      hostTargetUuid: hostTarget?.uuid,
      warnings: [],
    });
    expect(getTargetNames(proj)).toContain('NotifyKitNSE');
  });

  it('patchXcodeProjectForNotifyKitNse is idempotent on an already patched project', () => {
    const proj = parseProject(ctx.pbxprojPath);
    const first = patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });
    const patchedProject = proj.writeSync();

    const second = patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });

    expect(first.didChange).toBe(true);
    expect(second).toEqual({ didChange: false, warnings: [] });
    expect(proj.writeSync()).toBe(patchedProject);
    expect(getTargetNames(proj).filter(n => n === 'NotifyKitNSE')).toHaveLength(1);
    expect(
      countSourceBuildFiles(proj, 'NotifyKitNSE', 'NotificationService.swift in Sources'),
    ).toBe(1);
    expect(getTargetDependencyCount(proj, 'NotifeeExample', 'NotifyKitNSE')).toBe(1);
  });

  it('removes broken undefined fields from the .appex product file reference', () => {
    const proj = parseProject(ctx.pbxprojPath);
    patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });

    const productFileReference = getProductFileReference(proj, 'NotifyKitNSE');

    expect(productFileReference).toBeDefined();
    expect(productFileReference?.name).toBe('"NotifyKitNSE.appex"');
    expect(productFileReference).not.toHaveProperty('fileEncoding');
    expect(productFileReference).not.toHaveProperty('lastKnownFileType');
  });

  it('adds a manual target dependency from the host app to the NSE target', () => {
    const proj = parseProject(ctx.pbxprojPath);
    patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });

    expect(getTargetDependencyCount(proj, 'NotifeeExample', 'NotifyKitNSE')).toBe(1);
  });

  it('keeps the default object-based build settings aligned with the CLI patcher', () => {
    const proj = parseProject(ctx.pbxprojPath);
    patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
    });

    expect(getBuildSetting(proj, 'NotifyKitNSE', 'INFOPLIST_FILE')).toBe('NotifyKitNSE/Info.plist');
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'PRODUCT_BUNDLE_IDENTIFIER')).toBe('com.test.nse');
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'TARGETED_DEVICE_FAMILY')).toBe('1,2');
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'IPHONEOS_DEPLOYMENT_TARGET')).toBe('15.1');
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'SWIFT_VERSION')).toBe('5.0');
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'CODE_SIGN_ENTITLEMENTS')).toBe(
      'NotifyKitNSE/NotifyKitNSE.entitlements',
    );
    expect(getBuildSetting(proj, 'NotifyKitNSE', 'GENERATE_INFOPLIST_FILE')).toBe('NO');
  });

  it('applies a custom deployment target through the object-based API', () => {
    const proj = parseProject(ctx.pbxprojPath);
    patchXcodeProjectForNotifyKitNse(proj, {
      targetName: 'NotifyKitNSE',
      bundleIdentifier: 'com.test.nse',
      deploymentTarget: '16.2',
    });

    expect(getBuildSetting(proj, 'NotifyKitNSE', 'IPHONEOS_DEPLOYMENT_TARGET')).toBe('16.2');
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
