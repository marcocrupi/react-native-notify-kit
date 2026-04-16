# react-native-notify-kit/server

Server-side FCM HTTP v1 payload builder for [`react-native-notify-kit`](../README.md). Runs in Node.js 22+ (backends, Firebase Cloud Functions). **Zero runtime dependencies.**

Use it to construct payloads that the client-side `handleFcmMessage` handler can consume — Android receives data-only messages routed through `setBackgroundMessageHandler`, iOS receives alert-style APNs payloads that a Notification Service Extension reads from the `notifee_options` key.

For the full end-to-end guide (client setup, iOS NSE scaffolding, migration, troubleshooting), see [`docs/fcm-mode.md`](../../../docs/fcm-mode.md).

## Install

Bundled with `react-native-notify-kit` — import from the `/server` subpath:

```ts
import { buildNotifyKitPayload } from 'react-native-notify-kit/server';
import * as admin from 'firebase-admin';

const message = buildNotifyKitPayload({
  token: '<device FCM token>',
  notification: {
    id: 'order-42',
    title: 'Your order is on the way',
    body: 'Tap to see live tracking',
    data: { orderId: '42' },
    android: {
      channelId: 'orders',
      smallIcon: 'ic_notification',
      pressAction: { id: 'open-order' },
    },
    ios: {
      sound: 'default',
      interruptionLevel: 'timeSensitive',
      attachments: [{ url: 'https://cdn.example.com/map.png' }],
    },
  },
  options: {
    androidPriority: 'high',
    iosBadgeCount: 3,
    ttl: 3600,
  },
});

await admin.messaging().send(message);
```

## API

### `buildNotifyKitPayload(input: NotifyKitPayloadInput): NotifyKitPayloadOutput`

Main entry point. Validates the input, serializes the `notifee_options` blob, and returns a complete FCM HTTP v1 `Message` object with an `android` half (data-only) and an `apns` half (alert + `mutable-content: 1`). Routing field (`token` / `topic` / `condition`) is passed through from the input; exactly one must be provided.

The returned object also carries a **non-enumerable** `sizeBytes` field — accessible for your own diagnostics, invisible to `JSON.stringify` so it never leaks to FCM.

### `buildAndroidPayload(input, context): NotifyKitAndroidOutput`

Builds the Android half only: `{ priority, collapse_key?, ttl? }`. Use when composing a custom `Message` (rare).

### `buildIosApnsPayload(input, context): NotifyKitApnsOutput`

Builds the iOS APNs half only: `{ headers, payload }` with the `aps` object, `notifee_options` blob, and optional `notifee_data`. Use when composing a custom `Message`.

### `serializeNotifeeOptions(input): string`

Returns the JSON-serialized `notifee_options` blob: `{ _v: 1, title, body, android?, ios? }`. Use when you want the blob string directly (e.g., to send via a non-FCM transport while preserving the wire contract).

### Types

All types are re-exported from the server SDK:

```ts
import type {
  // Input
  NotifyKitPayloadInput,
  NotifyKitNotification,
  NotifyKitOptions,
  NotifyKitAndroidConfig,
  NotifyKitIosConfig,
  NotifyKitPressAction,
  NotifyKitAndroidAction,
  NotifyKitAndroidStyle,
  NotifyKitIosAttachment,
  NotifyKitIosInterruptionLevel,

  // Output
  NotifyKitPayloadOutput,
  NotifyKitAndroidOutput,
  NotifyKitApnsOutput,
  NotifyKitApnsAps,
  NotifyKitApnsHeaders,
  NotifyKitApnsPayload,
  ApnsInterruptionLevel,

  // Blob
  SerializedNotifeeOptions,
} from 'react-native-notify-kit/server';
```

Full type definitions are in [`docs/fcm-mode.md#server-sdk-reference`](../../../docs/fcm-mode.md#server-sdk-reference).

## Behavior

- **Android** messages are delivered **data-only** — the FCM SDK never auto-displays them. The client handler owns rendering.
- **iOS** messages use APNs alert delivery with `mutable-content: 1`, so the Notification Service Extension always activates and reads `notifee_options`.
- All payloads carry a `_v: 1` version field in `notifee_options` for forward compatibility.
- Collapse key precedence: `options.collapseKey` > `notification.id` > omitted (no collapse).
- If the serialized payload approaches FCM's 4 KB limit, a `console.warn` is emitted (non-fatal). The exact byte count is also available via `output.sizeBytes` — non-enumerable, so it doesn't serialize into the FCM wire payload.

## Validation

All validation happens synchronously in `buildNotifyKitPayload`. Errors thrown as `Error` objects with the `[react-native-notify-kit/server]` prefix. The complete list of error messages lives in [`docs/fcm-mode.md#validation-rules`](../../../docs/fcm-mode.md#validation-rules); highlights:

- Exactly one of `token`, `topic`, `condition` required.
- `notification.title` and `notification.body` are required non-empty strings.
- `notification.data` values must be strings (use `JSON.stringify` for complex values).
- `notifee_options` and `notifee_data` are reserved and rejected in user `data`.
- `options.ttl` must be a **positive** integer in seconds (zero is rejected — omit to use FCM default).
- iOS attachments require `https://` URLs.
- `options.iosBadgeCount` must be a non-negative integer.

## Limitations

- **No deep runtime validation of `notification.android` / `notification.ios` sub-objects.** Nested fields (`channelId`, `smallIcon`, `color`, `pressAction`, `actions`, `style`, `sound`, `categoryId`, etc.) are structurally validated by TypeScript at compile time but not checked at runtime. JavaScript consumers bypassing TypeScript should validate inputs themselves. Deep runtime validation is planned.
- **Style types are limited to `BIG_TEXT` and `BIG_PICTURE`.** `MESSAGING`, `INBOX`, and `CALL` styles are available via the client `displayNotification` but not yet wired through the server SDK — their richer schemas (person avatars, reply actions) need forward-compatible versioning before the wire contract is frozen.
- **FCM 4 KB hard limit.** The serialized message is capped at 4 KB by FCM. The SDK warns at ~3500 bytes — reduce `data` keys or body length, or switch to a nudge-then-fetch pattern for large payloads.

## See also

- [Full FCM Mode guide](../../../docs/fcm-mode.md) — architecture, NSE setup, migration, troubleshooting.
- [Main README](../README.md) — Notifee's full client API surface.
- [CHANGELOG](../../../CHANGELOG.md) — release history.
