# F4 Hardware E2E Test Procedures

Manual test procedures for verifying the full FCM notification pipeline on real devices. Not automated — run by a developer with physical device access.

## Prerequisites

- Firebase project with FCM enabled (NotifyKitTest or equivalent)
- Service account key at `~/.firebase-notifykittest.json` (never committed)
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
Press "Test handleFcmMessage" button in the smoke app. Expected: notification displays with title/body from the mock payload.

### Test 2: Real FCM push (foreground)
```bash
ts-node scripts/send-test-fcm.ts <token> kitchen-sink
```
Expected: `onMessage` fires → `handleFcmMessage` → notification displays with channelId, pressAction, BIG_TEXT style.

### Test 3: Real FCM push (background)
Put app in background, then send:
```bash
ts-node scripts/send-test-fcm.ts <token> minimal
```
Expected: `setBackgroundMessageHandler` fires → `handleFcmMessage` → notification displays.

### Test 4: Real FCM push (killed)
Force-stop the app, then send. Expected: same as background.

### Test 5: Tap notification
Tap the displayed notification. Expected: app opens, `onForegroundEvent` fires with `EventType.PRESS`.

### Test 6: Action button
Send kitchen-sink payload (has actions). Tap "Reply" action. Expected: background event fires with action ID `reply`.

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
ts-node scripts/send-test-fcm.ts <ios-token> kitchen-sink
```
Expected: `onMessage` fires → `handleFcmMessage` → displayNotification → notification banner with sound.

### Test 2: Real FCM push (background)
Put app in background, then send. Expected: NSE activates → `aps.alert` displayed, `notifee_options` processed by `NotifeeExtensionHelper` → custom sound, thread-id, interruption-level honored.

### Test 3: Real FCM push (killed)
Force-quit the app, then send. Expected: same as background.

### Test 4: Attachments via NSE
Send payload with iOS attachment URL. Expected: NSE downloads and attaches image.

### Test 5: Tap notification
Tap notification. Expected: app launches, press event fires.

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

## `scripts/send-test-fcm.ts` usage

```bash
# Install firebase-admin if not present
npm install -g firebase-admin ts-node

# Set up service account key
# Download from Firebase Console → Project Settings → Service Accounts
# Save as ~/.firebase-notifykittest.json

# Send test notification
ts-node scripts/send-test-fcm.ts <device-token> <scenario>

# Scenarios: minimal | kitchen-sink | emoji | marketing
```

## Expected Results Summary

| Scenario | Android | iOS (foreground) | iOS (background/killed) |
|---|---|---|---|
| Title/body | ✅ from notifee_options | ✅ from notifee_options | ✅ from aps.alert + NSE |
| Custom channelId | ✅ | N/A | N/A |
| BIG_TEXT style | ✅ | N/A | N/A |
| Sound | N/A | ✅ from aps.sound | ✅ from aps.sound |
| Badge | N/A | ✅ from aps.badge | ✅ from aps.badge |
| Attachments | N/A | ✅ via NSE | ✅ via NSE |
| Press event | ✅ | ✅ | ✅ (on tap → app launch) |
