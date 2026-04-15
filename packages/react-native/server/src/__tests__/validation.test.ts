import type { NotifyKitPayloadInput } from '../types';
import { validateInput } from '../validation';

function base(overrides: Partial<NotifyKitPayloadInput> = {}): NotifyKitPayloadInput {
  return {
    token: 'abc',
    notification: { title: 'Hello', body: 'World' },
    ...overrides,
  };
}

describe('validateInput — routing (Rule 5)', () => {
  it('accepts a valid token-routed input', () => {
    expect(() => validateInput(base())).not.toThrow();
  });

  it('accepts topic-routed input', () => {
    expect(() =>
      validateInput({
        topic: 'news',
        notification: { title: 'a', body: 'b' },
      }),
    ).not.toThrow();
  });

  it('accepts condition-routed input', () => {
    expect(() =>
      validateInput({
        condition: "'news' in topics",
        notification: { title: 'a', body: 'b' },
      }),
    ).not.toThrow();
  });

  it('throws when zero routing fields are set', () => {
    expect(() =>
      validateInput({ notification: { title: 'a', body: 'b' } } as NotifyKitPayloadInput),
    ).toThrow(
      "[react-native-notify-kit/server] Routing: exactly one of 'token', 'topic', or 'condition' must be provided. Got: 0",
    );
  });

  it('throws when two routing fields are set', () => {
    expect(() =>
      validateInput({
        token: 'a',
        topic: 'b',
        notification: { title: 'a', body: 'b' },
      }),
    ).toThrow(
      "[react-native-notify-kit/server] Routing: exactly one of 'token', 'topic', or 'condition' must be provided. Got: 2",
    );
  });

  it('throws when all three routing fields are set', () => {
    expect(() =>
      validateInput({
        token: 'a',
        topic: 'b',
        condition: 'c',
        notification: { title: 'a', body: 'b' },
      }),
    ).toThrow(/Got: 3/);
  });
});

describe('validateInput — notification.id (reserved key & id checks)', () => {
  it('accepts a missing id', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
      }),
    ).not.toThrow();
  });

  it('accepts a non-empty string id', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { id: 'order-42', title: 'a', body: 'b' },
      }),
    ).not.toThrow();
  });

  it('throws on empty-string id', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { id: '', title: 'a', body: 'b' },
      }),
    ).toThrow(
      '[react-native-notify-kit/server] Validation: notification.id must be a non-empty string when provided',
    );
  });

  it('throws on non-string id', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          id: 42 as unknown as string,
          title: 'a',
          body: 'b',
        },
      }),
    ).toThrow(/notification\.id must be a non-empty string when provided/);
  });
});

describe('validateInput — reserved data keys', () => {
  it('throws when notification.data contains notifee_options', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          title: 'a',
          body: 'b',
          data: { notifee_options: 'oops' },
        },
      }),
    ).toThrow(
      "[react-native-notify-kit/server] Validation: 'notifee_options' and 'notifee_data' are reserved keys and cannot be used in notification.data",
    );
  });

  it('throws when notification.data contains notifee_data', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          title: 'a',
          body: 'b',
          data: { notifee_data: 'oops' },
        },
      }),
    ).toThrow(/reserved keys and cannot be used in notification\.data/);
  });

  it('throws on the reserved-key check before running the string-value check', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          title: 'a',
          body: 'b',
          data: { notifee_options: 123 as unknown as string },
        },
      }),
    ).toThrow(/reserved keys/);
  });

  it('accepts data with similar but non-matching keys', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          title: 'a',
          body: 'b',
          data: { notifee_extra: 'ok', options: 'ok', notifee: 'ok' },
        },
      }),
    ).not.toThrow();
  });
});

describe('validateInput — notification presence', () => {
  it('throws when title is missing', () => {
    expect(() =>
      validateInput({
        token: 'a',
        notification: { body: 'b' } as NotifyKitPayloadInput['notification'],
      }),
    ).toThrow(
      '[react-native-notify-kit/server] Validation: notification.title is required and must be a non-empty string',
    );
  });

  it('throws when title is an empty string', () => {
    expect(() =>
      validateInput({
        token: 'a',
        notification: { title: '', body: 'b' },
      }),
    ).toThrow(/notification.title is required/);
  });

  it('throws when body is missing', () => {
    expect(() =>
      validateInput({
        token: 'a',
        notification: { title: 'x' } as NotifyKitPayloadInput['notification'],
      }),
    ).toThrow(/notification.body is required/);
  });
});

describe('validateInput — data values (Rule 6)', () => {
  it('accepts string-only data', () => {
    expect(() =>
      validateInput(
        base({
          notification: {
            title: 'a',
            body: 'b',
            data: { orderId: '42', customer: 'acme' },
          },
        }),
      ),
    ).not.toThrow();
  });

  it('throws with exact message on non-string data value', () => {
    expect(() =>
      validateInput(
        base({
          notification: {
            title: 'a',
            body: 'b',
            data: { count: 7 } as unknown as Record<string, string>,
          },
        }),
      ),
    ).toThrow(
      "[react-native-notify-kit/server] Validation: FCM data values must be strings. Got number for key 'count'. Use JSON.stringify() if you need to pass complex values.",
    );
  });

  it('throws on boolean data value', () => {
    expect(() =>
      validateInput(
        base({
          notification: {
            title: 'a',
            body: 'b',
            data: { flag: true } as unknown as Record<string, string>,
          },
        }),
      ),
    ).toThrow(/Got boolean for key 'flag'/);
  });
});

