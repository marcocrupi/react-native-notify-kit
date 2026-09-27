import { buildNotifyKitPayload } from '../buildPayload';
import type { NotifyKitPayloadInput } from '../types';

const baseNotification = { title: 'Main title', body: 'Main body' };

function build(notification: unknown) {
  return buildNotifyKitPayload({
    token: 'device-token',
    notification: notification as NotifyKitPayloadInput['notification'],
  });
}

function readBothWireCopies(payload: ReturnType<typeof buildNotifyKitPayload>) {
  const android = JSON.parse(payload.data.notifee_options as string);
  const ios = JSON.parse(payload.apns.payload.notifee_options);
  expect(ios).toEqual(android);
  expect(android._v).toBe(1);
  return android;
}

describe('FCM Mode Batch 2A server wire contract', () => {
  it.each([
    {
      name: 'top-level subtitle',
      notification: { ...baseNotification, subtitle: 'Second line' },
      expected: { subtitle: 'Second line' },
    },
    {
      name: 'Android circularLargeIcon',
      notification: {
        ...baseNotification,
        android: { largeIcon: 'https://cdn.example.com/large.png', circularLargeIcon: true },
      },
      expected: {
        android: { largeIcon: 'https://cdn.example.com/large.png', circularLargeIcon: true },
      },
    },
    {
      name: 'BIG_TEXT.title',
      notification: {
        ...baseNotification,
        android: { style: { type: 'BIG_TEXT', text: 'Expanded text', title: 'Expanded title' } },
      },
      expected: {
        android: { style: { type: 'BIG_TEXT', text: 'Expanded text', title: 'Expanded title' } },
      },
    },
    {
      name: 'BIG_TEXT.summary',
      notification: {
        ...baseNotification,
        android: { style: { type: 'BIG_TEXT', text: 'Expanded text', summary: 'Text summary' } },
      },
      expected: {
        android: { style: { type: 'BIG_TEXT', text: 'Expanded text', summary: 'Text summary' } },
      },
    },
    {
      name: 'BIG_PICTURE.title',
      notification: {
        ...baseNotification,
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            title: 'Picture title',
          },
        },
      },
      expected: {
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            title: 'Picture title',
          },
        },
      },
    },
    {
      name: 'BIG_PICTURE.summary',
      notification: {
        ...baseNotification,
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            summary: 'Picture summary',
          },
        },
      },
      expected: {
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            summary: 'Picture summary',
          },
        },
      },
    },
    {
      name: 'BIG_PICTURE.largeIcon string',
      notification: {
        ...baseNotification,
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            largeIcon: 'https://cdn.example.com/expanded-icon.png',
          },
        },
      },
      expected: {
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            largeIcon: 'https://cdn.example.com/expanded-icon.png',
          },
        },
      },
    },
  ])('preserves $name in Android data and iOS NSE options', ({ notification, expected }) => {
    const wire = readBothWireCopies(build(notification));
    expect(wire).toMatchObject(expected);
  });

  it.each([
    {
      name: 'BIG_TEXT',
      style: {
        type: 'BIG_TEXT',
        text: 'Every word of the expanded text',
        title: 'Text style title',
        summary: 'Text style summary',
      },
    },
    {
      name: 'BIG_PICTURE',
      style: {
        type: 'BIG_PICTURE',
        picture: 'https://cdn.example.com/picture.png',
        title: 'Picture style title',
        summary: 'Picture style summary',
        largeIcon: 'https://cdn.example.com/expanded-icon.png',
      },
    },
  ])(
    'preserves the $name Batch 2A kitchen sink without changing the discriminator',
    ({ style }) => {
      const payload = build({
        ...baseNotification,
        subtitle: 'Shared subtitle',
        android: {
          channelId: 'orders',
          largeIcon: 'https://cdn.example.com/large.png',
          circularLargeIcon: false,
          style,
        },
      });
      const wire = readBothWireCopies(payload);

      expect(wire).toEqual({
        _v: 1,
        title: baseNotification.title,
        body: baseNotification.body,
        subtitle: 'Shared subtitle',
        android: {
          channelId: 'orders',
          largeIcon: 'https://cdn.example.com/large.png',
          circularLargeIcon: false,
          style,
        },
      });
      expect(payload.android).toEqual({ priority: 'high' });
      expect('notification' in payload.android).toBe(false);
    },
  );

  it('preserves explicit false separately from omitted circularLargeIcon', () => {
    const largeIcon = 'https://cdn.example.com/large.png';
    const absent = readBothWireCopies(build({ ...baseNotification, android: { largeIcon } }));
    const explicitFalse = readBothWireCopies(
      build({ ...baseNotification, android: { largeIcon, circularLargeIcon: false } }),
    );

    expect(absent.android).not.toHaveProperty('circularLargeIcon');
    expect(explicitFalse.android).toHaveProperty('circularLargeIcon', false);
  });

  it('preserves explicit null separately from omitted BIG_PICTURE.largeIcon', () => {
    const style = { type: 'BIG_PICTURE', picture: 'https://cdn.example.com/picture.png' };
    const absent = readBothWireCopies(build({ ...baseNotification, android: { style } }));
    const explicitNull = readBothWireCopies(
      build({ ...baseNotification, android: { style: { ...style, largeIcon: null } } }),
    );

    expect(absent.android.style).not.toHaveProperty('largeIcon');
    expect(explicitNull.android.style).toHaveProperty('largeIcon', null);
  });

  it('keeps the old minimal _v: 1 payload byte-for-byte when Batch 2A fields are absent', () => {
    const payload = build(baseNotification);
    const previousOptions = '{"_v":1,"title":"Main title","body":"Main body"}';

    expect(payload.data.notifee_options).toBe(previousOptions);
    expect(payload.apns.payload.notifee_options).toBe(previousOptions);
    const wire = readBothWireCopies(payload);
    expect(wire).not.toHaveProperty('subtitle');
    expect(wire).not.toHaveProperty('android');
  });

  it('copies shared subtitle to the initial iOS APS alert and omits it for legacy input', () => {
    const withSubtitle = build({ ...baseNotification, subtitle: 'Initial banner subtitle' });
    const legacy = build(baseNotification);

    expect(withSubtitle.apns.payload.aps.alert).toEqual({
      title: baseNotification.title,
      body: baseNotification.body,
      subtitle: 'Initial banner subtitle',
    });
    expect(legacy.apns.payload.aps.alert).toEqual({
      title: baseNotification.title,
      body: baseNotification.body,
    });
  });

  it('accounts for UTF-8 bytes of new fields in the FCM payload and warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const baseline = build(baseNotification);
      const payload = build({ ...baseNotification, subtitle: '🚀'.repeat(450) });
      expect(readBothWireCopies(payload).subtitle).toBe('🚀'.repeat(450));
      expect(payload.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'));
      expect(payload.sizeBytes).toBeGreaterThan(baseline.sizeBytes + 3500);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain(`Payload size ${payload.sizeBytes} bytes`);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('FCM Mode Batch 2A server input validation', () => {
  it.each([
    {
      name: 'subtitle number',
      notification: { ...baseNotification, subtitle: 7 },
      field: 'subtitle',
    },
    {
      name: 'subtitle null',
      notification: { ...baseNotification, subtitle: null },
      field: 'subtitle',
    },
    {
      name: 'circularLargeIcon string',
      notification: {
        ...baseNotification,
        android: { largeIcon: 'https://cdn.example.com/large.png', circularLargeIcon: 'false' },
      },
      field: 'circularLargeIcon',
    },
    {
      name: 'circularLargeIcon null',
      notification: {
        ...baseNotification,
        android: { largeIcon: 'https://cdn.example.com/large.png', circularLargeIcon: null },
      },
      field: 'circularLargeIcon',
    },
    {
      name: 'BIG_TEXT.title number',
      notification: {
        ...baseNotification,
        android: { style: { type: 'BIG_TEXT', text: 'Expanded text', title: 3 } },
      },
      field: 'title',
    },
    {
      name: 'BIG_TEXT.summary null',
      notification: {
        ...baseNotification,
        android: { style: { type: 'BIG_TEXT', text: 'Expanded text', summary: null } },
      },
      field: 'summary',
    },
    {
      name: 'BIG_PICTURE.title boolean',
      notification: {
        ...baseNotification,
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            title: true,
          },
        },
      },
      field: 'title',
    },
    {
      name: 'BIG_PICTURE.summary null',
      notification: {
        ...baseNotification,
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            summary: null,
          },
        },
      },
      field: 'summary',
    },
    {
      name: 'BIG_PICTURE.largeIcon number',
      notification: {
        ...baseNotification,
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            largeIcon: 42,
          },
        },
      },
      field: 'largeIcon',
    },
    {
      name: 'BIG_PICTURE.largeIcon object',
      notification: {
        ...baseNotification,
        android: {
          style: {
            type: 'BIG_PICTURE',
            picture: 'https://cdn.example.com/picture.png',
            largeIcon: { uri: 'https://cdn.example.com/expanded-icon.png' },
          },
        },
      },
      field: 'largeIcon',
    },
  ])('rejects invalid $name before serialization', ({ notification, field }) => {
    expect(() => build(notification)).toThrow(new RegExp(field));
  });

  it.each(['INBOX', 'MESSAGING'])('does not accept unsupported %s style', type => {
    expect(() =>
      build({ ...baseNotification, android: { style: { type, text: 'No new style types' } } }),
    ).toThrow(/style/);
  });

  it.each([
    {
      name: 'BIG_TEXT.largeIcon',
      style: { type: 'BIG_TEXT', text: 'Expanded text', largeIcon: null },
      field: 'largeIcon',
    },
    {
      name: 'BIG_PICTURE.text',
      style: {
        type: 'BIG_PICTURE',
        picture: 'https://cdn.example.com/picture.png',
        text: 'Text belongs only to BIG_TEXT',
      },
      field: 'text',
    },
    {
      name: 'BIG_TEXT.inbox lines',
      style: { type: 'BIG_TEXT', text: 'Expanded text', lines: ['Unsupported inbox line'] },
      field: 'lines',
    },
    {
      name: 'BIG_PICTURE arbitrary property',
      style: {
        type: 'BIG_PICTURE',
        picture: 'https://cdn.example.com/picture.png',
        mysteryFlag: true,
      },
      field: 'mysteryFlag',
    },
  ])('rejects unsupported nested style field $name', ({ style, field }) => {
    expect(() => build({ ...baseNotification, android: { style } })).toThrow(new RegExp(field));
  });
});
