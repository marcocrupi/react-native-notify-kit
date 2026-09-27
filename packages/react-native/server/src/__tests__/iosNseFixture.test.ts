import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildNotifyKitPayload } from '../buildPayload';
import type { NotifyKitApnsPayload, NotifyKitPayloadInput } from '../types';

type NativeFixture = {
  name: string;
  input: NotifyKitPayloadInput;
  apnsPayload: NotifyKitApnsPayload;
};

const fixturePath = resolve(
  __dirname,
  '../../../../../ios/NotifeeCoreTests/fixtures/fcm-mode-ios-batch1.json',
);
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as NativeFixture[];

describe('APNs fixtures consumed by the production NSE helper harness', () => {
  it.each(fixtures)(
    '$name matches the current Server SDK wire payload',
    ({ input, apnsPayload }) => {
      const output = buildNotifyKitPayload(input);

      expect(output.apns.payload).toEqual(apnsPayload);
      expect(JSON.parse(apnsPayload.notifee_options)._v).toBe(1);
      expect(output.data.notifee_options).toBe(apnsPayload.notifee_options);
    },
  );
});
