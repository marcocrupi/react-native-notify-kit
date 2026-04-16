# F4 Hardware E2E Execution Runbook

Follow this document top-to-bottom. All commands run from the repo root
(`/Users/marcocrupi/Documents/Programmazione/notifee`) unless stated otherwise.

---

## Prerequisites Checklist

### General

- [ ] Branch `feature/fix-issue` at HEAD
- [ ] Node 22+: `node --version`
- [ ] Yarn 4: `yarn --version`
- [ ] Server SDK built: `cd packages/react-native && yarn build:server`

### Firebase Setup

- [ ] Firebase project `NotifyKitTest` with FCM enabled
- [ ] Service account JSON at `./firebase-notifykittest.json` in the repo root
- [ ] Repo dependencies installed: `yarn install`
- [ ] Verify key loads:

```bash
node -e "require(require('path').resolve('firebase-notifykittest.json')); console.log('OK')"
```

### Android (Pixel 9 Pro XL)

- [ ] USB debugging enabled on device
- [ ] `adb devices` shows device connected
- [ ] `apps/smoke/android/app/google-services.json` present

### iOS (iPhone)

- [ ] Apple Developer account with push notification capability
- [ ] `apps/smoke/ios/GoogleService-Info.plist` present
- [ ] Xcode 16.x installed
- [ ] CocoaPods installed: `pod --version`
- [ ] Signing team configured for `NotifeeExample` target in Xcode

---

## Important: Smoke App FCM Integration

The smoke app's foreground FCM handler at `App.tsx:84-91` now uses
`handleFcmMessage` (wired in commit `391bc0e`). The background handler in
`index.js` also uses `handleFcmMessage`. Both have `F4 HARDWARE E2E`
comment markers.

---

## Scenario A — Android (Pixel 9 Pro XL)

### A0: Build and deploy smoke app

```bash
# Terminal 1: start Metro
cd apps/smoke && npx react-native start --reset-cache

# Terminal 2: build and deploy
cd apps/smoke && npx react-native run-android
```

**Expected**: App launches on device. Logcat shows:

```text
[Notifee] startup: default channel created
```

### A1: Get FCM token

In the app, tap **Firebase > getFCMToken**.

**Expected**: Alert dialog shows a long token string.

```bash
adb logcat -s ReactNativeJS | grep "FCM TOKEN"
```

Save the token:

```bash
export FCM_TOKEN="<paste token here>"
```

### A2: FCM push — foreground

Keep the app in the foreground.

```bash
yarn send:test:fcm "$FCM_TOKEN" kitchen-sink
```

**Expected terminal output**:

```text
Sending FCM message:
  Token: <first 20 chars>...
  Scenario: kitchen-sink
  Payload size: ~1940 bytes
Successfully sent. Message ID: projects/notifykittest/messages/...
```

**Expected on device**:

- Notification appears with title "Your order is ready", body "Tap to see details"
- Logcat: `[Notifee] FCM foreground: Your order is ready`
- Logcat: `[Notifee] handleFcmMessage result: <notification-id>`

**Monitor logcat**:

```bash
adb logcat -s ReactNativeJS | grep -E "Notifee|FCM|BackgroundEvent|ForegroundEvent"
```

### A3: FCM push — background

Press the Home button to background the app. Send:

```bash
yarn send:test:fcm "$FCM_TOKEN" minimal
```

**Expected**: Notification appears in the notification shade.
Title: "Hello from NotifyKit".

Logcat:

```text
[BGHandler] received: {"notifee_options":"..."}
[BGHandler] handleFcmMessage result: <notification-id>
```

### A4: FCM push — app killed

Force-stop the app:

```bash
adb shell am force-stop com.notifeeexample
```

Send:

```bash
yarn send:test:fcm "$FCM_TOKEN" emoji
```

**Expected**: Notification appears with title "Launch!", body "Celebration time".
The headless task processes it.

### A5: Tap notification — PRESS event

Tap the notification from A3 or A4.

**Expected**: App opens. Logcat shows:

