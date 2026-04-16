import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import xcode from 'xcode';
import { initNse } from '../commands/initNse';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sample-rn-app');

function copyFixture(): { root: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-integration-'));
  fs.cpSync(FIXTURE_DIR, tmp, { recursive: true });
  return { root: tmp, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// Mock process.exit to prevent Jest from actually exiting
const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
  // no-op — prevent real exit
}) as never);

afterEach(() => {
  mockExit.mockClear();
});

describe('initNse integration', () => {
  let ctx: ReturnType<typeof copyFixture>;

  beforeEach(() => {
    ctx = copyFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('creates all expected files in a fresh project', async () => {
    await initNse({
      iosPath: path.join(ctx.root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: false,
    });

    expect(
      fs.existsSync(path.join(ctx.root, 'ios', 'NotifyKitNSE', 'NotificationService.swift')),
    ).toBe(true);
    expect(fs.existsSync(path.join(ctx.root, 'ios', 'NotifyKitNSE', 'Info.plist'))).toBe(true);
    expect(
      fs.existsSync(path.join(ctx.root, 'ios', 'NotifyKitNSE', 'NotifyKitNSE.entitlements')),
    ).toBe(true);

    // Podfile patched
    const podfile = fs.readFileSync(path.join(ctx.root, 'ios', 'Podfile'), 'utf-8');
    expect(podfile).toContain("target 'NotifyKitNSE'");

    // No backup files left
    expect(fs.existsSync(path.join(ctx.root, 'ios', 'Podfile.bak'))).toBe(false);
  });

  it('dry-run writes nothing', async () => {
    const podfileBefore = fs.readFileSync(path.join(ctx.root, 'ios', 'Podfile'), 'utf-8');

    await initNse({
      iosPath: path.join(ctx.root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: true,
    });

    expect(fs.existsSync(path.join(ctx.root, 'ios', 'NotifyKitNSE'))).toBe(false);
    const podfileAfter = fs.readFileSync(path.join(ctx.root, 'ios', 'Podfile'), 'utf-8');
    expect(podfileAfter).toBe(podfileBefore);
  });

  it('--force overwrites existing NSE', async () => {
    // First run
    await initNse({
      iosPath: path.join(ctx.root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: false,
    });

    // Second run with --force
    await initNse({
      iosPath: path.join(ctx.root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: true,
      dryRun: false,
    });

    expect(
      fs.existsSync(path.join(ctx.root, 'ios', 'NotifyKitNSE', 'NotificationService.swift')),
    ).toBe(true);
  });

  it('refuses without --force when target directory exists (C2/F3)', async () => {
    fs.mkdirSync(path.join(ctx.root, 'ios', 'NotifyKitNSE'));

    await initNse({
      iosPath: path.join(ctx.root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: false,
    });

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('C2: refuses when pbxproj has target but dir does not exist', async () => {
    // Manually add target to pbxproj
    const pbxprojPath = path.join(ctx.root, 'ios', 'MyApp.xcodeproj', 'project.pbxproj');
    const proj = xcode.project(pbxprojPath);
    proj.parseSync();
    proj.addTarget('NotifyKitNSE', 'app_extension', 'NotifyKitNSE');
    fs.writeFileSync(pbxprojPath, proj.writeSync());

    // Dir does NOT exist — but pbxproj has the target
    expect(fs.existsSync(path.join(ctx.root, 'ios', 'NotifyKitNSE'))).toBe(false);

    await initNse({
      iosPath: path.join(ctx.root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: false,
    });

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('H2: dry-run output includes absolute path and bundle ID', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await initNse({
      iosPath: path.join(ctx.root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: true,
    });

    spy.mockRestore();
    const output = logs.join('\n');
    // Absolute path (starts with /)
    expect(output).toMatch(/iOS project:.*\//);
    // Bundle ID present
    expect(output).toContain('NSE bundle ID:');
    // Target name
    expect(output).toContain('NotifyKitNSE');
  });

  it('C2: rejects target name with special characters (injection prevention)', async () => {
    await initNse({
      iosPath: path.join(ctx.root, 'ios'),
      targetName: "Foo'; system('rm -rf /'); #",
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: false,
    });
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
