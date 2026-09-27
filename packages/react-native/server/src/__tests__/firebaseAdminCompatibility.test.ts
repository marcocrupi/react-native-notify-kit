import { createRequire } from 'node:module';
import path from 'node:path';
import type { Message } from 'firebase-admin/messaging';
import { buildNotifyKitPayload } from '../buildPayload';
import type { NotifyKitPayloadInput } from '../types';

const requireFromTest = createRequire(__filename);
const firebaseMessagingDir = path.dirname(requireFromTest.resolve('firebase-admin/messaging'));

const {
  validateMessage,
}: typeof import('../../../../../node_modules/firebase-admin/lib/messaging/messaging-internal.js') =
  requireFromTest(path.join(firebaseMessagingDir, 'messaging-internal.js'));
const {
  deepCopy,
}: typeof import('../../../../../node_modules/firebase-admin/lib/utils/deep-copy.js') =
  requireFromTest(path.join(firebaseMessagingDir, '../utils/deep-copy.js'));

const minimalNotification = { title: 'Title', body: 'Body' };

const compatibilityCases: Array<{ name: string; input: NotifyKitPayloadInput }> = [
  {
    name: 'A. ttl 30000',
    input: {
      token: 'token-a',
      notification: minimalNotification,
      options: { ttl: 30000 },
    },
  },
  {
    name: 'B. ttl omitted',
    input: {
      token: 'token-b',
      notification: minimalNotification,
    },
  },
  {
    name: 'C. input priority: high',
    input: {
      token: 'token-c',
      notification: minimalNotification,
      options: { androidPriority: 'high' },
    },
  },
  {
    name: 'D. input priority: normal',
    input: {
      token: 'token-d',
      notification: minimalNotification,
      options: { androidPriority: 'normal' },
    },
  },
  {
    name: 'E. collapse key',
    input: {
      token: 'token-e',
      notification: minimalNotification,
      options: { collapseKey: 'batch-e' },
    },
  },
  {
    name: 'F. token routing',
    input: {
      token: 'token-f',
      notification: minimalNotification,
    },
  },
  {
    name: 'G. topic routing',
    input: {
      topic: 'topic-g',
      notification: minimalNotification,
    },
  },
  {
    name: 'H. condition routing',
    input: {
      condition: "'topic-h' in topics",
      notification: minimalNotification,
    },
  },
  {
    name: 'I. Batch 2A BIG_TEXT options',
    input: {
      token: 'token-i',
      notification: {
        title: 'Main title',
        body: 'Main body',
        subtitle: 'Second line',
        android: {
          largeIcon: 'https://cdn.example.com/large.png',
          circularLargeIcon: false,
          style: {
            type: 'BIG_TEXT',
            text: 'Expanded text',
            title: 'Expanded title',
            summary: 'Expanded summary',
          },
        },
      },
    },
  },
];