```text
[Notifee] ForegroundEvent: PRESS id=<id> title=Hello from NotifyKit
```

Alert dialog: "Notifee PRESS (foreground)".

### A6: Action button tap

Send kitchen-sink (has actions):

```bash
yarn send:test:fcm "$FCM_TOKEN" kitchen-sink
```

Pull down the notification to expand it. Tap **"Reply"** action button.

**Expected logcat**:

```text
[BackgroundEvent] ACTION_PRESS id=test-order-42
```

### A7: Verify notifee_options fields

After A2 (kitchen-sink foreground), check logcat:

```bash
adb logcat -s ReactNativeJS | grep "DISPLAYED\|ForegroundEvent"
```

**Verification checklist**:

- [ ] Title: "Your order is ready"
- [ ] Body: "Tap to see details"
- [ ] Channel: "default" (created at startup)
- [ ] BIG_TEXT style: expanded notification shows "Order #42 has shipped from warehouse A."
- [ ] Action buttons visible: "Track" and "Reply"
- [ ] Data preserved: `orderId: "42"`, `source: "send-test-fcm"` in event payload

---

## Scenario B — iOS (iPhone + NSE)

### B0: Scaffold NSE via CLI

```bash
cd /Users/marcocrupi/Documents/Programmazione/notifee

# Build CLI first
cd packages/cli && yarn build && cd ../..

# Run the CLI
node packages/cli/dist/cli.js init-nse --ios-path apps/smoke/ios
```

**Expected output**:

```text
Detected iOS project at apps/smoke/ios/NotifeeExample.xcodeproj
Parent bundle ID uses a variable...
Bundle ID: ...
Created ios/NotifyKitNSE/NotificationService.swift
Created ios/NotifyKitNSE/Info.plist
Created ios/NotifyKitNSE/NotifyKitNSE.entitlements
Updated ios/Podfile
Updated ios/NotifeeExample.xcodeproj
```

**Verify files**:

```bash
ls apps/smoke/ios/NotifyKitNSE/
# Expected: Info.plist  NotificationService.swift  NotifyKitNSE.entitlements

cat apps/smoke/ios/NotifyKitNSE/NotificationService.swift | grep withContent
# Expected: withContent: bestAttemptContent,
```

### B1: Pod install + Xcode build + deploy

```bash
cd apps/smoke/ios
pod install
```

**Expected**: `Pod installation complete! There are 87 dependencies...`

```bash
open NotifeeExample.xcworkspace
```

In Xcode:

1. Select **NotifyKitNSE** target, Signing & Capabilities
2. Set your Team (same as the main app)
3. Set a bundle identifier (e.g., `com.yourteam.notifeeexample.NotifyKitNSE`)
4. Select the main **NotifeeExample** target
5. Select your physical iPhone as the run destination
6. Build and Run (`Cmd+R`)

**Expected**: App deploys to iPhone. No build errors.

### B2: Get FCM token on iOS

In the app, tap **Firebase > getFCMToken**.

Save the iOS token:

```bash
export IOS_FCM_TOKEN="<paste ios token here>"
```

### B3: FCM push — foreground (iOS)

Keep the app in foreground. Send:

```bash
cd /Users/marcocrupi/Documents/Programmazione/notifee
yarn send:test:fcm "$IOS_FCM_TOKEN" kitchen-sink
```

**Expected**: Notification banner appears with title "Your order is ready".
Sound plays. Xcode console shows the FCM received log.

### B4: FCM push — background (NSE path)

Press Home to background the app. Send:

```bash
yarn send:test:fcm "$IOS_FCM_TOKEN" minimal
```

**Expected**: Notification appears on lock screen / notification center.
Title: "Hello from NotifyKit". The NSE activated and processed `notifee_options`.

**Debug NSE** if notification doesn't appear:

1. Open **Console.app** on your Mac
2. Select the iPhone device
3. Filter by process: `NotifyKitNSE`
4. Look for `NotifeeExtensionHelper.populateNotificationContent` logs

### B5: FCM push — app killed (NSE path)

