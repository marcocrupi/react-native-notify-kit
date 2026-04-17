# Notify Kit FCM Mode

A delivery pattern for apps that want **`react-native-notify-kit` as the sole display layer for FCM push notifications** on both Android and iOS.

FCM Mode solves two problems at once: the Android `notification`-payload duplicate (the system tray draws the push, and then your client draws it again via `displayNotification`) and the iOS data-only payload drop rate (APNs throttles silent pushes aggressively — ~30–60% loss is typical on real devices). It uses a **different FCM payload shape per platform** but the same developer API, so the asymmetry is invisible to your app code.

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Server SDK reference](#server-sdk-reference)
- [Client API reference](#client-api-reference)
- [iOS NSE setup](#ios-nse-setup)
- [Android specifics](#android-specifics)
- [Payload reference](#payload-reference)
- [Migration from the manual pattern](#migration-from-the-manual-pattern)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Comparison with other libraries](#comparison-with-other-libraries)

## Overview

### The problem

FCM has two delivery modes, and neither is a good default for apps that use Notify Kit for display:

| Payload shape | Android behavior | iOS behavior |
| --- | --- | --- |
| `notification` (alert) | OS auto-displays via the FCM SDK. If you also call `displayNotification` in `setBackgroundMessageHandler`, you get **two tray entries**. Custom `data` is routed to the tap `PendingIntent` only, so `getDisplayedNotifications()` can't see it (tracked at [firebase-android-sdk#2639](https://github.com/firebase/firebase-android-sdk/issues/2639)). | APNs delivers reliably. If you want Notify Kit to rewrite the notification (attachments, categories, custom sound), you need a Notification Service Extension. |
| `data` only | OS wakes your app and you call `displayNotification` yourself — clean, but iOS treats these as silent pushes and throttles / drops them aggressively. Real-device loss rates of **30–60%** are typical; worse under Low Power Mode and with the app force-quit. | Same delivery throttling as above. Unusable for user-facing pushes. |

### The solution

FCM Mode picks the right payload per platform and hides the asymmetry behind a single developer API:

- **Android** uses a **data-only** payload, so the FCM SDK never auto-displays. Your app receives the message in `setBackgroundMessageHandler` / `onMessage` and calls `notifee.handleFcmMessage(remoteMessage)` — a one-liner that parses the embedded `notifee_options` blob and renders the notification with full control over channel, style, actions, etc.
- **iOS** uses an **alert payload** (`aps.alert`) with `mutable-content: 1` and a `notifee_options` blob in `apns.payload`. A Notification Service Extension reads the blob, reshapes the notification (attachments, category, thread-id, interruption level, sound), and the OS displays the rewritten content. APNs reliability (~99% on APNs priority 10) instead of the silent-push throttle.
- The **server SDK** (`react-native-notify-kit/server`) generates both payload shapes from one `buildNotifyKitPayload(input)` call, so your backend doesn't care about the split.
- The **CLI** (`npx react-native-notify-kit init-nse`) scaffolds the iOS NSE target, patches the Podfile, and wires the `.pbxproj` — the one-time iOS setup is a single command.

If you're already using the "data-only + `displayNotification` from headless task" pattern documented in the main README, FCM Mode is a superset: it replaces the iOS half with an alert + NSE path that doesn't drop pushes. See the [migration guide](#migration-from-the-manual-pattern) below.

### When to use FCM Mode

Use it when:

- You send push notifications from a Node.js backend (or Firebase Cloud Functions) and want one library to own display on both platforms.
- You need consistent behavior across platforms (styles, channels, actions, attachments, tap handling) without maintaining platform branches server-side.
- You want iOS APNs delivery reliability without giving up client-side control over presentation.

Stick with a simpler pattern when:

- You only ship Android, or only ship iOS — the asymmetry cost disappears.
- You're happy with iOS data-only drops — many marketing / engagement notifications are fine at 60% delivery.
- You can't run a Notification Service Extension (Expo managed workflow currently — see [Known limitations](#known-limitations)).

## Architecture

```text
  ┌──────────────────┐
  │ Your backend     │
  │ (Node.js / CFns) │
  └────────┬─────────┘
           │  buildNotifyKitPayload({ token, notification, options })
           ▼
  ┌──────────────────────────────────────┐
  │ react-native-notify-kit/server       │
  │  - Android: data-only payload        │
  │  - iOS:     aps.alert + mutable=1    │
  │  - notifee_options blob (identical)  │
  └────────┬─────────────────────────────┘
           │  admin.messaging().send(message)
           ▼
  ┌──────────────────┐                  ┌──────────────────┐
  │ FCM service      │ ──► Android ──►  │ Device (app)     │
  │ (HTTP v1)        │                  │ setBackgroundMsg │
  │                  │                  │ Handler → ...    │
  │                  │                  │ handleFcmMessage │
  │                  │                  │ → displayNotif.  │
  │                  │                  └──────────────────┘
  │                  │
  │                  │ ──► iOS (APNs) ► ┌──────────────────┐
  │                  │                  │ NSE (NotifyKit-  │
  │                  │                  │ NSE.appex)       │
  │                  │                  │ - reads blob     │
  │                  │                  │ - attachments    │
  │                  │                  │ - OS draws it    │
  │                  │                  └──────────────────┘
  └──────────────────┘
```

The `notifee_options` blob is byte-identical on both platforms — on Android it rides in `data.notifee_options`, on iOS in `apns.payload.notifee_options`. Title and body are duplicated into `aps.alert` on iOS so the OS can display the initial banner before the NSE finishes. Each platform ignores the fields the other platform needs.

## Quick start

### 1. Install

```bash
yarn add react-native-notify-kit @react-native-firebase/app @react-native-firebase/messaging
```

The CLI and the server SDK ship with the main package — no extra installs.

### 2. Server: build and send the payload

```ts
// server/sendNotification.ts
import { buildNotifyKitPayload } from 'react-native-notify-kit/server';
import * as admin from 'firebase-admin';

admin.initializeApp();

export async function sendOrderUpdate(deviceToken: string, orderId: string) {
  const message = buildNotifyKitPayload({
    token: deviceToken,
    notification: {
      id: `order-${orderId}`,
      title: 'Your order is on the way',
      body: 'Tap to see live tracking.',
      data: { orderId, screen: 'tracking' },
      android: {
        channelId: 'orders',
        smallIcon: 'ic_notification',
        color: '#4CAF50',
        pressAction: { id: 'open-order', launchActivity: 'default' },
      },
      ios: {
        sound: 'default',
        categoryId: 'ORDER_UPDATE',
        interruptionLevel: 'timeSensitive',
        attachments: [{ url: 'https://cdn.example.com/orders/42.png' }],
      },
    },
    options: {
      androidPriority: 'high',
      iosBadgeCount: 1,
      ttl: 3600,
    },
  });

  await admin.messaging().send(message);
}
```

### 3. Android client: wire `handleFcmMessage`

In your app's `index.js` (before `AppRegistry.registerComponent`):

```ts
// index.js
import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from 'react-native-notify-kit';
import App from './App';

// Optional: configure defaults once at startup
notifee.setFcmConfig({
  defaultChannelId: 'default',
  defaultPressAction: { id: 'default', launchActivity: 'default' },
});

// Create the channel your payloads reference
notifee.createChannel({ id: 'orders', name: 'Orders', importance: AndroidImportance.HIGH });
notifee.createChannel({ id: 'default', name: 'Default', importance: AndroidImportance.HIGH });

// Background + killed state
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await notifee.handleFcmMessage(remoteMessage);
});

AppRegistry.registerComponent('MyApp', () => App);
```

And in a component for foreground delivery:

```tsx
// App.tsx
import { useEffect } from 'react';
import messaging from '@react-native-firebase/messaging';
import notifee from 'react-native-notify-kit';

export default function App() {
  useEffect(() => {
    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      await notifee.handleFcmMessage(remoteMessage);
    });
    return unsubscribe;
  }, []);

  // ... your UI
}
```

That's it for Android. On iOS the same `handleFcmMessage` call is a no-op in background/killed (the NSE has already displayed the notification); in foreground it displays the in-app banner as usual.

### 4. iOS client: scaffold the NSE

From your project root:

```bash
npx react-native-notify-kit init-nse
cd ios && pod install
```

This creates a `NotifyKitNSE` target, patches the Podfile, and wires `.pbxproj`. Open `ios/<YourApp>.xcworkspace` in Xcode, verify the NSE target's signing, then build. Full detail in [iOS NSE setup](#ios-nse-setup).

### 5. Verify

Send a test payload to a real device. The notification should:

- Display once on both platforms (no duplicates).
- Show any attachments, category actions, thread-id grouping, and custom sounds server-side.
- Fire the `EventType.PRESS` event on tap, with `detail.notification.data` containing your custom `data` fields.

Keep reading for the full API surface and error cases.

## Server SDK reference

Import from `react-native-notify-kit/server`. Runs in Node.js 22+ and Firebase Cloud Functions. Zero runtime dependencies.

### `buildNotifyKitPayload(input): NotifyKitPayloadOutput`

Builds a complete FCM HTTP v1 `Message` object ready for `admin.messaging().send()`. Validates input, serializes the `notifee_options` blob, and emits both the Android data-only half and the iOS APNs alert half.

```ts
const message = buildNotifyKitPayload({
  token: 'eZ...device token',
  notification: { id, title, body, data?, android?, ios? },
  options: { androidPriority?, iosBadgeCount?, ttl?, collapseKey? },
});
```

Input type:

```ts
type NotifyKitPayloadInput = {
  // Exactly one of these three:
  token?: string;      // single device
  topic?: string;      // FCM topic (e.g. 'news', 'sports')
  condition?: string;  // FCM condition expression

  notification: NotifyKitNotification;
  options?: NotifyKitOptions;
};

type NotifyKitNotification = {
  id?: string;         // also used as collapse key unless options.collapseKey is set
  title: string;       // required, non-empty
  body: string;        // required, non-empty
  data?: Record<string, string>;
  android?: NotifyKitAndroidConfig;
  ios?: NotifyKitIosConfig;
};

type NotifyKitAndroidConfig = {
  channelId?: string;
  smallIcon?: string;
  largeIcon?: string;
  color?: string;
  pressAction?: { id: string; launchActivity?: string };
  actions?: Array<{ title: string; pressAction: { id; launchActivity? }; input?: boolean }>;
  style?: { type: 'BIG_TEXT'; text: string } | { type: 'BIG_PICTURE'; picture: string };
};

type NotifyKitIosConfig = {
  sound?: string;
  categoryId?: string;
  threadId?: string;
  interruptionLevel?: 'passive' | 'active' | 'timeSensitive' | 'critical';
  attachments?: Array<{ url: string; identifier?: string }>;
};

type NotifyKitOptions = {
  androidPriority?: 'high' | 'normal';
  iosBadgeCount?: number;   // non-negative integer
  ttl?: number;             // seconds, positive integer
  collapseKey?: string;
};
```

The returned value is a valid FCM `Message`:

```ts
type NotifyKitPayloadOutput = {
  token?: string;
  topic?: string;
  condition?: string;
  data: Record<string, string>;      // your data keys + notifee_options (+ notifee_data when > 5 keys)
  android: {
    priority: 'HIGH' | 'NORMAL';
    collapse_key?: string;
    ttl?: string;                    // '3600s' format
  };
  apns: {
    headers: {
      'apns-push-type': 'alert';
      'apns-priority': '10';
      'apns-collapse-id'?: string;
      'apns-expiration'?: string;
    };
    payload: {
      aps: {
        alert: { title; body };
        'mutable-content': 1;
        sound?; category?; 'thread-id'?; 'interruption-level'?; badge?;
      };
      notifee_options: string;       // JSON blob, see Payload reference
      notifee_data?: string;
    };
  };
  sizeBytes: number;                 // non-enumerable — not serialized with JSON.stringify
};
```

`sizeBytes` is defined as **non-enumerable**: it's accessible on the returned object for your own diagnostics, but `JSON.stringify(message)` strips it, so it never leaks onto the wire.

### Other exports

```ts
import {
  buildNotifyKitPayload,      // main entry
  buildAndroidPayload,         // android half only — for custom merging
  buildIosApnsPayload,         // iOS half only — for custom merging
  serializeNotifeeOptions,    // JSON-serialize the blob directly
} from 'react-native-notify-kit/server';

import type {
  NotifyKitPayloadInput,
  NotifyKitPayloadOutput,
  NotifyKitNotification,
  NotifyKitOptions,
  NotifyKitAndroidConfig,
  NotifyKitIosConfig,
  NotifyKitPressAction,
  NotifyKitAndroidAction,
  NotifyKitAndroidStyle,
  NotifyKitIosAttachment,
  NotifyKitIosInterruptionLevel,
  // raw FCM output shapes
  NotifyKitAndroidOutput,
  NotifyKitApnsOutput,
  NotifyKitApnsAps,
  NotifyKitApnsHeaders,
  NotifyKitApnsPayload,
  SerializedNotifeeOptions,
  ApnsInterruptionLevel,
} from 'react-native-notify-kit/server';
```

### Validation rules

Every error is thrown synchronously from `buildNotifyKitPayload`. Error messages are prefixed with `[react-native-notify-kit/server]` so they're grep-able in Cloud Functions logs.

| Rule | Error message |
| --- | --- |
| Input must be an object | `Validation: input must be an object` |
| Exactly one of `token` / `topic` / `condition` | `Routing: exactly one of 'token', 'topic', or 'condition' must be provided. Got: <n>` |
| `token` non-empty string | `Routing: 'token' must be a non-empty string` |
| `topic` non-empty string | `Routing: 'topic' must be a non-empty string` |
| `condition` non-empty string | `Routing: 'condition' must be a non-empty string` |
| `notification` required | `Validation: 'notification' is required and must be an object` |
| `notification.id` non-empty when provided | `Validation: notification.id must be a non-empty string when provided` |
| `notification.title` required | `Validation: notification.title is required and must be a non-empty string` |
| `notification.body` required | `Validation: notification.body is required and must be a non-empty string` |
| `notification.data` must be an object | `Validation: 'notification.data' must be an object` |
| `data` values must be strings | `Validation: FCM data values must be strings. Got <type> for key '<key>'. Use JSON.stringify() if you need to pass complex values.` |
| Reserved keys rejected | `Validation: 'notifee_options' and 'notifee_data' are reserved keys and cannot be used in notification.data` |
| iOS attachments array | `iOS: 'notification.ios.attachments' must be an array` |
| iOS attachment shape | `iOS: each attachment must be an object with a string 'url' field` |
| iOS attachment https-only | `iOS: iOS attachments require https:// URLs. Got: <url>` |
| iOS interruptionLevel enum | `Validation: invalid interruptionLevel '<value>'. Expected one of: passive, active, timeSensitive, critical` |
| `options` must be an object | `Validation: 'options' must be an object` |
| `options.androidPriority` enum | `Validation: 'options.androidPriority' must be 'high' or 'normal'. Got: <value>` |
| `options.iosBadgeCount` non-negative int | `Validation: 'options.iosBadgeCount' must be a non-negative integer` |
| `options.ttl` positive int | `Validation: options.ttl must be a positive integer (seconds). Got: <value>` |
| `options.collapseKey` non-empty | `Validation: 'options.collapseKey' must be a non-empty string` |
| Blob must be serializable | `Serialization: notifee_options contains circular references or non-serializable values` |

> **Note on `ttl: 0`.** Zero is rejected because it's semantically ambiguous ("never expire" vs "expire immediately") and FCM's HTTP v1 API uses the same string format for both concepts. Omit `ttl` entirely to use FCM's default (4 weeks), or pass a positive integer in seconds.

<!-- markdownlint-disable-next-line MD028 -->

> **Note on `firebase-admin` TTL compatibility.** `buildNotifyKitPayload` emits `android.ttl` in FCM HTTP v1 wire format (`"3600s"`), which is what the FCM REST API expects. `firebase-admin`'s `admin.messaging().send()` validates input in the SDK layer before serializing and expects `ttl` as a **number of milliseconds** (`3_600_000`). If you route through `firebase-admin` and pass `options.ttl`, normalize it before sending:
>
> ```ts
> const message = buildNotifyKitPayload(input);
> if (typeof message.android.ttl === 'string') {
>   const match = message.android.ttl.match(/^(\d+)s$/);
>   if (match) (message.android as any).ttl = Number(match[1]) * 1000;
> }
> await admin.messaging().send(message);
> ```
>
> See [`scripts/send-test-fcm.js`](../scripts/send-test-fcm.js) in this repo for the reference adapter.

### Payload size

FCM has a **4 KB hard limit** per message (the HTTP v1 `Message` JSON, not just your `data` map). The server SDK emits a `console.warn` when the serialized payload exceeds ~3500 bytes — enough headroom for FCM's own wrapping. Size is measured with `Buffer.byteLength(json, 'utf8')`, so emoji and CJK characters are counted correctly.

```text
[react-native-notify-kit/server] Payload size 3612 bytes approaches FCM 4KB limit. Consider reducing notifee_options.
```

Read `output.sizeBytes` for programmatic checks:

```ts
const message = buildNotifyKitPayload(input);
if (message.sizeBytes > 3500) {
  // fall back to a smaller payload, split across two messages, or switch to a
  // backend fetch (push a small "something new" nudge and fetch the full
  // content from your API when the app opens)
}
```

### Reserved keys

These keys are **rejected** in `notification.data` (the SDK throws):

- `notifee_options`
- `notifee_data`

These keys are **preserved** by the SDK but have special meaning on the client:

- Anything matching FCM's own denylist (`from`, `collapse_key`, `message_type`, `message_id`, `aps`, `fcm_options`, and prefix filters `google.`, `gcm.`, `fcm.`, `android.`, `notifee`) — the FCM SDK strips these before delivery anyway.

### Firebase Cloud Functions example

```ts
// functions/src/index.ts
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { buildNotifyKitPayload } from 'react-native-notify-kit/server';
import * as admin from 'firebase-admin';

admin.initializeApp();

export const onOrderCreated = onDocumentCreated('orders/{orderId}', async (event) => {
  const order = event.data?.data();
  if (!order?.deviceToken) return;

  const message = buildNotifyKitPayload({
    token: order.deviceToken,
    notification: {
      id: `order-${event.params.orderId}`,
      title: 'Order received',
      body: `We're preparing ${order.itemName}.`,
      data: { orderId: event.params.orderId },
      android: { channelId: 'orders' },
      ios: { sound: 'default', interruptionLevel: 'timeSensitive' },
    },
    options: { androidPriority: 'high', ttl: 3600 },
  });

  await admin.messaging().send(message);
});
```

## Client API reference

Import the default `notifee` module — `handleFcmMessage` and `setFcmConfig` are instance methods on the singleton.

### `notifee.handleFcmMessage(remoteMessage): Promise<string | null>`

Processes an FCM remote message produced by the server SDK and displays a Notify Kit notification according to the embedded `notifee_options`. Safe to call from both `setBackgroundMessageHandler` and `onMessage`.

**Returns:** the displayed notification ID, or `null` if the call was an intentional no-op.

**Behavior matrix:**

| Platform | App state | Payload | Behavior |
| --- | --- | --- | --- |
| Android | foreground | with `notifee_options` | `displayNotification(...)` — notification appears |
| Android | background | with `notifee_options` | `displayNotification(...)` — notification appears |
| Android | killed | with `notifee_options` | headless task runs, `displayNotification(...)` — notification appears |
| Android | any | no `notifee_options` and `fallbackBehavior: 'display'` (default) | minimal notification built from `remoteMessage.notification` / `remoteMessage.data.title` / `remoteMessage.data.body` |
| Android | any | no `notifee_options` and `fallbackBehavior: 'ignore'` | returns `null`, no display |
| iOS | foreground | with `notifee_options` | `displayNotification(...)` — in-app banner (skipped if `suppressForegroundBanner`) |
| iOS | background | with `notifee_options` | returns `null` — NSE already displayed |
| iOS | killed | with `notifee_options` | returns `null` — NSE already displayed |

The iOS background/killed no-op is deliberate: the Notification Service Extension has already drawn the final notification using the same `notifee_options` blob, and a second `displayNotification` call would duplicate it.

**Input type:**

```ts
type FcmRemoteMessage = {
  messageId?: string;
  data?: Record<string, string>;
  notification?: { title?: string; body?: string };
};
```

This is a **structural** type — `handleFcmMessage` doesn't import `@react-native-firebase/messaging`, so you can pass a `RemoteMessage` from that library directly, or any compatible shape if you use a different push SDK.

**Thrown errors:**

- `notifee.handleFcmMessage(*) 'remoteMessage' expected an object.` — invalid argument.

**Console warnings** (non-fatal, listed so you can grep logs):

- `[react-native-notify-kit] Failed to parse notifee_options: <detail>. Falling back to raw title/body.`
- `[react-native-notify-kit] notifee_options parsed to a non-object value. Falling back to raw title/body.`
- `[react-native-notify-kit] notifee_options version <N> is newer than supported version 1. Display may be incomplete.`
- `[react-native-notify-kit] android.style.type '<type>' present but required '<field>' field missing or not a string. Style ignored.`
- `[react-native-notify-kit] Unknown android.style.type '<type>'. Style ignored.`
- `[react-native-notify-kit] Unknown ios.interruptionLevel '<level>'. Ignored.`
- `[react-native-notify-kit] ios.attachments entry has missing or empty url. Skipped.`
- `[react-native-notify-kit] Failed to parse notifee_data. Using top-level data keys only.`
- `[react-native-notify-kit] handleFcmMessage: displaying notification with empty title and body. Check your FCM payload.`
- `[react-native-notify-kit] handleFcmMessage: Android fallback path has no channelId (no payload channelId, no defaultChannelId configured). Notification may be dropped by the OS.`

### `notifee.setFcmConfig(config): Promise<void>`

Sets defaults that `handleFcmMessage` consults when the payload leaves a field unset. Call once at app startup, typically in `index.js` before `AppRegistry.registerComponent`. Resolves synchronously; the Promise return is there so a future release can persist config across cold starts without a breaking API change.

**Config type:**

```ts
type FcmConfig = {
  /** Used when notifee_options.android.channelId is absent. */
  defaultChannelId?: string;

  /** Used when notifee_options.android.pressAction is absent. */
  defaultPressAction?: { id: string; launchActivity?: string };

  /**
   * What to do when remoteMessage.data.notifee_options is entirely missing.
   *  - 'display': build a minimal notification from remoteMessage.notification.
   *  - 'ignore':  return null.
   * @default 'display'
   */
  fallbackBehavior?: 'display' | 'ignore';

  ios?: {
    /** When true, foreground notifications from handleFcmMessage are not displayed. */
    suppressForegroundBanner?: boolean;
  };
};
```

**Throws** `notifee.setFcmConfig(*) config must be a plain object. Got: <type>` when called with `null`, an array, or a non-object value.

The nested `ios` sub-object is deep-copied on both `setFcmConfig` and every `handleFcmMessage` entry, so mutating the config you passed in doesn't leak through to subsequent calls.

### Example: full startup wiring

```ts
// index.js
import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from 'react-native-notify-kit';
import App from './App';

async function bootstrap() {
  await notifee.requestPermission();

  await notifee.createChannel({
    id: 'orders',
    name: 'Orders',
    importance: AndroidImportance.HIGH,
  });
  await notifee.createChannel({
    id: 'default',
    name: 'Default',
    importance: AndroidImportance.DEFAULT,
  });

  await notifee.setFcmConfig({
    defaultChannelId: 'default',
    defaultPressAction: { id: 'default', launchActivity: 'default' },
    fallbackBehavior: 'display',
    ios: { suppressForegroundBanner: false },
  });
}

void bootstrap();

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await notifee.handleFcmMessage(remoteMessage);
});

