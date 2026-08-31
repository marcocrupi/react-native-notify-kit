import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { generateImageAsync, getPngInfo } from '@expo/image-utils';

import type { NormalizedAndroidNotificationIconOptions } from '../options';
import {
  generateNotifyKitAndroidNotificationIconResources,
  withNotifyKitAndroidNotificationIcons,
} from '../android/withNotifyKitAndroidNotificationIcons';

const RED_SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGklEQVR4AWP8z8DwnwEJMDGgASYGNMDEgAYAg9ECBvYVtPAAAAAASUVORK5CYII=',
  'base64',
);
const BLUE_SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGklEQVR4AWNkYPj/nwEJMDGgASYGNMDEgAYAgdMCBstu2jAAAAAASUVORK5CYII=',
  'base64',
);
const WIDE_OPAQUE_SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAG0lEQVR4AWP8z8DwnwEPYGIgAJgYCAAmBgIAAASgAgY+zGOXAAAAAElFTkSuQmCC',
  'base64',
);
const PARTIALLY_TRANSPARENT_SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGUlEQVR4AWP4DwUMUMDEgAaYGNAAEwMaAAD7Iwf/v/5SewAAAABJRU5ErkJggg==',
  'base64',
);
const VALID_SOURCE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRQBAwQEBQQFCQUFCRQNCw0UFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/AABEIAAQABAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APt2eJSIs84jAHsKCT//2Q==',
  'base64',
);
const CORRUPT_SOURCE_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('corrupt PNG payload'),
]);
const EXPECTED_DENSITIES = [
  ['mdpi', 24],
  ['hdpi', 36],
  ['xhdpi', 48],
  ['xxhdpi', 72],
  ['xxxhdpi', 96],
] as const;

interface TempAndroidProject {
  tempRoot: string;
  projectRoot: string;
  platformProjectRoot: string;
}

const tempRoots: string[] = [];

function createTempAndroidProject(): TempAndroidProject {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notifykit-android-icons-'));
  const projectRoot = path.join(tempRoot, 'expo-project');
  const platformProjectRoot = path.join(tempRoot, 'custom-android-project');

  fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
  fs.mkdirSync(platformProjectRoot, { recursive: true });
  tempRoots.push(tempRoot);

  return { tempRoot, projectRoot, platformProjectRoot };
}

function writeSource(
  projectRoot: string,
  fileName = 'notification-icon.png',
  contents = RED_SOURCE_PNG,
): string {
  const sourcePath = path.join(projectRoot, 'assets', fileName);
  fs.writeFileSync(sourcePath, contents);
  return `./assets/${fileName}`;
}

function createIcon(
  name = 'notification_message',
  configuredPath = './assets/notification-icon.png',
): NormalizedAndroidNotificationIconOptions {
  return {
    name,
    path: configuredPath,
    type: 'small',
  };
}

function resourceRoot(platformProjectRoot: string): string {
  return path.join(platformProjectRoot, 'app', 'src', 'main', 'res');
}

function drawablePath(
  platformProjectRoot: string,
  density: string,
  name = 'notification_message',
): string {
  return path.join(resourceRoot(platformProjectRoot), `drawable-${density}`, `${name}.png`);
}

function keepFilePath(platformProjectRoot: string): string {
  return path.join(resourceRoot(platformProjectRoot), 'raw', 'notifykit_keep.xml');
}

function expectedKeepXml(names: string[]): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<resources xmlns:tools="http://schemas.android.com/tools"\n' +
    `    tools:keep="${names.map(name => `@drawable/${name}`).join(',')}" />\n`
  );
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function alphaValues(pngData: Buffer): number[] {
  const values: number[] = [];
  for (let index = 3; index < pngData.length; index += 4) {
    values.push(pngData[index]);
  }

  return values;
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  jest.resetModules();
});

