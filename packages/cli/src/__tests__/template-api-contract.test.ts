/**
 * Check 1 — Template ↔ ObjC API contract lock
 *
 * Reads the real NotifeeExtensionHelper.h header and verifies the Swift
 * template uses the correct selector labels. If the ObjC API changes,
 * this test fails — forcing the template to be updated.
 */

import * as fs from 'fs';
import * as path from 'path';

const HEADER_PATH = path.resolve(
  __dirname,
  '../../../../packages/react-native/ios/RNNotifee/NotifeeExtensionHelper.h',
);
const TEMPLATE_PATH = path.resolve(__dirname, '../templates/NotificationService.swift.tmpl');

const header = fs.readFileSync(HEADER_PATH, 'utf-8');
const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

describe('Check 1 — Template ↔ ObjC API contract', () => {
  it('ObjC header declares populateNotificationContent:withContent:withContentHandler:', () => {
    // The 3-arg method (non-deprecated)
    expect(header).toContain('populateNotificationContent:(UNNotificationRequest');
    expect(header).toContain('withContent:(UNMutableNotificationContent');
    expect(header).toContain('withContentHandler:(void (^)(UNNotificationContent');
  });

  it('Swift template calls populateNotificationContent with first arg (request)', () => {
    // First arg has no external label in Swift (bridged from ObjC method name)
    expect(template).toMatch(/populateNotificationContent\(\s*\n?\s*request/);
  });

  it('Swift template uses withContent: label (not with:)', () => {
    expect(template).toContain('withContent: bestAttemptContent');
    expect(template).not.toContain('with: bestAttemptContent');
  });

  it('Swift template uses withContentHandler: label', () => {
    expect(template).toContain('withContentHandler: contentHandler');
  });

  it('Swift template imports RNNotifeeCore module', () => {
    expect(template).toContain('import RNNotifeeCore');
  });

  it('ObjC header is part of RNNotifeeCore pod (public header)', () => {
    // Verify the podspec exposes this header
    const podspecPath = path.resolve(
      __dirname,
      '../../../../packages/react-native/RNNotifeeCore.podspec',
    );
    const podspec = fs.readFileSync(podspecPath, 'utf-8');
    expect(podspec).toContain('NotifeeExtensionHelper.h');
    expect(podspec).toContain('public_header_files');
  });
});