describe('validateInput — iOS attachments (Rule 11)', () => {
  it('accepts https:// attachment URLs', () => {
    expect(() =>
      validateInput(
        base({
          notification: {
            title: 'a',
            body: 'b',
            ios: { attachments: [{ url: 'https://cdn.example.com/a.png' }] },
          },
        }),
      ),
    ).not.toThrow();
  });

  it('throws on http:// attachment URL with exact message', () => {
    expect(() =>
      validateInput(
        base({
          notification: {
            title: 'a',
            body: 'b',
            ios: { attachments: [{ url: 'http://example.com/img.jpg' }] },
          },
        }),
      ),
    ).toThrow(
      '[react-native-notify-kit/server] iOS: iOS attachments require https:// URLs. Got: http://example.com/img.jpg',
    );
  });

  it('throws on file:// attachment URL', () => {
    expect(() =>
      validateInput(
        base({
          notification: {
            title: 'a',
            body: 'b',
            ios: { attachments: [{ url: 'file:///var/tmp/a.png' }] },
          },
        }),
      ),
    ).toThrow(/iOS attachments require https:\/\/ URLs/);
  });

  it('catches the first bad attachment even if later ones are valid', () => {
    expect(() =>
      validateInput(
        base({
          notification: {
            title: 'a',
            body: 'b',
            ios: {
              attachments: [
                { url: 'https://ok.example.com/a.png' },
                { url: 'http://bad.example.com/b.png' },
              ],
            },
          },
        }),
      ),
    ).toThrow(/http:\/\/bad\.example\.com/);
  });
});

describe('validateInput — defensive type guards', () => {
  it('throws when input is null', () => {
    expect(() => validateInput(null as unknown as NotifyKitPayloadInput)).toThrow(
      '[react-native-notify-kit/server] Validation: input must be an object',
    );
  });

  it('throws when input is a string', () => {
    expect(() => validateInput('oops' as unknown as NotifyKitPayloadInput)).toThrow(
      /input must be an object/,
    );
  });

  it('throws on non-string token', () => {
    expect(() =>
      validateInput({
        token: 123 as unknown as string,
        notification: { title: 'a', body: 'b' },
      }),
    ).toThrow(/'token' must be a non-empty string/);
  });

  it('throws on empty-string topic', () => {
    expect(() => validateInput({ topic: '', notification: { title: 'a', body: 'b' } })).toThrow(
      /'topic' must be a non-empty string/,
    );
  });

  it('throws on empty-string condition when provided alone', () => {
    expect(() =>
      validateInput({
        condition: 123 as unknown as string,
        notification: { title: 'a', body: 'b' },
      }),
    ).toThrow(/'condition' must be a non-empty string/);
  });

  it('throws when notification is null', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: null as unknown as NotifyKitPayloadInput['notification'],
      }),
    ).toThrow(/'notification' is required and must be an object/);
  });

  it('throws when notification.data is not an object', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          title: 'a',
          body: 'b',
          data: 'oops' as unknown as Record<string, string>,
        },
      }),
    ).toThrow(/'notification.data' must be an object/);
  });

  it('throws when notification.data is null', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          title: 'a',
          body: 'b',
          data: null as unknown as Record<string, string>,
        },
      }),
    ).toThrow(/'notification.data' must be an object/);
  });

  it('throws when ios.attachments is not an array', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          title: 'a',
          body: 'b',
          ios: { attachments: 'oops' as unknown as [] },
        },
      }),
    ).toThrow(/'notification.ios.attachments' must be an array/);
  });

  it('throws when an attachment is missing the url field', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: {
          title: 'a',
          body: 'b',
          ios: { attachments: [{} as unknown as { url: string }] },
        },
      }),
    ).toThrow(/each attachment must be an object with a string 'url' field/);
  });

  it('throws when options is not an object', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: 'oops' as unknown as NotifyKitPayloadInput['options'],
      }),
    ).toThrow(/'options' must be an object/);
  });

  it('throws on invalid androidPriority', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: { androidPriority: 'urgent' as unknown as 'high' },
      }),
    ).toThrow(/'options.androidPriority' must be 'high' or 'normal'/);
  });

  it('throws on negative iosBadgeCount', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: { iosBadgeCount: -1 },
      }),
    ).toThrow(/'options.iosBadgeCount' must be a non-negative integer/);
  });

  it('throws on fractional iosBadgeCount', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: { iosBadgeCount: 1.5 },
      }),
    ).toThrow(/non-negative integer/);
  });

  it('throws on negative ttl', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: { ttl: -10 },
      }),
    ).toThrow(/options\.ttl must be a positive integer \(seconds\)\. Got: -10/);
  });

  it('throws on zero ttl', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: { ttl: 0 },
      }),
    ).toThrow(/options\.ttl must be a positive integer \(seconds\)\. Got: 0/);
  });

  it('throws on fractional ttl', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: { ttl: 1.5 },
      }),
    ).toThrow(/options\.ttl must be a positive integer \(seconds\)\. Got: 1\.5/);
  });

  it('throws on non-number ttl', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: { ttl: '60' as unknown as number },
      }),
    ).toThrow(/options\.ttl must be a positive integer/);
  });

  it('throws on non-string collapseKey', () => {
    expect(() =>
      validateInput({
        token: 't',
        notification: { title: 'a', body: 'b' },
        options: { collapseKey: 42 as unknown as string },
      }),
    ).toThrow(/'options.collapseKey' must be a non-empty string/);
  });
});
