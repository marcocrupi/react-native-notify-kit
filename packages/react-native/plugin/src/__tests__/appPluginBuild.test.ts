import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getPngInfo } from '@expo/image-utils';

import type { AndroidManifest } from '../android/withNotifyKitAndroidManifest';

const BUILT_ENTRY_SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGklEQVR4AWP8z8DwnwEJMDGgASYGNMDEgAYAg9ECBvYVtPAAAAAASUVORK5CYII=',
  'base64',
);
const tempRoots: string[] = [];

function createManifest(): AndroidManifest {
  return {
    manifest: {
      application: [
        {
          service: [],
        },
      ],
    },
  };
}

describe('NotifyKit published Expo app.plugin entrypoint', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('loads plugin/build through app.plugin.js and applies the Android manifest mod', async () => {
    const withAndroidManifest = jest.fn((config, action) =>
      action({
        ...config,
        modResults: createManifest(),
      }),
    );
    const createRunOncePlugin = jest.fn(plugin => plugin);
    jest.doMock(
      'expo/config-plugins',
      () => ({
        createRunOncePlugin,
        withAndroidManifest,
      }),
      { virtual: true },
    );

    const plugin = await import('../../../app.plugin.js');
    const config = plugin.default(
      {},
      {
        android: {
          foregroundService: {
            types: ['shortService'],
          },
        },
      },
    );

    expect(createRunOncePlugin).toHaveBeenCalledTimes(1);
    expect(withAndroidManifest).toHaveBeenCalledTimes(1);
    expect(
      config.modResults.manifest.application[0].service[0].$['android:foregroundServiceType'],
    ).toBe('shortService');
  });

  it('loads plugin/build through app.plugin.js and generates Android notification icons', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notifykit-built-icons-'));
    const projectRoot = path.join(tempRoot, 'expo-project');
    const platformProjectRoot = path.join(tempRoot, 'nonstandard-android-root');
    const sourcePath = path.join(projectRoot, 'assets', 'notification-icon.png');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(platformProjectRoot, { recursive: true });
    fs.writeFileSync(sourcePath, BUILT_ENTRY_SOURCE_PNG);
    tempRoots.push(tempRoot);

    let dangerousModAction:
      | ((config: {
          modRequest: { projectRoot: string; platformProjectRoot: string };
        }) => Promise<unknown>)
      | undefined;
    const withDangerousMod = jest.fn((config, [platform, action]) => {
      expect(platform).toBe('android');
      dangerousModAction = action;
      return config;
    });
    const createRunOncePlugin = jest.fn(plugin => plugin);
    jest.doMock(
      'expo/config-plugins',
      () => ({
        createRunOncePlugin,
        withDangerousMod,
      }),
      { virtual: true },
    );

    const plugin = await import('../../../app.plugin.js');
    const publishedPlugin = plugin.default as unknown as Record<string, unknown>;
    expect(
      Object.prototype.hasOwnProperty.call(
        publishedPlugin,
        'withNotifyKitAndroidNotificationIcons',
      ),
    ).toBe(false);
    expect(publishedPlugin.withNotifyKitAndroidNotificationIcons).toBeUndefined();
    const config = {};
    const configured = plugin.default(config, {
      android: {
        icons: [
          {
            name: 'notification_message',
            path: './assets/notification-icon.png',
            type: 'small',
          },
          {
            name: 'notification_warning',
            path: './assets/notification-icon.png',
            type: 'small',
          },
        ],
      },
    });

    expect(configured).toBe(config);
    expect(createRunOncePlugin).toHaveBeenCalledTimes(1);
    expect(withDangerousMod).toHaveBeenCalledTimes(1);
    expect(dangerousModAction).toBeDefined();

    await dangerousModAction?.({
      modRequest: {
        projectRoot,
        platformProjectRoot,
      },
    });

    const densities = [
      ['mdpi', 24],
      ['hdpi', 36],
      ['xhdpi', 48],
      ['xxhdpi', 72],
      ['xxxhdpi', 96],
    ] as const;
    for (const name of ['notification_message', 'notification_warning']) {
      for (const [density, size] of densities) {
        const outputPath = path.join(
          platformProjectRoot,
          'app',
          'src',
          'main',
          'res',
          `drawable-${density}`,
          `${name}.png`,
        );
        const pngInfo = await getPngInfo(outputPath);

        expect(pngInfo.width).toBe(size);
        expect(pngInfo.height).toBe(size);
      }
    }

    const keepXml = fs.readFileSync(
      path.join(platformProjectRoot, 'app', 'src', 'main', 'res', 'raw', 'notifykit_keep.xml'),
      'utf8',
    );
    expect(keepXml).toBe(
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<resources xmlns:tools="http://schemas.android.com/tools"\n' +
        '    tools:keep="@drawable/notification_message,@drawable/notification_warning" />\n',
    );
  }, 15_000);
});
