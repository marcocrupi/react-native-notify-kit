# react-native-notify-kit/server

Server-side FCM HTTP v1 payload builder for [`react-native-notify-kit`](../README.md). Runs in Node.js (backends, Firebase Cloud Functions). Zero runtime dependencies.

Use it to construct payloads that the client-side `react-native-notify-kit` handler can consume — Android receives data-only messages routed through `setBackgroundMessageHandler`, and iOS receives alert-style APNs payloads that a Notification Service Extension reads from the `notifee_options` key.

## Install

Already bundled with `react-native-notify-kit`. Import from the `/server` subpath:

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

## Behavior

- Android messages are delivered **data-only** — the FCM SDK never auto-displays them. The client handler owns rendering.
- iOS messages use APNs alert delivery with `mutable-content: 1`, so the Notification Service Extension always activates and reads `notifee_options`.
- All payloads carry a `_v: 1` version field in `notifee_options` for forward compatibility.
- If the serialized payload approaches FCM's 4 KB limit, a `console.warn` is emitted (non-fatal).

See the top-level [CHANGELOG](../../../CHANGELOG.md) and [README](../README.md) for full context.