describe('Firebase Admin local compatibility', () => {
  it.each(compatibilityCases)('$name passes deepCopy + validateMessage', ({ input }) => {
    const message: Message = buildNotifyKitPayload(input);
    const copy = deepCopy(message);

    expect(() => validateMessage(copy)).not.toThrow();
  });

  it('preserves FCM/APNs semantics after local Firebase Admin normalization', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    try {
      const payload = buildNotifyKitPayload({
        token: 'wire-token',
        notification: {
          id: 'notification-id',
          title: 'Wire title',
          body: 'Wire body',
          data: { orderId: '42', source: 'compatibility-test' },
        },
        options: {
          ttl: 30000,
          androidPriority: 'high',
          collapseKey: 'collapse-X',
        },
      });
      const message: Message = payload;

      expect(payload.android).toEqual({
        priority: 'high',
        collapseKey: 'collapse-X',
        ttl: 30_000_000,
      });
      expect(payload.apns.headers['apns-expiration']).toBe('1700030000');

      const firebaseAdminMessage = deepCopy(message);
      expect('sizeBytes' in firebaseAdminMessage).toBe(false);
      validateMessage(firebaseAdminMessage);

      expect(firebaseAdminMessage.android).toEqual({
        priority: 'high',
        collapse_key: 'collapse-X',
        ttl: '30000s',
      });
      // The test derives the uppercase FCM priority equivalent locally; Firebase Admin does not.
      expect(firebaseAdminMessage.android?.priority?.toUpperCase()).toBe('HIGH');
      expect(firebaseAdminMessage.apns?.headers?.['apns-expiration']).toBe('1700030000');
      expect(firebaseAdminMessage.data).toEqual(payload.data);
      expect(firebaseAdminMessage.apns?.payload?.notifee_options).toBe(
        payload.apns.payload.notifee_options,
      );
      expect(firebaseAdminMessage.apns?.payload?.notifee_data).toBe(
        payload.apns.payload.notifee_data,
      );
      expect(JSON.stringify({ message: firebaseAdminMessage })).not.toContain('sizeBytes');
    } finally {
      now.mockRestore();
    }
  });

  it('preserves Batch 2A options through Firebase Admin deepCopy and validation', () => {
    const input: NotifyKitPayloadInput = {
      token: 'batch-2a-token',
      notification: {
        title: 'Main title',
        body: 'Main body',
        subtitle: 'Secondary title',
        android: {
          channelId: 'orders',
          largeIcon: 'https://cdn.example.com/large.png',
          circularLargeIcon: false,
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            title: 'Expanded title',
            summary: 'Expanded summary',
            largeIcon: null,
          },
        },
      },
    };
    const payload = buildNotifyKitPayload(input);
    const message: Message = payload;
    const firebaseAdminMessage = deepCopy(message);

    expect(() => validateMessage(firebaseAdminMessage)).not.toThrow();
    expect(firebaseAdminMessage.android).toEqual({ priority: 'high' });
    expect(firebaseAdminMessage.apns?.payload?.aps).toMatchObject({
      alert: { title: 'Main title', body: 'Main body', subtitle: 'Secondary title' },
      'mutable-content': 1,
    });
    expect(firebaseAdminMessage.data?.notifee_options).toBe(
      firebaseAdminMessage.apns?.payload?.notifee_options,
    );
    expect(JSON.parse(firebaseAdminMessage.data?.notifee_options as string)).toEqual({
      _v: 1,
      title: 'Main title',
      body: 'Main body',
      subtitle: 'Secondary title',
      android: {
        channelId: 'orders',
        largeIcon: 'https://cdn.example.com/large.png',
        circularLargeIcon: false,
        style: {
          type: 'BIG_PICTURE',
          picture: 'https://cdn.example.com/picture.png',
          title: 'Expanded title',
          summary: 'Expanded summary',
          largeIcon: null,
        },
      },
    });
    expect(payload.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'));
    expect('sizeBytes' in firebaseAdminMessage).toBe(false);
  });

  it('preserves Batch 2B Android interactions through Firebase Admin normalization', () => {
    const notification = {
      title: 'Order',
      body: 'Ready',
      android: {
        channelId: 'orders',
        pressAction: null,
        actions: [
          {
            title: 'Reply',
            pressAction: {
              id: 'reply',
              launchActivity: 'com.example.OrdersActivity',
              mainComponent: 'Orders',
              launchActivityFlags: [2, 4],
            },
            icon: 'https://cdn.example.com/reply.png',
            input: {
              allowFreeFormInput: true,
              allowGeneratedReplies: false,
              choices: ['Now', 'Later'],
              editableChoices: false,
              placeholder: '',
            },
          },
          { title: 'Done', pressAction: { id: 'done' } },
        ],
      },
    };
    const payload = buildNotifyKitPayload({
      token: 'batch-2b-token',
      notification: notification as NotifyKitPayloadInput['notification'],
    });
    const message: Message = deepCopy(payload);

    expect(() => validateMessage(message)).not.toThrow();
    expect(message.android).toEqual({ priority: 'high' });
    expect(message.data?.notifee_options).toBe(message.apns?.payload?.notifee_options);
    expect(JSON.parse(message.data?.notifee_options as string)).toEqual({
      _v: 1,
      title: 'Order',
      body: 'Ready',
      android: notification.android,
    });
    expect(payload.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'));
    expect('sizeBytes' in message).toBe(false);
  });
});
