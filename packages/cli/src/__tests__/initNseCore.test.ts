import * as fs from 'fs';
import * as path from 'path';
import * as plist from 'plist';
import {
  deriveNseBundleIdentifier,
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
  validateNseBundleSuffix,
  validateNseTargetName,
} from '../lib/initNseCore';

describe('initNseCore validation', () => {
  it('accepts a valid target name', () => {
    expect(() => validateNseTargetName('NotifyKitNSE')).not.toThrow();
    expect(() => validateNseTargetName('NotifyKit-NSE.1_Test')).not.toThrow();
  });

  it('rejects an empty target name', () => {
    expect(() => validateNseTargetName('')).toThrow(
      "Invalid target name ''. Must match [A-Za-z0-9_-.]",
    );
  });

  it('rejects a target name with unsafe characters', () => {
    expect(() => validateNseTargetName("Foo'; system('rm -rf /'); #")).toThrow(
      'Target names can only contain letters, digits, underscores, hyphens, and dots.',
    );
  });

  it('accepts a valid bundle suffix', () => {
    expect(() => validateNseBundleSuffix('.NotifyKitNSE')).not.toThrow();
    expect(() => validateNseBundleSuffix('.notify-kit.nse-1')).not.toThrow();
  });

  it('rejects a bundle suffix without a leading dot', () => {
    expect(() => validateNseBundleSuffix('NotifyKitNSE')).toThrow(
      "Invalid bundle suffix 'NotifyKitNSE'. Must start with '.' and contain only letters, digits, hyphens, and dots.",
    );
  });

  it('rejects a bundle suffix with unsafe characters', () => {
    expect(() => validateNseBundleSuffix('.bad$(rm)')).toThrow(
      "Invalid bundle suffix '.bad$(rm)'. Must start with '.' and contain only letters, digits, hyphens, and dots.",
    );
  });
});

describe('deriveNseBundleIdentifier', () => {
  it('appends suffix to a literal bundle ID', () => {
    expect(deriveNseBundleIdentifier('com.example.app', '.NotifyKitNSE')).toBe(
      'com.example.app.NotifyKitNSE',
    );
  });

  it('expands $(PRODUCT_NAME:rfc1034identifier) when target name is known', () => {
    expect(
      deriveNseBundleIdentifier(
        'org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)',
        '.NotifyKitNSE',
        'Notifee Example',
      ),
    ).toBe('org.reactjs.native.example.Notifee-Example.NotifyKitNSE');
  });

  it('returns a placeholder when bundle ID is null', () => {
    expect(deriveNseBundleIdentifier(null, '.NotifyKitNSE')).toBe(
      '$(PRODUCT_BUNDLE_IDENTIFIER:default).NotifyKitNSE',
    );
  });

  it('returns a placeholder when bundle ID has an unresolved variable', () => {
    expect(deriveNseBundleIdentifier('com.example.$(CONFIGURATION)', '.NotifyKitNSE')).toBe(
      '$(PRODUCT_BUNDLE_IDENTIFIER:default).NotifyKitNSE',
    );
  });
});

describe('initNseCore renderers', () => {
  it('renders NotificationService.swift with the expected NSE bridge calls', () => {
    const swift = renderNotificationServiceSwift();

    expect(swift).toContain('import RNNotifeeCore');
    expect(swift).toContain('populateNotificationContent');
    expect(swift).toContain('with: bestAttemptContent');
    expect(swift).toContain('serviceExtensionTimeWillExpire');
    expect(swift).toContain('[NotifyKitNSE]');
    expect(swift).toContain('deliverOnce');
  });

  it('renders Info.plist with the target name and NSE extension keys', () => {
    const infoPlist = renderNseInfoPlist({ targetName: 'CustomNSE' });

    expect(infoPlist).toContain('<string>CustomNSE</string>');
    expect(infoPlist).toContain('com.apple.usernotifications.service');
    expect(infoPlist).toContain('NSExtensionPrincipalClass');
    expect(infoPlist).not.toContain('{{TARGET_NAME}}');
  });

  it('renders the minimal entitlements plist used today', () => {
    const entitlements = renderNseEntitlementsPlist();

    expect(plist.parse(entitlements)).toEqual({});
    expect(entitlements).toContain('<dict>\n</dict>');
  });

  it('keeps renderer output equivalent to the current template files', () => {
    const templatesDir = path.resolve(__dirname, '../templates');
    const swiftTemplate = fs.readFileSync(
      path.join(templatesDir, 'NotificationService.swift.tmpl'),
      'utf-8',
    );
    const infoPlistTemplate = fs.readFileSync(path.join(templatesDir, 'Info.plist.tmpl'), 'utf-8');
    const entitlementsTemplate = fs.readFileSync(
      path.join(templatesDir, 'NotifyKitNSE.entitlements.tmpl'),
      'utf-8',
    );

    expect(renderNotificationServiceSwift()).toBe(swiftTemplate);
    expect(renderNseInfoPlist({ targetName: 'CustomNSE' })).toBe(
      infoPlistTemplate.replace(/\{\{TARGET_NAME\}\}/g, 'CustomNSE'),
    );
    expect(renderNseEntitlementsPlist()).toBe(entitlementsTemplate);
  });
});
