'use strict';

const NSE_TARGET_NAME_PATTERN = /^[A-Za-z0-9_\-.]+$/;
const NSE_BUNDLE_SUFFIX_PATTERN = /^\.[A-Za-z0-9\-.]+$/;

const PRODUCT_BUNDLE_IDENTIFIER_PLACEHOLDER = '$(PRODUCT_BUNDLE_IDENTIFIER:default)';

const NOTIFICATION_SERVICE_SWIFT = String.raw`import Foundation
import UserNotifications
import RNNotifeeCore

private func nseLog(_ message: String) {
  NSLog("[NotifyKitNSE] %@", message)
}

private func requestedAttachmentURLs(from userInfo: [AnyHashable: Any]) -> [String] {
  guard let serializedOptions = userInfo["notifee_options"] as? String,
        let data = serializedOptions.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let ios = json["ios"] as? [String: Any],
        let attachments = ios["attachments"] as? [[String: Any]] else {
    return []
  }

  return attachments.compactMap { attachment in
    attachment["url"] as? String
  }
}

class NotificationService: UNNotificationServiceExtension {
  var contentHandler: ((UNNotificationContent) -> Void)?
  var bestAttemptContent: UNMutableNotificationContent?
  private let deliveryLock = NSLock()
  private var didDeliver = false

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    let mutableContent = request.content.mutableCopy() as? UNMutableNotificationContent

    deliveryLock.lock()
    didDeliver = false
    self.contentHandler = contentHandler
    self.bestAttemptContent = mutableContent
    deliveryLock.unlock()

    let requestedAttachmentUrls = requestedAttachmentURLs(from: request.content.userInfo)

    nseLog(
      "didReceive id=\(request.identifier) title=\(request.content.title) " +
        "hasNotifeeOptions=\(request.content.userInfo["notifee_options"] != nil) " +
        "requestedAttachments=\(requestedAttachmentUrls.count) " +
        "urls=\(requestedAttachmentUrls.joined(separator: ","))"
    )

    guard let bestAttemptContent = mutableContent else {
      nseLog("mutableCopy failed for id=\(request.identifier); delivering original content")
      deliverOnce(request.content)
      return
    }

    NotifeeExtensionHelper.populateNotificationContent(
      request,
      with: bestAttemptContent,
      withContentHandler: { [weak self] content in
        let deliveredAttachmentIds = content.attachments.map(\.identifier).joined(separator: ",")
        nseLog(
          "contentHandler id=\(request.identifier) title=\(content.title) " +
            "deliveredAttachments=\(content.attachments.count) " +
            "identifiers=\(deliveredAttachmentIds)"
        )
        self?.deliverOnce(content)
      }
    )
  }

  private func deliverOnce(_ content: UNNotificationContent) {
    var handler: ((UNNotificationContent) -> Void)?

    deliveryLock.lock()
    if !didDeliver {
      didDeliver = true
      handler = contentHandler
      contentHandler = nil
      bestAttemptContent = nil
    }
    deliveryLock.unlock()

    handler?(content)
  }

  override func serviceExtensionTimeWillExpire() {
    deliveryLock.lock()
    let content = bestAttemptContent
    deliveryLock.unlock()

    if let bestAttemptContent = content {
      nseLog(
        "serviceExtensionTimeWillExpire id=\(bestAttemptContent.userInfo["gcm.message_id"] ?? "n/a") " +
          "title=\(bestAttemptContent.title) " +
          "deliveredAttachments=\(bestAttemptContent.attachments.count)"
      )
      deliverOnce(bestAttemptContent)
    }
  }
}
`;

const NSE_INFO_PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>{{TARGET_NAME}}</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundlePackageType</key>
\t<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
\t<key>CFBundleShortVersionString</key>
\t<string>1.0</string>
\t<key>CFBundleVersion</key>
\t<string>1</string>
\t<key>NSExtension</key>
\t<dict>
\t\t<key>NSExtensionPointIdentifier</key>
\t\t<string>com.apple.usernotifications.service</string>
\t\t<key>NSExtensionPrincipalClass</key>
\t\t<string>$(PRODUCT_MODULE_NAME).NotificationService</string>
\t</dict>
</dict>
</plist>
`;

const NSE_ENTITLEMENTS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
`;

function validateNseTargetName(targetName) {
  if (!NSE_TARGET_NAME_PATTERN.test(targetName)) {
    throw new Error(
      `Invalid target name '${targetName}'. Must match [A-Za-z0-9_-.]\n` +
        '  Target names can only contain letters, digits, underscores, hyphens, and dots.',
    );
  }
}

function validateNseBundleSuffix(bundleSuffix) {
  if (!NSE_BUNDLE_SUFFIX_PATTERN.test(bundleSuffix)) {
    throw new Error(
      `Invalid bundle suffix '${bundleSuffix}'. Must start with '.' and contain only letters, digits, hyphens, and dots.`,
    );
  }
}

function deriveNseBundleIdentifier(parentBundleId, suffix, parentTargetName) {
  if (!parentBundleId) {
    return `${PRODUCT_BUNDLE_IDENTIFIER_PLACEHOLDER}${suffix}`;
  }

  if (!parentBundleId.includes('$(') && !parentBundleId.includes('${')) {
    return parentBundleId + suffix;
  }

  const expandedBundleId = expandKnownBundleIdVariables(parentBundleId, parentTargetName);
  if (expandedBundleId && !expandedBundleId.includes('$(') && !expandedBundleId.includes('${')) {
    return expandedBundleId + suffix;
  }

  return `${PRODUCT_BUNDLE_IDENTIFIER_PLACEHOLDER}${suffix}`;
}

function renderNotificationServiceSwift() {
  return NOTIFICATION_SERVICE_SWIFT;
}

function renderNseInfoPlist(options) {
  return NSE_INFO_PLIST_TEMPLATE.replace(/\{\{TARGET_NAME\}\}/g, options.targetName);
}

function renderNseEntitlementsPlist() {
  return NSE_ENTITLEMENTS_PLIST;
}

function expandKnownBundleIdVariables(bundleId, parentTargetName) {
  if (!parentTargetName) {
    return null;
  }

  const normalizedTargetName = toRfc1034Identifier(parentTargetName);

  return bundleId
    .replace(/\$\((?:PRODUCT_NAME|TARGET_NAME):rfc1034identifier\)/g, normalizedTargetName)
    .replace(/\$\{(?:PRODUCT_NAME|TARGET_NAME):rfc1034identifier\}/g, normalizedTargetName)
    .replace(/\$\((?:PRODUCT_NAME|TARGET_NAME)\)/g, parentTargetName)
    .replace(/\$\{(?:PRODUCT_NAME|TARGET_NAME)\}/g, parentTargetName);
}

function toRfc1034Identifier(value) {
  return value.replace(/[^A-Za-z0-9.-]/g, '-');
}

module.exports = {
  deriveNseBundleIdentifier,
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
  validateNseBundleSuffix,
  validateNseTargetName,
};
