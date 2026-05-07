export {
  deriveNseBundleIdentifier,
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
  validateNseBundleSuffix,
  validateNseTargetName,
} from './initNseCore';
export {
  patchPodfileForNotifyKitNse,
  type NotifyKitNsePodfilePatchOptions,
  type NotifyKitNsePodfilePatchResult,
} from './patchPodfile';
export {
  patchXcodeProjectForNotifyKitNse,
  type NotifyKitNseXcodePatchOptions,
  type NotifyKitNseXcodePatchResult,
  type XcodeProject,
} from './patchXcodeProject';
