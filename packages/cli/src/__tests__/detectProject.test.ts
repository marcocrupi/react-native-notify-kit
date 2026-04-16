import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import xcode from 'xcode';
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
    try {
      expect(() => detectIosProject(tmp)).toThrow('Could not find .xcodeproj');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws when multiple .xcodeproj found', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-detect-multi-'));
    try {
      fs.mkdirSync(path.join(tmp, 'A.xcodeproj'));
      fs.mkdirSync(path.join(tmp, 'B.xcodeproj'));
      expect(() => detectIosProject(tmp)).toThrow('Multiple .xcodeproj');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reads parent target name from pbxproj', () => {
    const info = detectIosProject(FIXTURE_DIR);
    expect(info.parentTargetName).toBe('NotifeeExample');
  });

  it('reads parent bundle ID from pbxproj', () => {
    const info = detectIosProject(FIXTURE_DIR);
    expect(info.parentBundleId).toBeDefined();
  });
});

describe('M3: readParentTarget scoped to target configListRef', () => {
  it('returns app target bundle ID even when a test target config appears first in pbxproj', () => {
    // Create a temp copy of the fixture and inject a test target with a different bundle ID
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-m3-'));
    fs.cpSync(path.join(__dirname, 'fixtures', 'sample-rn-app'), tmp, { recursive: true });

    const pbxprojPath = path.join(tmp, 'ios', 'MyApp.xcodeproj', 'project.pbxproj');
    const proj = xcode.project(pbxprojPath);
    proj.parseSync();

    // Add a test target — its build configs get inserted into the global section
    const testTarget = proj.addTarget('MyAppTests', 'unit_test_bundle', 'MyAppTests');
    if (testTarget?.uuid) {
      // Set a DIFFERENT bundle ID on the test target's build configurations
      const configs = proj.pbxXCBuildConfigurationSection();
      for (const [, val] of Object.entries(configs)) {
        if (typeof val !== 'object') continue;
        const config = val as Record<string, unknown>;
        const settings = config.buildSettings as Record<string, string> | undefined;
        if (settings?.PRODUCT_NAME === `"MyAppTests"`) {
          settings.PRODUCT_BUNDLE_IDENTIFIER = '"com.test.WrongBundleId"';
        }
      }
    }

    fs.writeFileSync(pbxprojPath, proj.writeSync());

    // Now detect — should return the APP target's bundle ID, not the test target's
    const info = detectIosProject(path.join(tmp, 'ios'));
    expect(info.parentTargetName).toBe('NotifeeExample');
    // The app target's bundle ID should NOT be the test target's
    expect(info.parentBundleId).not.toBe('com.test.WrongBundleId');

    fs.rmSync(tmp, { recursive: true, force: true });
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
