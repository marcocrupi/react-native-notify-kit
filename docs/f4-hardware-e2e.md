# F4 Hardware E2E Test Procedures

Manual test procedures for verifying the full FCM notification pipeline on real devices.
Not automated — run by a developer with physical device access.

## Prerequisites

- Firebase project with FCM enabled (NotifyKitTest or equivalent)
- Service account key at `./firebase-notifykittest.json` in the repo root (never committed)
- Smoke app deployed to device (`yarn smoke:android` / `yarn smoke:ios`)
- Device token obtained from app logs at startup

## Scenario A — Android (Pixel 9 Pro XL, Android 16)

### Setup

```bash
yarn smoke:android   # Deploy smoke app
# Copy device token from logcat
adb logcat | grep "FCM Token"
```

### Test 1: Local `handleFcmMessage`

Press "Test handleFcmMessage" button in the smoke app.
Expected: notification displays with title/body from the mock payload.

### Test 2: Real FCM push (foreground)

```bash
yarn send:test:fcm <token> kitchen-sink
```

Expected: `onMessage` fires, `handleFcmMessage` runs, notification displays
with channelId, pressAction, BIG_TEXT style.

### Test 3: Real FCM push (background)

Put app in background, then send:

```bash
yarn send:test:fcm <token> minimal
```

Expected: `setBackgroundMessageHandler` fires, `handleFcmMessage` runs,
notification displays.

### Test 4: Real FCM push (killed)

Force-stop the app, then send. Expected: same as background.

### Test 5: Tap notification

Tap the displayed notification.
Expected: app opens, `onForegroundEvent` fires with `EventType.PRESS`.

### Test 6: Action button

Send kitchen-sink payload (has actions). Tap "Reply" action.
Expected: background event fires with action ID `reply`.

### Test 7: BIG_PICTURE image

Put the app in background or kill it, then send:

```bash
yarn send:test:fcm <token> android-big-picture
```

Expected: notification appears with title and body; expanding it from the
drawer reveals the image downloaded from the remote URL. The bitmap is
fetched natively via `ResourceUtils.getImageBitmapFromUrl()` (10s timeout).
The image is only visible while the notification is expanded.

## Scenario B — iOS (real iPhone + NSE)

### Setup

```bash
npx react-native-notify-kit init-nse --ios-path apps/smoke/ios
cd apps/smoke/ios && pod install
# Open NotifeeExample.xcworkspace in Xcode
# Set signing team for both NotifeeExample and NotifyKitNSE targets
# Build and run on device
```

### Test 1: Real FCM push (foreground)

```bash
yarn send:test:fcm <ios-token> kitchen-sink
```

Expected: `onMessage` fires, `handleFcmMessage` runs,
`displayNotification` creates a notification banner with sound.

### Test 2: Real FCM push (background)

Put app in background, then send.
Expected: NSE activates, `aps.alert` displayed, `notifee_options` processed by
`NotifeeExtensionHelper`. Custom sound, thread-id, interruption-level honored.

### Test 3: Real FCM push (killed)

Force-quit the app, then send. Expected: same as background.

### Test 4: Attachments via NSE

Put the app in background or kill it, then send:

```bash
yarn send:test:fcm <ios-token> ios-attachment
```

Expected: NSE downloads and attaches image.

### Test 5: Tap notification

Tap notification.
Expected: app launches, press event fires.

### Debugging NSE

If NSE doesn't activate:

1. Verify payload has `mutable-content: 1` in `aps`
2. Open Console.app, filter by process `NotifyKitNSE`
3. Check Xcode signing: both targets must use same team

### Post-test cleanup

```bash
git checkout apps/smoke/ios/
rm -rf apps/smoke/ios/NotifyKitNSE/
```

## `yarn send:test:fcm` usage

```bash
# Install repo dependencies if needed
yarn install

# Rebuild the server SDK if dist is missing or stale
yarn build:rn:server

# Set up service account key
# Download from Firebase Console > Project Settings > Service Accounts
# Save as firebase-notifykittest.json in the repo root

# Send test notification
yarn send:test:fcm <device-token> <scenario>

# Scenarios: minimal | kitchen-sink | emoji | marketing | ios-attachment | android-big-picture
```

## Expected Results Summary

| Scenario           | Android              | iOS (foreground)     | iOS (background/killed)    |
| ------------------ | -------------------- | -------------------- | -------------------------- |
| Title/body         | from notifee_options | from notifee_options | from aps.alert + NSE       |
| Custom channelId   | yes                  | N/A                  | N/A                        |
| BIG_TEXT style     | yes                  | N/A                  | N/A                        |
| Sound              | N/A                  | from aps.sound       | from aps.sound             |
| Badge              | N/A                  | from aps.badge       | from aps.badge             |
| Images/Attachments | via BIG_PICTURE      | via NSE              | via NSE                    |
| Press event        | yes                  | yes                  | yes (on tap, app launches) |
