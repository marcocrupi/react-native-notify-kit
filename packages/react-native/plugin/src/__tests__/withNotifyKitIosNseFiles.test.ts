import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
} from '../shared/nse/initNseCore';

const enabledOptions = {
  enabled: true,
  targetName: 'NotifyKitNSE',
  bundleSuffix: '.NotifyKitNSE',
};

function makeTempIosRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'notifykit-nse-files-'));
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

describe('NotifyKit Expo NSE file generation mod', () => {
  let tempIosRoots: string[] = [];

  beforeEach(() => {
    jest.resetModules();
    tempIosRoots = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const tempIosRoot of tempIosRoots) {
      fs.rmSync(tempIosRoot, { force: true, recursive: true });
    }
  });

  it('leaves config unchanged and does not register withDangerousMod when NSE is disabled', () => {
    const withDangerousMod = jest.fn();
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });

    const { withNotifyKitIosNseFiles } = require('../ios/withNotifyKitIosNseFiles');
    const config = {};

    expect(
      withNotifyKitIosNseFiles(config, {
        ...enabledOptions,
        enabled: false,
      }),
    ).toBe(config);
    expect(withDangerousMod).not.toHaveBeenCalled();
  });

  it('generates the three NSE files from the shared renderers when enabled', () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const withDangerousMod = jest.fn((config, [platform, action]) => {
      expect(platform).toBe('ios');
      return action({
        ...config,
        modRequest: {
          platformProjectRoot: tempIosRoot,
        },
      });
    });
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });

    const { withNotifyKitIosNseFiles } = require('../ios/withNotifyKitIosNseFiles');
    const config = withNotifyKitIosNseFiles({}, enabledOptions);

    expect(withDangerousMod).toHaveBeenCalledTimes(1);
    expect(config.modRequest.platformProjectRoot).toBe(tempIosRoot);
    expect(readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'NotificationService.swift'))).toBe(
      renderNotificationServiceSwift(),
    );
    expect(readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'Info.plist'))).toBe(
      renderNseInfoPlist({ targetName: 'NotifyKitNSE' }),
    );
    expect(readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'NotifyKitNSE.entitlements'))).toBe(
      renderNseEntitlementsPlist(),
    );
  });

  it('uses the configured targetName in paths and plist content', () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const withDangerousMod = jest.fn((config, [, action]) =>
      action({
        ...config,
        modRequest: {
          platformProjectRoot: tempIosRoot,
        },
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });

    const { withNotifyKitIosNseFiles } = require('../ios/withNotifyKitIosNseFiles');
    withNotifyKitIosNseFiles(
      {},
      {
        ...enabledOptions,
        targetName: 'CustomNotifyKitNSE',
      },
    );

    expect(fs.existsSync(path.join(tempIosRoot, 'CustomNotifyKitNSE'))).toBe(true);
    expect(
      readFile(path.join(tempIosRoot, 'CustomNotifyKitNSE', 'CustomNotifyKitNSE.entitlements')),
    ).toBe(renderNseEntitlementsPlist());
    expect(readFile(path.join(tempIosRoot, 'CustomNotifyKitNSE', 'Info.plist'))).toContain(
      '<string>CustomNotifyKitNSE</string>',
    );
    expect(fs.existsSync(path.join(tempIosRoot, 'NotifyKitNSE'))).toBe(false);
  });

  it('treats existing identical files as a no-op', () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const { writeNotifyKitIosNseFiles } = require('../ios/withNotifyKitIosNseFiles');

    writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE');
    const notificationServicePath = path.join(
      tempIosRoot,
      'NotifyKitNSE',
      'NotificationService.swift',
    );
    const initialContents = readFile(notificationServicePath);

    expect(() => writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE')).not.toThrow();
    expect(readFile(notificationServicePath)).toBe(initialContents);
  });

  it('throws instead of overwriting an existing different file', () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const targetDir = path.join(tempIosRoot, 'NotifyKitNSE');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'NotificationService.swift'), '// custom file\n', 'utf8');

    const { writeNotifyKitIosNseFiles } = require('../ios/withNotifyKitIosNseFiles');

    expect(() => writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE')).toThrow(
      /Refusing to overwrite existing .*NotificationService\.swift/,
    );
  });

  it('does not import from the CLI implementation', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../ios/withNotifyKitIosNseFiles.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/packages\/cli|\.\.\/\.\.\/\.\.\/cli|react-native-notify-kit\/cli/);
  });
});
