import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectIosProject, deriveBundleId } from '../lib/detectProject';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sample-rn-app', 'ios');

describe('detectIosProject', () => {
  it('finds single .xcodeproj under ios/', () => {
    const info = detectIosProject(FIXTURE_DIR);
    expect(info.xcodeProjectPath).toContain('MyApp.xcodeproj');
    expect(info.pbxprojPath).toContain('project.pbxproj');
  });

  it('throws when ios directory does not exist', () => {
    expect(() => detectIosProject('/nonexistent/path')).toThrow('Could not find iOS directory');
  });

  it('throws when no .xcodeproj found', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-detect-'));
    expect(() => detectIosProject(tmp)).toThrow('Could not find .xcodeproj');
    fs.rmSync(tmp, { recursive: true });
  });

  it('throws when multiple .xcodeproj found', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-detect-multi-'));
    fs.mkdirSync(path.join(tmp, 'A.xcodeproj'));
    fs.mkdirSync(path.join(tmp, 'B.xcodeproj'));
    expect(() => detectIosProject(tmp)).toThrow('Multiple .xcodeproj');
    fs.rmSync(tmp, { recursive: true });
  });

  it('reads parent target name from pbxproj', () => {
    const info = detectIosProject(FIXTURE_DIR);
    // The fixture is a copy of NotifeeExample — target name is NotifeeExample
    expect(info.parentTargetName).toBe('NotifeeExample');
  });

  it('reads parent bundle ID from pbxproj', () => {
    const info = detectIosProject(FIXTURE_DIR);
    // The smoke app uses variable-based bundle ID
    expect(info.parentBundleId).toBeDefined();
  });
});

describe('deriveBundleId', () => {
  it('appends suffix to literal bundle ID', () => {
    expect(deriveBundleId('com.example.app', '.NotifyKitNSE')).toBe('com.example.app.NotifyKitNSE');
  });

  it('returns placeholder when bundle ID uses variable', () => {
    const result = deriveBundleId('$(PRODUCT_BUNDLE_IDENTIFIER)', '.NotifyKitNSE');
    expect(result).toContain('$(');
  });

  it('returns placeholder when bundle ID is null', () => {
    const result = deriveBundleId(null, '.NotifyKitNSE');
    expect(result).toContain('$(');
  });
});