Force-quit the app (swipe up from app switcher). Send:

```bash
yarn send:test:fcm "$IOS_FCM_TOKEN" emoji
```

**Expected**: Notification with "Launch!" appears. NSE processes it
identically to background.

### B6: Verify iOS-specific fields

Send kitchen-sink:

```bash
yarn send:test:fcm "$IOS_FCM_TOKEN" kitchen-sink
```

**Verification checklist (background/killed)**:

- [ ] Sound plays (custom sound from `aps.sound: "default"`)
- [ ] Badge count shows 1 on app icon
- [ ] Thread grouping: notifications with `threadId: "orders"` are grouped
- [ ] Interruption level: `timeSensitive` breaks through Do Not Disturb

### B7: Tap notification — app launches

Tap a notification from B4/B5.

**Expected**: App opens. If foreground event handler is registered, the PRESS
event fires.

### B8: Revert smoke app

```bash
cd /Users/marcocrupi/Documents/Programmazione/notifee
git checkout apps/smoke/ios/
rm -rf apps/smoke/ios/NotifyKitNSE/

# If you modified index.js / App.tsx for Option A:
git checkout apps/smoke/index.js apps/smoke/App.tsx

# Verify clean
git status -- apps/smoke/
# Expected: nothing modified
```

---

## Failure Diagnosis Guide

### Android — notification doesn't appear

1. **No FCM token**: Check `google-services.json` matches the Firebase project.
   Reinstall the app.
2. **Channel not created**: Logcat should show `startup: default channel created`.
   If not, the app crashed at startup.
3. **Data-only message blocked**: Some OEMs (Samsung, Xiaomi) restrict background
   data messages. Check device battery optimization settings for `com.notifeeexample`.

### Android — `handleFcmMessage` not called

1. **Background handler not registered**: Check `index.js` has
   `messaging().setBackgroundMessageHandler(...)` before `AppRegistry.registerComponent`.
2. **`notifee_options` missing from data**: Verify `yarn send:test:fcm` output
   shows non-zero payload size.

### iOS — NSE not activating

1. **`mutable-content: 1` missing**: All NotifyKit payloads include this.
   Verify with `yarn send:test:fcm` output.
2. **Signing mismatch**: NSE target must use the same Apple Team as the main app.
3. **NSE crashed**: Check Console.app filtered by `NotifyKitNSE` process.
4. **Pod not installed**: Run `cd apps/smoke/ios && pod install` again.

### iOS — `pod install` fails

1. **"Unable to find host target"**: The CLI's Podfile patching creates a nested
   target inside the main app target. If the Podfile was manually modified, the
   nesting may be broken.
   Check: `cat apps/smoke/ios/Podfile | grep -A3 NotifyKitNSE`.
2. **Dependency conflict**: Run `pod install --repo-update`.

### `yarn send:test:fcm` — "Send failed"

1. **Invalid token**: Tokens expire. Get a fresh one via the app's getFCMToken button.
2. **Service account key**: Verify `firebase-notifykittest.json` exists in the repo root and
   has the correct project.
3. **Payload too large**: Check `Payload size:` in the output. Must be under 4096 bytes.

---

## Test Results Log

Fill in during execution:

| Test                        | Status | Notes |
| --------------------------- | ------ | ----- |
| A1 getFCMToken              |        |       |
| A2 FCM foreground           |        |       |
| A3 FCM background           |        |       |
| A4 FCM killed               |        |       |
| A5 Tap, PRESS               |        |       |
| A6 Action button            |        |       |
| A7 notifee_options fields   |        |       |
| B0 CLI init-nse             |        |       |
| B1 pod install + build      |        |       |
| B2 getFCMToken (iOS)        |        |       |
| B3 FCM foreground (iOS)     |        |       |
| B4 FCM background (NSE)     |        |       |
| B5 FCM killed (NSE)         |        |       |
| B6 iOS fields (sound/badge) |        |       |
| B7 Tap, app launch          |        |       |
| B8 Revert clean             |        |       |
