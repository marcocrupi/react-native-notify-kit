'use strict';

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_NSE_CURRENT_PROJECT_VERSION,
  DEFAULT_NSE_MARKETING_VERSION,
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
} = require('../shared/nse/initNseCore');

const MARKETING_VERSION_MARKER = '__NOTIFYKIT_NSE_MARKETING_VERSION__';
const CURRENT_PROJECT_VERSION_MARKER = '__NOTIFYKIT_NSE_CURRENT_PROJECT_VERSION__';

function withNotifyKitIosNseFiles(config, nseOptions) {
  if (!nseOptions.enabled) {
    return config;
  }

  const { withDangerousMod } = requireExpoConfigPlugins();

  return withDangerousMod(config, [
    'ios',
    modConfig => {
      writeNotifyKitIosNseFiles(
        modConfig.modRequest.platformProjectRoot,
        nseOptions.targetName,
        resolveNseVersionOptions(modConfig),
      );
      return modConfig;
    },
  ]);
}

function writeNotifyKitIosNseFiles(
  platformProjectRoot,
  targetName,
  versionOptions = {
    marketingVersion: DEFAULT_NSE_MARKETING_VERSION,
    currentProjectVersion: DEFAULT_NSE_CURRENT_PROJECT_VERSION,
  },
) {
  const targetDir = path.join(platformProjectRoot, targetName);
  fs.mkdirSync(targetDir, { recursive: true });

  writeFileIfMissingOrIdentical(
    path.join(targetDir, 'NotificationService.swift'),
    renderNotificationServiceSwift(),
  );
  writeFileIfMissingOrIdentical(
    path.join(targetDir, 'Info.plist'),
    renderNseInfoPlist({ targetName, ...versionOptions }),
    contents => reconcileGeneratedNseInfoPlist(contents, targetName, versionOptions),
  );
  writeFileIfMissingOrIdentical(
    path.join(targetDir, `${targetName}.entitlements`),
    renderNseEntitlementsPlist(),
  );
}

function resolveNseVersionOptions(config) {
  return {
    marketingVersion: optionalString(config.version) ?? DEFAULT_NSE_MARKETING_VERSION,
    currentProjectVersion:
      optionalString(config.ios?.buildNumber) ?? DEFAULT_NSE_CURRENT_PROJECT_VERSION,
  };
}

function optionalString(value) {
  return typeof value === 'string' ? value : undefined;
}

// React Native's post_install (NewArchitectureHelper.set_RCTNewArchEnabled_in_info_plist)
// appends this exact top-level entry to every target Info.plist, including the NSE.
// Recognize only its canonical serialization immediately before the root </dict>, and
// carry it over unchanged; NotifyKit never creates, removes or edits it.
const RN_NEW_ARCH_ENABLED_ENTRY_PATTERN =
  '(\\t<key>RCTNewArchEnabled</key>\\n\\t<(?:true|false)/>\\n)?';
const ROOT_DICT_END = '</dict>\n</plist>\n';

// Returns the contents to keep for a NotifyKit-generated Info.plist (refreshed version
// fields plus any preserved tooling entry), or null when the file has consumer changes.
function reconcileGeneratedNseInfoPlist(contents, targetName, versionOptions) {
  const toolingEntry = matchGeneratedNseInfoPlist(contents, targetName);
  if (toolingEntry === null) {
    return null;
  }

  const generated = renderNseInfoPlist({ targetName, ...versionOptions });
  if (!generated.endsWith(ROOT_DICT_END)) {
    return null;
  }

  return generated.slice(0, -ROOT_DICT_END.length) + toolingEntry + ROOT_DICT_END;
}

// Returns the exact optional tooling entry ('' when absent), or null when the contents
// are not the generated template.
function matchGeneratedNseInfoPlist(contents, targetName) {
  const templateWithMarkers = renderNseInfoPlist({
    targetName,
    marketingVersion: MARKETING_VERSION_MARKER,
    currentProjectVersion: CURRENT_PROJECT_VERSION_MARKER,
  });
  if (!templateWithMarkers.endsWith(ROOT_DICT_END)) {
    return null;
  }

  const escapedTemplateBody = escapeRegExp(templateWithMarkers.slice(0, -ROOT_DICT_END.length))
    .replace(MARKETING_VERSION_MARKER, '[^<]*')
    .replace(CURRENT_PROJECT_VERSION_MARKER, '[^<]*');
  const match = new RegExp(
    `^${escapedTemplateBody}${RN_NEW_ARCH_ENABLED_ENTRY_PATTERN}${escapeRegExp(ROOT_DICT_END)}$`,
  ).exec(contents);

  return match ? (match[1] ?? '') : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeFileIfMissingOrIdentical(filePath, contents, reconcile) {
  if (fs.existsSync(filePath)) {
    const currentContents = fs.readFileSync(filePath, 'utf8');
    if (currentContents !== contents) {
      const reconciledContents = reconcile?.(currentContents) ?? null;
      if (reconciledContents !== null) {
        if (reconciledContents !== currentContents) {
          fs.writeFileSync(filePath, reconciledContents, 'utf8');
        }
        return;
      }

      throw new Error(
        `[react-native-notify-kit] Refusing to overwrite existing ${filePath}. ` +
          'Delete it or make it match the generated NotifyKit NSE template.',
      );
    }
    return;
  }

  fs.writeFileSync(filePath, contents, 'utf8');
}

function requireExpoConfigPlugins() {
  try {
    return require('expo/config-plugins');
  } catch (error) {
    try {
      return require(require.resolve('expo/config-plugins', { paths: [process.cwd()] }));
    } catch {
      throw error;
    }
  }
}

module.exports = {
  withNotifyKitIosNseFiles,
  writeNotifyKitIosNseFiles,
};
