import { buildNotifyKitPayload } from '../buildPayload';
import type { NotifyKitPayloadInput } from '../types';

const baseNotification = { title: 'Main title', body: 'Main body' };
const sparseLaterFlags = [2];
sparseLaterFlags.length = 2;

function build(android?: unknown) {
  return buildNotifyKitPayload({
    token: 'device-token',
    notification: {
      ...baseNotification,
      ...(android === undefined ? {} : { android }),
    } as NotifyKitPayloadInput['notification'],
  });
}

function wire(android?: unknown) {
  const payload = build(android);
  const options = JSON.parse(payload.data.notifee_options as string);
  expect(payload.apns.payload.notifee_options).toBe(payload.data.notifee_options);
  expect(options._v).toBe(1);
  expect(payload.android).toEqual({ priority: 'high' });
  expect(payload.android).not.toHaveProperty('notification');
  return options;
}

describe('FCM Mode Batch 2B Android interaction wire contract', () => {
  it('keeps legacy version-1 bytes when Android interactions are absent', () => {
    expect(build().data.notifee_options).toBe('{"_v":1,"title":"Main title","body":"Main body"}');
    expect(wire({ channelId: 'news' }).android).toEqual({ channelId: 'news' });
  });

  it('distinguishes absent, explicit null, and object notification pressAction', () => {
    const absent = wire({ channelId: 'news' });
    const explicitNull = wire({ channelId: 'news', pressAction: null });
    const configured = wire({ channelId: 'news', pressAction: { id: 'open' } });

    expect(absent.android).not.toHaveProperty('pressAction');
    expect(explicitNull.android).toHaveProperty('pressAction', null);
    expect(configured.android.pressAction).toEqual({ id: 'open' });
  });

  it('preserves the complete body pressAction and launch flag ordering', () => {
    const pressAction = {
      id: 'open-order',
      launchActivity: 'com.example.OrdersActivity',
      mainComponent: 'Orders',
      launchActivityFlags: [2, 4, 1],
    };

    expect(wire({ pressAction }).android.pressAction).toEqual(pressAction);
  });

  it('preserves action ordering and distinct complete press configurations', () => {
    const actions = [
      {
        title: 'Open',
        pressAction: {
          id: 'open',
          launchActivity: 'com.example.OrdersActivity',
          mainComponent: 'Orders',
          launchActivityFlags: [4, 2],
        },
        icon: 'https://cdn.example.com/open.png',
      },
      { title: 'Mark done', pressAction: { id: 'done', mainComponent: 'Done' } },
      { title: 'Dismiss', pressAction: { id: 'dismiss', launchActivityFlags: [0, 20] } },
    ];

    expect(wire({ actions }).android.actions).toEqual(actions);
  });

  it('keeps absent input absent and explicit true unchanged', () => {
    const actions = [
      { title: 'Done', pressAction: { id: 'done' } },
      { title: 'Reply', pressAction: { id: 'reply' }, input: true },
    ];
    const serialized = wire({ actions }).android.actions;

    expect(serialized[0]).not.toHaveProperty('input');
    expect(serialized[1]).toHaveProperty('input', true);
  });

  it('preserves minimal and complete AndroidInput objects, false values, and choice order', () => {
    const complete = {
      allowFreeFormInput: true,
      allowGeneratedReplies: false,
      choices: ['Later', 'Now', 'Tomorrow'],
      editableChoices: false,
      placeholder: '',
    };
    const actions = [
      { title: 'Basic', pressAction: { id: 'basic' }, input: {} },
      { title: 'Reply', pressAction: { id: 'reply' }, input: complete },
      {
        title: 'Choose',
        pressAction: { id: 'choose' },
        input: { allowFreeFormInput: false, choices: ['A', 'B'], editableChoices: false },
      },
    ];
    const serialized = wire({ actions }).android.actions;

    expect(serialized[0].input).toEqual({});
    expect(serialized[1].input).toEqual(complete);
    expect(serialized[2].input).toEqual({
      allowFreeFormInput: false,
      choices: ['A', 'B'],
      editableChoices: false,
    });
  });

  it('accounts for the UTF-8 bytes of interaction fields', () => {
    const payload = build({
      actions: [
        {
          title: 'Répondre 🚀',
          pressAction: { id: 'reply', mainComponent: 'Réponses' },
          input: { choices: ['Oui', 'Non 🚀'], allowGeneratedReplies: false },
        },
      ],
    });

    expect(payload.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'));
    expect(payload.sizeBytes).toBeGreaterThan(build().sizeBytes);
  });
});

describe('FCM Mode Batch 2B server interaction validation', () => {
  it.each([
    ['missing ID', {}],
    ['empty ID', { id: '' }],
    ['non-string ID', { id: 7 }],
    ['invalid launchActivity', { id: 'open', launchActivity: 7 }],
    ['invalid mainComponent', { id: 'open', mainComponent: false }],
    ['non-array flags', { id: 'open', launchActivityFlags: 'NEW_TASK' }],
    ['non-numeric first flag', { id: 'open', launchActivityFlags: ['NEW_TASK'] }],
    ['non-numeric later flag', { id: 'open', launchActivityFlags: [2, 'bad'] }],
    ['out-of-range enum flag', { id: 'open', launchActivityFlags: [21] }],
    ['fractional enum flag', { id: 'open', launchActivityFlags: [1.5] }],
    ['sparse flags array', { id: 'open', launchActivityFlags: Array(1) }],
    ['sparse later flag', { id: 'open', launchActivityFlags: sparseLaterFlags }],
    ['unknown field', { id: 'open', unsupported: 'value' }],
  ])('rejects body pressAction with %s', (_name, pressAction) => {
    expect(() => build({ pressAction })).toThrow(/pressAction|launchActivityFlags/);
  });

  it('reserves the native body opt-out ID for explicit null', () => {
    expect(() => build({ pressAction: { id: '__NOTIFEE_OPT_OUT__' } })).toThrow(/pressAction/);
    expect(wire({ pressAction: null }).android.pressAction).toBeNull();
  });

  it('rejects the native opt-out ID as an action pressAction ID', () => {
    expect(() =>
      build({
        actions: [{ title: 'Open', pressAction: { id: '__NOTIFEE_OPT_OUT__' } }],
      }),
    ).toThrow(/pressAction.*reserved/);
  });

  it.each([
    ['missing ID', {}],
    ['invalid mainComponent', { id: 'open', mainComponent: 4 }],
    ['invalid launch flags', { id: 'open', launchActivityFlags: [false] }],
    ['non-numeric later flag', { id: 'open', launchActivityFlags: [2, 'bad'] }],
    ['out-of-range enum flag', { id: 'open', launchActivityFlags: [21] }],
    ['unknown field', { id: 'open', unsupported: true }],
  ])('rejects action pressAction with %s', (_name, pressAction) => {
    expect(() => build({ actions: [{ title: 'Open', pressAction }] })).toThrow(
      /pressAction|launchActivityFlags/,
    );
  });

  it.each([false, null, 'reply', 1, []])('rejects unsupported action input value %p', input => {
    expect(() =>
      build({ actions: [{ title: 'Reply', pressAction: { id: 'reply' }, input }] }),
    ).toThrow(/input/);
  });

  it.each([
    ['allowFreeFormInput', { allowFreeFormInput: 'false' }],
    ['explicit undefined allowFreeFormInput', { allowFreeFormInput: undefined }],
    ['allowGeneratedReplies', { allowGeneratedReplies: 0 }],
    ['explicit undefined allowGeneratedReplies', { allowGeneratedReplies: undefined }],
    ['choices non-array', { choices: 'Yes' }],
    ['explicit undefined choices', { choices: undefined }],
    ['choices non-string entry', { choices: ['Yes', 5] }],
    ['empty choices', { choices: [] }],
    ['sparse choices array', { choices: Array(1) }],
    ['editableChoices', { editableChoices: 'true' }],
    ['explicit undefined editableChoices', { editableChoices: undefined }],
    ['placeholder', { placeholder: 42 }],
    ['explicit undefined placeholder', { placeholder: undefined }],
    ['unknown field', { unsupported: true }],
    ['free-form disabled without choices', { allowFreeFormInput: false }],
    [
      'editable choices with free-form disabled',
      { allowFreeFormInput: false, choices: ['Yes'], editableChoices: true },
    ],
  ])('rejects invalid AndroidInput %s', (_name, input) => {
    expect(() =>
      build({ actions: [{ title: 'Reply', pressAction: { id: 'reply' }, input }] }),
    ).toThrow(/input/);
  });

  it.each([null, 3, '', []])('rejects invalid action icon %p', icon => {
    expect(() =>
      build({ actions: [{ title: 'Open', pressAction: { id: 'open' }, icon }] }),
    ).toThrow(/icon/);
  });

  it.each([
    ['null', null],
    ['object', {}],
    ['string', 'Reply'],
    ['array with null entry', [null]],
    ['array with string entry', ['Reply']],
    ['missing title', [{ pressAction: { id: 'reply' } }]],
    ['empty title', [{ title: '', pressAction: { id: 'reply' } }]],
    ['non-string title', [{ title: 4, pressAction: { id: 'reply' } }]],
    ['missing pressAction', [{ title: 'Reply' }]],
    ['unknown action key', [{ title: 'Reply', pressAction: { id: 'reply' }, unsupported: true }]],
  ])('rejects malformed actions: %s', (_name, actions) => {
    expect(() => build({ actions })).toThrow(/actions|action|title|pressAction/);
  });

  it('continues to reject duplicate sibling pressAction IDs with different configurations', () => {
    expect(() =>
      build({
        actions: [
          { title: 'One', pressAction: { id: 'same', mainComponent: 'One' } },
          { title: 'Two', pressAction: { id: 'same', launchActivityFlags: [2] } },
        ],
      }),
    ).toThrow(/pressAction IDs must be unique within the notification/);
  });
});
