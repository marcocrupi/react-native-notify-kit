import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeTemplates } from '../lib/writeTemplates';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nse-write-'));
}

describe('writeTemplates', () => {
  it('creates NotificationService.swift with correct content', () => {
    const tmp = makeTmpDir();
    writeTemplates({
      iosDir: tmp,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      force: false,
    });
    const swift = fs.readFileSync(
      path.join(tmp, 'NotifyKitNSE', 'NotificationService.swift'),
      'utf-8',
    );
    expect(swift).toContain('import RNNotifeeCore');
    expect(swift).toContain('NotifeeExtensionHelper.populateNotificationContent');
    fs.rmSync(tmp, { recursive: true });
  });

  it('creates Info.plist with target name substituted', () => {
    const tmp = makeTmpDir();
    writeTemplates({
      iosDir: tmp,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      force: false,
    });
    const plist = fs.readFileSync(path.join(tmp, 'NotifyKitNSE', 'Info.plist'), 'utf-8');
    expect(plist).toContain('<string>NotifyKitNSE</string>');
    expect(plist).toContain('com.apple.usernotifications.service');
    expect(plist).not.toContain('{{TARGET_NAME}}');
    fs.rmSync(tmp, { recursive: true });
  });

  it('creates entitlements file named after target', () => {
    const tmp = makeTmpDir();
    writeTemplates({
      iosDir: tmp,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      force: false,
    });
    expect(fs.existsSync(path.join(tmp, 'NotifyKitNSE', 'NotifyKitNSE.entitlements'))).toBe(true);
    fs.rmSync(tmp, { recursive: true });
  });

  it('refuses to overwrite existing directory without --force', () => {
    const tmp = makeTmpDir();
    fs.mkdirSync(path.join(tmp, 'NotifyKitNSE'));
    expect(() =>
      writeTemplates({
        iosDir: tmp,
        targetName: 'NotifyKitNSE',
        bundleId: 'com.test.nse',
        force: false,
      }),
    ).toThrow('appears to exist');
    fs.rmSync(tmp, { recursive: true });
  });

  it('overwrites existing directory with --force', () => {
    const tmp = makeTmpDir();
    fs.mkdirSync(path.join(tmp, 'NotifyKitNSE'));
    fs.writeFileSync(path.join(tmp, 'NotifyKitNSE', 'old.txt'), 'old');
    writeTemplates({
      iosDir: tmp,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      force: true,
    });
    expect(fs.existsSync(path.join(tmp, 'NotifyKitNSE', 'NotificationService.swift'))).toBe(true);
    fs.rmSync(tmp, { recursive: true });
  });
});