AppRegistry.registerComponent('MyApp', () => App);
```

## iOS NSE setup

iOS requires a Notification Service Extension (NSE) to rewrite incoming APNs notifications before display. FCM Mode ships with a CLI that scaffolds this for you.

### Automated setup (recommended)

```bash
npx react-native-notify-kit init-nse
cd ios && pod install
```

What the CLI does:

1. **Auto-detects** your iOS project (`ios/*.xcodeproj` or `.xcworkspace`) and your main app target's bundle ID.
2. **Creates** three files under `ios/NotifyKitNSE/`:
   - `NotificationService.swift` — calls `NotifeeExtensionHelper.populateNotificationContent(...)` to apply `notifee_options`.
   - `Info.plist` — sets `NSExtensionPointIdentifier = com.apple.usernotifications.service` and the principal class.
   - `NotifyKitNSE.entitlements` — empty file (extend if you need App Groups for cross-target data sharing).
3. **Patches** `ios/Podfile` — adds a `target 'NotifyKitNSE'` block nested inside your app target with `inherit! :search_paths`. The `RNNotifeeCore` pod is added as a dependency of the NSE target only (not the main app) to avoid the duplicate-symbols linker error documented in [9.1.22](../CHANGELOG.md).
4. **Patches** `ios/YourApp.xcodeproj/project.pbxproj` — adds the NSE native target with build phases, inherits signing from the parent target, and sets `PRODUCT_BUNDLE_IDENTIFIER = <parent-bundle-id>.NotifyKitNSE`.
5. **Backs up** the Podfile and `.pbxproj` before every edit (PID-stamped backups, atomic writes, rollback on failure).

Open Xcode after `pod install`, verify the `NotifyKitNSE` target's signing (it should inherit from your app target), build, and you're done.

### CLI reference

```bash
npx react-native-notify-kit init-nse [options]
```

| Option | Default | Description |
| --- | --- | --- |
| `--ios-path <path>` | auto-detect | Path to your iOS directory (e.g. `ios/`). |
| `--target-name <name>` | `NotifyKitNSE` | NSE target name. Must match `/^[A-Za-z0-9_\-.]+$/`. |
| `--bundle-suffix <str>` | `.NotifyKitNSE` | Suffix appended to the parent bundle ID. Must match `/^\.[A-Za-z0-9\-.]+$/` (starts with `.`). |
| `-f, --force` | `false` | Overwrite an existing NSE target. Without this flag, the CLI fails fast if `NotifyKitNSE` already exists. |
| `-n, --dry-run` | `false` | Print the actions that would be taken, without writing. |

**Validation errors** (exact text):

- `Invalid target name '<name>'. Must match [A-Za-z0-9_-.]\n  Target names can only contain letters, digits, underscores, hyphens, and dots.` — reject target names with special chars.
- `Invalid bundle suffix '<suffix>'. Must start with '.' and contain only letters, digits, hyphens, and dots.`
- `NSE target '<name>' already exists in <where>.\n  Use --force to overwrite or --target-name to use a different name.`

**Parent bundle ID with variables.** If your main app target sets `PRODUCT_BUNDLE_IDENTIFIER` via an Xcode build variable (e.g. `$(PRODUCT_BUNDLE_PREFIX).$(PRODUCT_NAME)`), the CLI logs a warning and writes the literal variable into the NSE bundle ID — you'll need to set the NSE's bundle ID manually in Xcode. This shows up as:

```text
Parent bundle ID uses a variable: $(PRODUCT_BUNDLE_PREFIX).MyApp
  The NSE bundle ID will need to be set manually in Xcode.
```

### Manual setup

If the CLI doesn't work for your project (Expo managed workflow, heavily customized Xcode configs, exotic monorepo layouts), the [legacy manual guide](../apps/smoke/NOTIFICATION_SERVICE_EXTENSION.md) walks through the Xcode steps. You'll still use the same `NotifeeExtensionHelper.populateNotificationContent(...)` call — only the scaffolding differs.

### What the Swift template does

The generated `NotificationService.swift` is under your ownership after generation — regenerating with `--force` will overwrite it, so if you customize it, keep the `populateNotificationContent` call intact. The template:

1. Implements `didReceive(_:withContentHandler:)`.
2. Hands the request to `NotifeeExtensionHelper.populateNotificationContent(...)` — the ObjC helper shipped in `RNNotifeeCore` that reads `notifee_options` and applies attachments, category, thread-id, and sound.
3. Logs `[NotifyKitNSE] didReceive ...` and `[NotifyKitNSE] contentHandler ...` via `NSLog`, viewable in Console.app with filter `subsystem:NotifyKitNSE` when attaching to your NSE target.
4. Implements `serviceExtensionTimeWillExpire` as a safety net — iOS gives the NSE ~30 seconds before killing it; if an attachment download stalls, the NSE delivers whatever it has so far instead of dropping the notification entirely.

### No bridging header needed

The NSE is pure Swift. `RNNotifeeCore` exposes `NotifeeExtensionHelper` as an Objective-C class with `NS_SWIFT_NAME` hints, so Swift imports it directly (`import RNNotifeeCore`). No `NotifyKitNSE-Bridging-Header.h` is required.

### Deployment target

The NSE target defaults to **iOS 15.1**, matching the main library deployment target. If your main app targets a higher version, update the NSE target in Xcode → Build Settings → Deployment → **iOS Deployment Target**.

### Debugging the NSE

Attach to the running NSE process from Xcode:

1. Run the main app on device.
2. In Xcode: **Debug → Attach to Process → `NotifyKitNSE`** (appears after the first push arrives and spawns the extension).
3. Send a push. Set breakpoints in `NotificationService.swift` or log with `NSLog`.

You can also read NSE logs in **Console.app** — filter by process `NotifyKitNSE`. The template emits two log lines per normal invocation (entry + completion), plus a third on the timeout path:

```text
[NotifyKitNSE] didReceive id=... title=... hasNotifeeOptions=true requestedAttachments=1 urls=https://...
[NotifyKitNSE] contentHandler id=... title=... deliveredAttachments=1 identifiers=notifee-attachment-0
[NotifyKitNSE] serviceExtensionTimeWillExpire id=... title=... deliveredAttachments=0
```

If `hasNotifeeOptions=false`, the server didn't send a NotifyKit-shaped payload — either you're not using `buildNotifyKitPayload`, or the payload was stripped by a proxy.

## Android specifics

### Data-only delivery

The server SDK always emits an Android data-only message — there's no `notification` field in the FCM payload. That's what makes `setBackgroundMessageHandler` / `onMessage` fire instead of the FCM SDK auto-displaying.

### Channels are your responsibility

`handleFcmMessage` honors whatever `channelId` the server sends, falling back to `defaultChannelId` from `setFcmConfig`. The channel **must exist before the notification is displayed** — create channels at app startup:

```ts
await notifee.createChannel({
  id: 'orders',
  name: 'Orders',
  importance: AndroidImportance.HIGH,
  sound: 'default',
  // If you want a custom sound:
  // sound: 'my_custom_sound', // file at android/app/src/main/res/raw/my_custom_sound.mp3
});
```

> **Android:** The `NotificationChannel` sound is immutable after creation. To change the sound you must delete and recreate the channel under a new ID. See the [custom sounds note](../README.md#custom-sounds-for-push-notifications-in-background-or-killed-state) in the main README.

### Style mapping

Server-side style enums are strings (`'BIG_TEXT'`, `'BIG_PICTURE'`) to survive JSON serialization. On the client, `handleFcmMessage` maps them to `AndroidStyle.BIGTEXT` / `AndroidStyle.BIGPICTURE`:

```ts
// Server
android: {
  channelId: 'news',
  style: { type: 'BIG_PICTURE', picture: 'https://cdn.example.com/banner.png' },
}

// Client receives (and calls displayNotification with):
android: {
  channelId: 'news',
  style: { type: AndroidStyle.BIGPICTURE, picture: 'https://cdn.example.com/banner.png' },
}
```

Other `AndroidStyle` values (`MESSAGING`, `INBOX`, `CALL`) aren't wired through the server SDK yet — they have richer schemas that need future versioning. Build them yourself via `displayNotification` until then.

### Action buttons

```ts
android: {
  actions: [
    { title: 'Accept',  pressAction: { id: 'accept-order' } },
    { title: 'Decline', pressAction: { id: 'decline-order' } },
    { title: 'Reply',   pressAction: { id: 'reply' }, input: true },
  ],
}
```

Handle the action `id` in your `onBackgroundEvent` / `onForegroundEvent` listener:

```ts
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'accept-order') {
    // ...
  }
});
```

### Foreground delivery

When the app is in foreground, Android shows a normal notification in the tray (the library doesn't have the iOS "in-app banner" concept). To suppress foreground display, check `AppState` yourself and branch:

```ts
messaging().onMessage(async (remoteMessage) => {
  if (AppState.currentState === 'active') {
    // Route to an in-app toast instead of a tray notification
    showInAppToast(remoteMessage.notification);
    return;
  }
  await notifee.handleFcmMessage(remoteMessage);
});
```

## Payload reference

### Full `notifee_options` schema

```jsonc
{
  "_v": 1,
  "title": "Order received",
  "body": "We're preparing your food.",

  "android": {
    "channelId": "orders",
    "smallIcon": "ic_notification",
    "largeIcon": "https://cdn.example.com/avatar.png",
    "color": "#4CAF50",
    "pressAction": { "id": "open-order", "launchActivity": "default" },
    "actions": [
      { "title": "Accept",  "pressAction": { "id": "accept" } },
      { "title": "Decline", "pressAction": { "id": "decline" }, "input": true }
    ],
    "style": { "type": "BIG_TEXT", "text": "Long body text ..." }
  },

  "ios": {
    "sound": "default",
    "categoryId": "ORDER_UPDATE",
    "threadId": "orders-thread",
    "interruptionLevel": "timeSensitive",
    "attachments": [
      { "url": "https://cdn.example.com/orders/42.png", "identifier": "attachment-0" }
    ]
  }
}
```

### `_v` version field

Every blob carries `_v: 1`. When a future client encounters `_v > 1`, it parses what it understands and logs:

```text
[react-native-notify-kit] notifee_options version 2 is newer than supported version 1. Display may be incomplete.
```

Bump client `react-native-notify-kit` to pick up new fields — old clients never crash, they just miss the new fields.

### Reserved top-level FCM data keys

The FCM SDK strips these keys before your `setBackgroundMessageHandler` / `onMessage` handler sees them:

- **Prefixes:** `android.`, `google.`, `gcm.`, `fcm.`
- **`notifee`** prefix (without trailing dot — the library's namespace, so `notifeeFoo` is also filtered)
- **Exact:** `from`, `collapse_key`, `message_type`, `message_id`, `aps`, `fcm_options`

The server SDK additionally rejects `notifee_options` and `notifee_data` in your `notification.data` to prevent collisions with the transport blob. See the [main README](../README.md#bugs-fixed-from-upstream-notifee) for the iOS / Android divergence on bare-`fcm` keys.

### 4 KB FCM limit

FCM enforces a hard 4 KB limit on the entire serialized message. The server SDK warns at ~3500 bytes; common causes of going over:

- Long `body` text — use an Android `BIG_TEXT` style instead, which doesn't contribute to the size cap if the full text is inline but the banner text is short.
- Many `data` keys — collapse nested objects into a single JSON string (`JSON.stringify`) and parse on the client. The reserved keys `notifee_options` / `notifee_data` are off-limits.
- Long attachment URLs — shorten via a CDN or URL shortener.

If you're close to 4 KB, send a **nudge** payload instead: push just an ID, and have the client fetch the full content from your API when it handles the push.

## Migration from the manual pattern

If you currently do this:

```ts
// OLD — manual pattern with data-only on both platforms
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await notifee.displayNotification({
    title: remoteMessage.data.title,
    body: remoteMessage.data.body,
    android: { channelId: remoteMessage.data.channelId || 'default' },
  });
});
```

…you're running into iOS silent-push throttling (30–60% loss) and hand-rolling the payload shape. The FCM Mode migration is:

### Step 1 — Server

Replace your custom payload builder with `buildNotifyKitPayload`. If you were already sending data-only on iOS, the iOS half changes (you'll now emit an alert payload). Old payload:

```ts
// OLD — manual
await admin.messaging().send({
  token,
  data: { title: '...', body: '...', channelId: 'orders' },
  apns: { payload: { aps: { 'content-available': 1 } } }, // silent push
});
```

New payload:

```ts
// NEW — FCM Mode
await admin.messaging().send(
  buildNotifyKitPayload({
    token,
    notification: { title: '...', body: '...', android: { channelId: 'orders' } },
  }),
);
```

### Step 2 — Client

Swap `displayNotification` for `handleFcmMessage`:

```ts
// OLD
messaging().setBackgroundMessageHandler(async (m) => {
  await notifee.displayNotification({ title: m.data.title, body: m.data.body, ... });
});

// NEW
messaging().setBackgroundMessageHandler(async (m) => {
  await notifee.handleFcmMessage(m);
});
```

And configure defaults once at startup:

```ts
notifee.setFcmConfig({ defaultChannelId: 'default' });
```

### Step 3 — iOS

Run the CLI: `npx react-native-notify-kit init-nse && cd ios && pod install`. If you already had a Notify Kit Service Extension (e.g. from the legacy ObjC guide), you can either keep it and skip this step, or regenerate with `--force` to get the new Swift template.

### Compatibility during migration

Old clients on old payloads keep working: the manual `displayNotification` path is unchanged. FCM Mode uses a **new data key** (`notifee_options`) that old clients don't read, so there's no on-the-wire breakage. You can roll out the server change first, then the client — old clients will continue to use `remoteMessage.data.title / .body` (FCM Mode's fallback path).

## Troubleshooting

### iOS notification not appearing in background

- **Check the Notification Service Extension is installed.** In Xcode, look for the `NotifyKitNSE` target. If missing, run `npx react-native-notify-kit init-nse`.
- **Check NSE signing.** Targets → `NotifyKitNSE` → Signing & Capabilities. Team must match the main app; provisioning profile must cover `<your-bundle-id>.NotifyKitNSE`.
- **Check `aps-push-type: alert` and `mutable-content: 1` are present.** Both are emitted automatically by `buildNotifyKitPayload`; if they're missing, a middleware / proxy is stripping them.
- **Attach to the NSE process in Xcode** (Debug → Attach to Process → `NotifyKitNSE`) and confirm `didReceive` fires. If nothing fires, APNs isn't routing to your NSE.

### Android duplicate notifications

If you see two notifications per push on Android, the FCM SDK is auto-displaying the alert AND your `handleFcmMessage` is displaying a second one. Causes:

- You're sending the push **without** `buildNotifyKitPayload` — something in your pipeline is setting a `notification` field on the Android message. FCM Mode always uses `data`-only on Android; check your payload via `gcloud logging read 'resource.type="logging_sink"'` or Firebase Console.
- You have an older client (< 10.0.0) handling the message alongside a newer client. Bump all clients.

### NSE not activating

- Run the app on a **real iOS device** (NSEs don't run on the simulator for remote pushes — local notifications only).
- Check `aps-push-type` is `alert` and `mutable-content` is `1`. The server SDK always sets both.
- Attach to the NSE process in Xcode and send a test push via `node scripts/send-test-fcm.ts` (requires `GOOGLE_APPLICATION_CREDENTIALS` + device token). If `didReceive` never fires, the NSE isn't linked — verify Xcode → General → Frameworks, Libraries, and Embedded Content lists `RNNotifeeCore.framework` (or the CocoaPods static-library equivalent).

### Custom sound not playing

Custom sounds have platform-specific requirements that don't go through the Notify Kit JS API when FCM delivers the push.

- **iOS:** the sound file must be bundled in the **NSE target's** resources, not (only) the main app. Drag the file into the `NotifyKitNSE/` folder in Xcode and verify it appears in the NSE target's Build Phases → Copy Bundle Resources.
- **Android:** the `NotificationChannel` sound is locked at channel creation. `notifee_options.android.sound` from FCM Mode overrides the channel sound only if the channel was created with that sound already. To change the sound, create a new channel under a new ID.

See the main README's [custom sounds section](../README.md#custom-sounds-for-push-notifications-in-background-or-killed-state) for the full background.

### `pod install` fails after `init-nse`

If `pod install` errors with "Unable to find a specification for `RNNotifeeCore`" or similar:

- Verify `node_modules/react-native-notify-kit/` exists and includes a `RNNotifeeCore.podspec`.
- Run `pod install --repo-update` from `ios/`.
- If you use `use_frameworks! :linkage => :static`, the 9.1.22 duplicate-symbol fix is in effect — no extra config needed.
- If it still fails, inspect the generated Podfile diff — the NSE block should be nested inside the main app target with `inherit! :search_paths`. If it's at the top level, your Podfile has a shape the patcher didn't recognize — run `npx react-native-notify-kit init-nse --force` on a clean Podfile, or patch manually using the [legacy guide](../apps/smoke/NOTIFICATION_SERVICE_EXTENSION.md).

### `handleFcmMessage` returns `null`

By design, when:

- iOS + app in background or killed (NSE owns display).
- `fallbackBehavior: 'ignore'` and the payload has no `notifee_options`.
- `ios.suppressForegroundBanner: true` and the app is in iOS foreground.
- The `remoteMessage` wasn't produced by NotifyKit and you opted out of the fallback.

If you're seeing `null` unexpectedly, check `remoteMessage.data.notifee_options` — it should be a JSON string. If it's missing, your server isn't using `buildNotifyKitPayload`.

### Notification appears but tap doesn't open app

On Android, set a `pressAction`:

```ts
android: { pressAction: { id: 'default', launchActivity: 'default' } }
```

Or call `notifee.setFcmConfig({ defaultPressAction: { id: 'default', launchActivity: 'default' } })` at startup.

Since [9.3.0](../CHANGELOG.md#930---2026-04-09) the library injects this default at the native layer for `displayNotification`, so `handleFcmMessage` tap behavior works without explicit config — but set it if you want the tap to route to a non-default activity. See the main README section on [Android `pressAction`](../README.md#android-pressaction-defaults-to-opening-the-app-on-tap).

### Payload too large

The server SDK warns at ~3500 bytes. Common fixes:

- Shorten `body` or move long text to Android `BIG_TEXT` style.
- Collapse nested `data` values into a single JSON string.
- Switch to a nudge-then-fetch pattern (push an ID, fetch the payload on open).

## Known limitations

- **iOS background `DELIVERED` event gap.** When a push arrives while your app is in background/killed on iOS, `EventType.DELIVERED` is **not** emitted to `onBackgroundEvent` — the NSE draws the notification and the main app process never wakes. This is a platform limitation (no `UNUserNotificationCenterDelegate` callback fires for NSE-drawn notifications until the user taps). Android emits `DELIVERED` unconditionally. To detect background delivery on iOS, check `getDisplayedNotifications()` when the app returns to foreground, or have the NSE write to a shared App Group container.
- **No deep validation of nested `android` / `ios` config.** The server SDK validates the top-level shape (routing, data value types, iOS attachment URLs, ttl, etc.) but trusts TypeScript structural typing for the nested `NotifyKitAndroidConfig` / `NotifyKitIosConfig`. JavaScript callers that bypass TypeScript should validate themselves. Deep runtime validation is planned.
- **Style types limited to `BIG_TEXT` / `BIG_PICTURE`.** `MESSAGING`, `INBOX`, and `CALL` styles are available via `displayNotification` but aren't wired through the server SDK yet — their schemas need versioning (person avatars, reply actions) before the wire contract is frozen.
- **Expo managed workflow not supported.** The CLI writes directly to `ios/` and assumes a bare React Native project. An Expo config plugin (`expo-notify-kit-config`) is on the roadmap. In the meantime, prebuild (`npx expo prebuild`) and run the CLI against the generated `ios/` directory.
- **The CLI creates the NSE target once.** Re-running `init-nse` without `--force` is a no-op. Re-running with `--force` will overwrite `NotificationService.swift` — back it up first if you've customized the file.

## Comparison with other libraries

| Feature | NotifyKit FCM Mode | Manual `@notifee` + RNFB | OneSignal | `expo-notifications` |
| --- | --- | --- | --- | --- |
| Android display | `displayNotification` from headless task | Same | OneSignal SDK | `expo-notifications` |
| iOS background reliability | APNs alert (~99%) via NSE | Data-only silent (~40-70%) | APNs alert (proprietary) | APNs alert (Expo-managed) |
| iOS NSE setup | One CLI command | Manual Xcode steps | Bundled, closed-source | Managed (no NSE needed) |
| Backend SDK | `react-native-notify-kit/server` (zero deps) | Hand-rolled FCM v1 | OneSignal REST API | Expo push REST API |
| Backend runs on | Any Node.js (CFns, Lambda, self-hosted) | Any Node.js | OneSignal (vendor lock) | Expo servers (vendor lock-ish) |
| Notification styling | BIG_TEXT, BIG_PICTURE, actions, attachments, categories, thread-id | Full Notify Kit surface | OneSignal-specific | Limited (no custom styles on Android) |
| Rich iOS notifications | Yes, via NSE blob | Yes, via NSE blob | Yes | Limited |
| Foreground services | Via `displayNotification` | Same | Not supported | Not supported |
| Trigger notifications (scheduled) | Full Notify Kit (AlarmManager) | Same | OneSignal scheduling | Basic (local) |
| Source availability | Apache-2.0, open source | Same | Closed source | Apache-2.0, vendor-tied |
| Data-only pushes | Supported (fall through to `displayNotification`) | Supported | Supported | Limited |
| Works without FCM | No (FCM is the transport) | No | Proprietary transport | Expo transport |
| Monthly active device limit | FCM free (unlimited) | FCM free | Free tier cap, paid beyond | Free |

---

See the [main README](../README.md) for Notify Kit's full feature surface, the [server SDK README](../packages/react-native/server/README.md) for a compact server reference, and the [CHANGELOG](../CHANGELOG.md) for release history.
