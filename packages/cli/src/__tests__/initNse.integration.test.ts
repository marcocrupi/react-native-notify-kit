import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initNse } from '../commands/initNse';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sample-rn-app');

function copyFixture(): { root: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-integration-'));
  fs.cpSync(FIXTURE_DIR, tmp, { recursive: true });
  return { root: tmp, cleanup: () => fs.rmSync(tmp, { recursive: true }) };
}

describe('initNse integration', () => {
  it('creates all expected files in a fresh project', async () => {
    const { root, cleanup } = copyFixture();
    await initNse({
      iosPath: path.join(root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: false,
    });

    expect(fs.existsSync(path.join(root, 'ios', 'NotifyKitNSE', 'NotificationService.swift'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, 'ios', 'NotifyKitNSE', 'Info.plist'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ios', 'NotifyKitNSE', 'NotifyKitNSE.entitlements'))).toBe(
      true,
    );

    // Podfile patched
    const podfile = fs.readFileSync(path.join(root, 'ios', 'Podfile'), 'utf-8');
    expect(podfile).toContain("target 'NotifyKitNSE'");

    // No backup files left
    expect(fs.existsSync(path.join(root, 'ios', 'Podfile.bak'))).toBe(false);

    cleanup();
  });

  it('dry-run writes nothing', async () => {
    const { root, cleanup } = copyFixture();
    const podfileBefore = fs.readFileSync(path.join(root, 'ios', 'Podfile'), 'utf-8');

    await initNse({
      iosPath: path.join(root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: true,
    });

    expect(fs.existsSync(path.join(root, 'ios', 'NotifyKitNSE'))).toBe(false);
    const podfileAfter = fs.readFileSync(path.join(root, 'ios', 'Podfile'), 'utf-8');
    expect(podfileAfter).toBe(podfileBefore);

    cleanup();
  });

  it('--force overwrites existing NSE', async () => {
    const { root, cleanup } = copyFixture();

    // First run
    await initNse({
      iosPath: path.join(root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: false,
    });

    // Second run with --force
    await initNse({
      iosPath: path.join(root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: true,
      dryRun: false,
    });

    expect(fs.existsSync(path.join(root, 'ios', 'NotifyKitNSE', 'NotificationService.swift'))).toBe(
      true,
    );
    cleanup();
  });

  it('refuses without --force when target directory exists', async () => {
    const { root, cleanup } = copyFixture();
    fs.mkdirSync(path.join(root, 'ios', 'NotifyKitNSE'));

    const originalExitCode = process.exitCode;
    await initNse({
      iosPath: path.join(root, 'ios'),
      targetName: 'NotifyKitNSE',
      bundleSuffix: '.NotifyKitNSE',
      force: false,
      dryRun: false,
    });

    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
    cleanup();
  });
});
