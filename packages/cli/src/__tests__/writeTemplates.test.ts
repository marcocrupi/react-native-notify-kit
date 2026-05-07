import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
} from '../lib/initNseCore';
import { writeTemplates } from '../lib/writeTemplates';

describe('writeTemplates', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-write-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('creates NotificationService.swift with correct content', () => {
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
    expect(swift).toBe(renderNotificationServiceSwift());
    expect(swift).toContain('import RNNotifeeCore');
    expect(swift).toContain('NotifeeExtensionHelper.populateNotificationContent');
  });

  it('creates Info.plist with target name substituted', () => {
    writeTemplates({
      iosDir: tmp,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      force: false,
    });
    const plist = fs.readFileSync(path.join(tmp, 'NotifyKitNSE', 'Info.plist'), 'utf-8');
    expect(plist).toBe(renderNseInfoPlist({ targetName: 'NotifyKitNSE' }));
    expect(plist).toContain('<string>NotifyKitNSE</string>');
    expect(plist).toContain('com.apple.usernotifications.service');
    expect(plist).not.toContain('{{TARGET_NAME}}');
  });

  it('creates entitlements file named after target', () => {
    writeTemplates({
      iosDir: tmp,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      force: false,
    });
    const entitlementsPath = path.join(tmp, 'NotifyKitNSE', 'NotifyKitNSE.entitlements');
    expect(fs.existsSync(entitlementsPath)).toBe(true);
    expect(fs.readFileSync(entitlementsPath, 'utf-8')).toBe(renderNseEntitlementsPlist());
  });

  it('refuses to overwrite existing directory without --force', () => {
    fs.mkdirSync(path.join(tmp, 'NotifyKitNSE'));
    expect(() =>
      writeTemplates({
        iosDir: tmp,
        targetName: 'NotifyKitNSE',
        bundleId: 'com.test.nse',
        force: false,
      }),
    ).toThrow('appears to exist');
  });

  it('overwrites existing directory with --force', () => {
    fs.mkdirSync(path.join(tmp, 'NotifyKitNSE'));
    fs.writeFileSync(path.join(tmp, 'NotifyKitNSE', 'old.txt'), 'old');
    writeTemplates({
      iosDir: tmp,
      targetName: 'NotifyKitNSE',
      bundleId: 'com.test.nse',
      force: true,
    });
    expect(fs.existsSync(path.join(tmp, 'NotifyKitNSE', 'NotificationService.swift'))).toBe(true);
  });

  it('C1: Swift template uses withContent: (matches ObjC header)', () => {
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
    // Swift imports the second selector piece as `with:`.
    expect(swift).toContain('with: bestAttemptContent');
    expect(swift).not.toContain('withContent: bestAttemptContent');
  });
});
