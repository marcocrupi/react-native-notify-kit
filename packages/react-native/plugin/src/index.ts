import { normalizeNotifyKitPluginOptions, type NotifyKitPluginOptions } from './options';
import { withNotifyKitAndroidManifest } from './android/withNotifyKitAndroidManifest';
import { withNotifyKitAndroidNotificationIcons } from './android/withNotifyKitAndroidNotificationIcons';
import {
  withNotifyKitIosNseAppExtension,
  type ExpoConfigLike,
} from './ios/withNotifyKitIosNseAppExtension';
import { withNotifyKitIosNseFiles } from './ios/withNotifyKitIosNseFiles';
import { withNotifyKitIosNsePodfile } from './ios/withNotifyKitIosNsePodfile';
import { withNotifyKitIosNseXcodeProject } from './ios/withNotifyKitIosNseXcodeProject';

type ConfigPlugin<TProps> = (config: ExpoConfigLike, props?: TProps) => ExpoConfigLike;

declare const require: {
  (id: string): unknown;
  resolve(id: string, options?: { paths?: string[] }): string;
};

declare const process: {
  cwd(): string;
};

const pkg = require('../../package.json') as { name: string; version: string };
const { createRunOncePlugin } = requireExpoConfigPlugins();

export const withNotifyKit: ConfigPlugin<NotifyKitPluginOptions | undefined> = (
  config,
  props = {},
) => {
  const options = normalizeNotifyKitPluginOptions(props);
  const foregroundServiceOptions = options.android.foregroundService;
  const notificationIcons = options.android.icons;
  const nseOptions = options.ios.notificationServiceExtension;
  const configWithAndroidManifest = withNotifyKitAndroidManifest(config, foregroundServiceOptions);
  const configWithAndroidNotificationIcons = withNotifyKitAndroidNotificationIcons(
    configWithAndroidManifest,
    notificationIcons,
  );
  const configWithAppExtension = withNotifyKitIosNseAppExtension(
    configWithAndroidNotificationIcons,
    nseOptions,
  );
  const configWithFiles = withNotifyKitIosNseFiles(configWithAppExtension, nseOptions);
  const configWithXcodeProject = withNotifyKitIosNseXcodeProject(configWithFiles, nseOptions);

  return withNotifyKitIosNsePodfile(configWithXcodeProject, nseOptions);
};

export default createRunOncePlugin(withNotifyKit, pkg.name, pkg.version);

function requireExpoConfigPlugins(): {
  createRunOncePlugin: (
    plugin: ConfigPlugin<NotifyKitPluginOptions | undefined>,
    name: string,
    version: string,
  ) => ConfigPlugin<NotifyKitPluginOptions | undefined>;
} {
  try {
    return require('expo/config-plugins') as ReturnType<typeof requireExpoConfigPlugins>;
  } catch (error) {
    try {
      const expoConfigPluginsPath = require.resolve('expo/config-plugins', {
        paths: [process.cwd()],
      });

      return require(expoConfigPluginsPath) as ReturnType<typeof requireExpoConfigPlugins>;
    } catch {
      throw error;
    }
  }
}
