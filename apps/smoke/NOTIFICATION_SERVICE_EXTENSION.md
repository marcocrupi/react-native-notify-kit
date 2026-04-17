# iOS Notification Service Extension (NSE) Setup

> **Recommended: use the automated CLI instead.**
> Run `npx react-native-notify-kit init-nse` from your project root.
> See [FCM Mode docs](../../docs/fcm-mode.mdx) for the full guide.
>
> The manual steps below are for projects where the CLI doesn't work
> (Expo managed workflow, custom Xcode configurations, monorepos with
> non-standard iOS paths).

A Notification Service Extension allows your app to modify notification content before it is displayed. This is required for features like media attachments on iOS push notifications.

## Prerequisites

- Xcode installed
- Apple Developer account with push notification capability
- The smoke app (`apps/smoke/ios/NotifeeExample.xcworkspace`) open in Xcode

## Steps

### 1. Create the NSE target

1. Open `NotifeeExample.xcworkspace` in Xcode
2. **File > New > Target...**
3. Select **Notification Service Extension**
4. Name it `NotifeeNSE`
5. Language: **Objective-C**
6. Click **Finish**
7. When prompted "Activate NotifeeNSE scheme?", click **Activate**

### 2. Update the Podfile

Add the NSE target to `ios/Podfile`:

```ruby
target 'NotifeeNSE' do
  pod 'RNNotifeeCore', :path => '../node_modules/react-native-notify-kit'
end
```

Then run:

```bash
cd ios && pod install
```

### 3. Implement the NotificationService

Replace the contents of `NotifeeNSE/NotificationService.m` with:

```objc
#import "NotificationService.h"
#import "NotifeeExtensionHelper.h"

@interface NotificationService ()
@property (nonatomic, strong) void (^contentHandler)(UNNotificationContent *contentToDeliver);
@property (nonatomic, strong) UNMutableNotificationContent *bestAttemptContent;
@end

@implementation NotificationService

- (void)didReceiveNotificationRequest:(UNNotificationRequest *)request
                   withContentHandler:(void (^)(UNNotificationContent *_Nonnull))contentHandler {
    self.contentHandler = contentHandler;
    self.bestAttemptContent = [request.content mutableCopy];

    [NotifeeExtensionHelper populateNotificationContent:request
                                            withContent:self.bestAttemptContent
                                     withContentHandler:contentHandler];
}

- (void)serviceExtensionTimeWillExpire {
    // Deliver the best attempt content before the system kills the extension.
    self.contentHandler(self.bestAttemptContent);
}

@end
```

### 4. Set the deployment target

In Xcode, select the `NotifeeNSE` target and set **Minimum Deployments > iOS** to `15.1` (matching the main app).

### 5. Configure App Groups (optional)

If you need to share data between the main app and the extension:

1. Select the `NotifeeExample` target > **Signing & Capabilities** > **+ Capability** > **App Groups**
2. Add a group: `group.com.notifeeexample`
3. Repeat for the `NotifeeNSE` target with the same group name

### 6. Verify the setup

Build and run the app. When a push notification with an image URL in the payload arrives, the NSE should intercept it and attach the image before display.

## Troubleshooting

- **Pod install fails**: Ensure `RNNotifeeCore.podspec` exists at the path specified. Run `pod install --repo-update` if needed.
- **Extension not called**: Verify the push payload includes `mutable-content: 1` in the `aps` dictionary.
- **Signing errors**: Both the main app and the NSE must use the same team and provisioning profile prefix.