describe('NotifyKit Expo Android notification icon resources mod', () => {
  it('leaves config unchanged and does not register a dangerous mod when icons are empty', () => {
    const withDangerousMod = jest.fn();
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });
    const config = {};

    expect(withNotifyKitAndroidNotificationIcons(config, [])).toBe(config);
    expect(withDangerousMod).not.toHaveBeenCalled();
  });

  it('registers an Android dangerous mod and uses both Expo mod roots', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    let action:
      | ((config: {
          modRequest: { projectRoot: string; platformProjectRoot: string };
        }) => Promise<unknown>)
      | undefined;
    const withDangerousMod = jest.fn((config, [platform, registeredAction]) => {
      expect(platform).toBe('android');
      action = registeredAction;
      return config;
    });
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });
    const config = {};

    expect(withNotifyKitAndroidNotificationIcons(config, [createIcon()])).toBe(config);
    expect(withDangerousMod).toHaveBeenCalledTimes(1);
    expect(action).toBeDefined();

    await action?.({
      modRequest: {
        projectRoot,
        platformProjectRoot,
      },
    });

    expect(fs.existsSync(drawablePath(platformProjectRoot, 'mdpi'))).toBe(true);
  });

  it('generates five decodable density-specific PNGs and a keep file for one icon', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);

    await generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
      createIcon(),
    ]);

    for (const [density, size] of EXPECTED_DENSITIES) {
      const outputPath = drawablePath(platformProjectRoot, density);
      const pngInfo = await getPngInfo(outputPath);

      expect(fs.readFileSync(outputPath).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(pngInfo.width).toBe(size);
      expect(pngInfo.height).toBe(size);
    }

    expect(fs.readFileSync(keepFilePath(platformProjectRoot), 'utf8')).toBe(
      expectedKeepXml(['notification_message']),
    );
  });

  it('generates all density outputs for multiple configured icons', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    const sourcePath = writeSource(projectRoot);
    const icons = [
      createIcon('notification_message', sourcePath),
      createIcon('notification_warning', sourcePath),
    ];

    await generateNotifyKitAndroidNotificationIconResources(
      projectRoot,
      platformProjectRoot,
      icons,
    );

    for (const [density] of EXPECTED_DENSITIES) {
      expect(fs.existsSync(drawablePath(platformProjectRoot, density))).toBe(true);
      expect(
        fs.existsSync(drawablePath(platformProjectRoot, density, 'notification_warning')),
      ).toBe(true);
    }
    expect(fs.readFileSync(keepFilePath(platformProjectRoot), 'utf8')).toBe(
      expectedKeepXml(['notification_message', 'notification_warning']),
    );
  });

  it('uses cover resizing for a non-square source', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot, 'wide.png', WIDE_OPAQUE_SOURCE_PNG);

    await generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
      createIcon('notification_message', './assets/wide.png'),
    ]);

    const pngInfo = await getPngInfo(drawablePath(platformProjectRoot, 'mdpi'));
    expect(Math.min(...alphaValues(pngInfo.data))).toBe(255);
  });

  it('preserves transparent pixels instead of adding an opaque background', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot, 'transparent.png', PARTIALLY_TRANSPARENT_SOURCE_PNG);

    await generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
      createIcon('notification_message', './assets/transparent.png'),
    ]);

    const pngInfo = await getPngInfo(drawablePath(platformProjectRoot, 'mdpi'));
    const alphas = alphaValues(pngInfo.data);
    expect(Math.min(...alphas)).toBe(0);
    expect(Math.max(...alphas)).toBe(255);
  });

  it('is idempotent when run twice with the same configuration', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const icons = [createIcon()];

    await generateNotifyKitAndroidNotificationIconResources(
      projectRoot,
      platformProjectRoot,
      icons,
    );
    const firstHashes = [
      ...EXPECTED_DENSITIES.map(([density]) =>
        hashFile(drawablePath(platformProjectRoot, density)),
      ),
      hashFile(keepFilePath(platformProjectRoot)),
    ];

    await generateNotifyKitAndroidNotificationIconResources(
      projectRoot,
      platformProjectRoot,
      icons,
    );
    const secondHashes = [
      ...EXPECTED_DENSITIES.map(([density]) =>
        hashFile(drawablePath(platformProjectRoot, density)),
      ),
      hashFile(keepFilePath(platformProjectRoot)),
    ];

    expect(secondHashes).toEqual(firstHashes);
    for (const [density] of EXPECTED_DENSITIES) {
      expect(fs.readdirSync(path.dirname(drawablePath(platformProjectRoot, density)))).toEqual([
        'notification_message.png',
      ]);
    }
  });

  it('overwrites the same icon name when its configured source changes', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    const firstPath = writeSource(projectRoot, 'first.png', RED_SOURCE_PNG);
    const secondPath = writeSource(projectRoot, 'second.png', BLUE_SOURCE_PNG);

    await generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
      createIcon('notification_message', firstPath),
    ]);
    const firstHash = hashFile(drawablePath(platformProjectRoot, 'xxxhdpi'));

    await generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
      createIcon('notification_message', secondPath),
    ]);
    const secondHash = hashFile(drawablePath(platformProjectRoot, 'xxxhdpi'));

    expect(secondHash).not.toBe(firstHash);
  });

  it('rejects duplicate names before creating resource outputs', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    const sourcePath = writeSource(projectRoot);

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon('notification_message', sourcePath),
        createIcon('notification_message', sourcePath),
      ]),
    ).rejects.toThrow(/Duplicate android\.icons name 'notification_message'/);
    expect(fs.existsSync(resourceRoot(platformProjectRoot))).toBe(false);
  });

  it('rejects a missing source before creating resource outputs', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon(),
      ]),
    ).rejects.toThrow(/source does not exist/);
    expect(fs.existsSync(resourceRoot(platformProjectRoot))).toBe(false);
  });

  it('rejects a configured path that resolves outside the Expo project root', async () => {
    const { tempRoot, projectRoot, platformProjectRoot } = createTempAndroidProject();
    fs.writeFileSync(path.join(tempRoot, 'outside.png'), RED_SOURCE_PNG);

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon('notification_message', '../../outside.png'),
      ]),
    ).rejects.toThrow(/resolves outside the Expo project root/);
    expect(fs.existsSync(resourceRoot(platformProjectRoot))).toBe(false);
  });

  it('rejects a non-PNG configured source before creating resource outputs', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    const sourcePath = writeSource(projectRoot, 'notification-icon.jpg');

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon('notification_message', sourcePath),
      ]),
    ).rejects.toThrow(/must reference a lowercase \.png file/);
    expect(fs.existsSync(resourceRoot(platformProjectRoot))).toBe(false);
  });

  it('rejects valid JPEG content renamed with a .png extension before native writes', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    const configuredPath = writeSource(projectRoot, 'fake.png', VALID_SOURCE_JPEG);
    const sourcePath = path.join(projectRoot, 'assets', 'fake.png');

    const decodedJpeg = await generateImageAsync(
      { projectRoot },
      {
        src: sourcePath,
        name: 'decoded-jpeg.png',
        width: 4,
        height: 4,
        resizeMode: 'cover',
      },
    );
    expect(decodedJpeg.source.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon('notification_message', configuredPath),
      ]),
    ).rejects.toThrow(/source content for 'notification_message'.*not a valid PNG/);
    expect(fs.existsSync(resourceRoot(platformProjectRoot))).toBe(false);
  });

  it('rejects an invalid PNG before creating any resource outputs', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot, 'invalid.png', CORRUPT_SOURCE_PNG);

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon('notification_message', './assets/invalid.png'),
      ]),
    ).rejects.toThrow(/Unable to generate Android notification icon 'notification_message'/);
    expect(fs.existsSync(resourceRoot(platformProjectRoot))).toBe(false);
  });

  it('rejects a drawable directory symlink without writing outside the Android project', async () => {
    const { tempRoot, projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const outsideDirectory = path.join(tempRoot, 'outside-drawable');
    const linkedDirectory = path.join(resourceRoot(platformProjectRoot), 'drawable-mdpi');
    fs.mkdirSync(outsideDirectory);
    fs.mkdirSync(path.dirname(linkedDirectory), { recursive: true });
    fs.symlinkSync(outsideDirectory, linkedDirectory, 'dir');

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon(),
      ]),
    ).rejects.toThrow(/symbolic link/);
    expect(fs.readdirSync(outsideDirectory)).toEqual([]);
    expect(fs.lstatSync(linkedDirectory).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(drawablePath(platformProjectRoot, 'hdpi'))).toBe(false);
    expect(fs.existsSync(keepFilePath(platformProjectRoot))).toBe(false);
  });

  it('rejects a destination symlink even when its target stays inside the Android project', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const insideDirectory = path.join(resourceRoot(platformProjectRoot), 'real-drawable-mdpi');
    const linkedDirectory = path.join(resourceRoot(platformProjectRoot), 'drawable-mdpi');
    fs.mkdirSync(insideDirectory, { recursive: true });
    fs.symlinkSync(insideDirectory, linkedDirectory, 'dir');

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon(),
      ]),
    ).rejects.toThrow(/symbolic link/);
    expect(fs.readdirSync(insideDirectory)).toEqual([]);
    expect(fs.lstatSync(linkedDirectory).isSymbolicLink()).toBe(true);
  });

  it('rejects a raw directory symlink before writing any generated resources', async () => {
    const { tempRoot, projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const outsideDirectory = path.join(tempRoot, 'outside-raw');
    const linkedDirectory = path.join(resourceRoot(platformProjectRoot), 'raw');
    fs.mkdirSync(outsideDirectory);
    fs.mkdirSync(path.dirname(linkedDirectory), { recursive: true });
    fs.symlinkSync(outsideDirectory, linkedDirectory, 'dir');

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon(),
      ]),
    ).rejects.toThrow(/symbolic link/);
    expect(fs.readdirSync(outsideDirectory)).toEqual([]);
    expect(fs.lstatSync(linkedDirectory).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(drawablePath(platformProjectRoot, 'mdpi'))).toBe(false);
  });

  it('rejects an existing destination PNG symlink and preserves its outside target', async () => {
    const { tempRoot, projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const outsideFile = path.join(tempRoot, 'outside-icon.png');
    const destinationPath = drawablePath(platformProjectRoot, 'mdpi');
    fs.writeFileSync(outsideFile, 'outside PNG stays unchanged');
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.symlinkSync(outsideFile, destinationPath, 'file');

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon(),
      ]),
    ).rejects.toThrow(/symbolic link/);
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('outside PNG stays unchanged');
    expect(fs.lstatSync(destinationPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(drawablePath(platformProjectRoot, 'hdpi'))).toBe(false);
  });

  it('rejects a keep file symlink and preserves its outside target before PNG writes', async () => {
    const { tempRoot, projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const outsideFile = path.join(tempRoot, 'outside-keep.xml');
    const destinationPath = keepFilePath(platformProjectRoot);
    fs.writeFileSync(outsideFile, 'outside keep stays unchanged');
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.symlinkSync(outsideFile, destinationPath, 'file');

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon(),
      ]),
    ).rejects.toThrow(/symbolic link/);
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('outside keep stays unchanged');
    expect(fs.lstatSync(destinationPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(drawablePath(platformProjectRoot, 'mdpi'))).toBe(false);
  });

  it('rejects a same-name mipmap qualifier resource without overwriting it', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const mipmapPath = path.join(
      resourceRoot(platformProjectRoot),
      'mipmap-anydpi-v26',
      'notification_message.xml',
    );
    fs.mkdirSync(path.dirname(mipmapPath), { recursive: true });
    fs.writeFileSync(mipmapPath, '<adaptive-icon />');

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon(),
      ]),
    ).rejects.toThrow(/mipmap resource collision/);
    expect(fs.readFileSync(mipmapPath, 'utf8')).toBe('<adaptive-icon />');
    expect(fs.existsSync(drawablePath(platformProjectRoot, 'mdpi'))).toBe(false);
  });

  it('rejects a conflicting drawable extension without deleting it', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const conflictPath = path.join(
      resourceRoot(platformProjectRoot),
      'drawable-mdpi',
      'notification_message.webp',
    );
    fs.mkdirSync(path.dirname(conflictPath), { recursive: true });
    fs.writeFileSync(conflictPath, 'existing webp');

    await expect(
      generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
        createIcon(),
      ]),
    ).rejects.toThrow(/drawable resource collision/);
    expect(fs.readFileSync(conflictPath, 'utf8')).toBe('existing webp');
    expect(fs.existsSync(drawablePath(platformProjectRoot, 'mdpi'))).toBe(false);
  });

  it('overwrites an existing exact density PNG deterministically', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    writeSource(projectRoot);
    const existingPath = drawablePath(platformProjectRoot, 'mdpi');
    fs.mkdirSync(path.dirname(existingPath), { recursive: true });
    fs.writeFileSync(existingPath, 'old PNG contents');

    await generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
      createIcon(),
    ]);

    const pngInfo = await getPngInfo(existingPath);
    expect(pngInfo.width).toBe(24);
    expect(pngInfo.height).toBe(24);
    expect(fs.readFileSync(existingPath, 'utf8')).not.toBe('old PNG contents');
  });

  it('rewrites the keep file with exactly the currently configured icon names', async () => {
    const { projectRoot, platformProjectRoot } = createTempAndroidProject();
    const sourcePath = writeSource(projectRoot);

    await generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
      createIcon('notification_message', sourcePath),
      createIcon('notification_stale', sourcePath),
    ]);
    await generateNotifyKitAndroidNotificationIconResources(projectRoot, platformProjectRoot, [
      createIcon('notification_message', sourcePath),
    ]);

    const keepXml = fs.readFileSync(keepFilePath(platformProjectRoot), 'utf8');
    expect(keepXml).toBe(expectedKeepXml(['notification_message']));
    expect(keepXml).not.toContain('notification_stale');
    expect(keepXml).not.toContain('firebase');
  });
});
