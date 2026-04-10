import { setPlatform } from './testSetup';
import * as utils from 'react-native-notify-kit/src/utils';

describe('setPlatform', () => {
  afterAll(() => {
    setPlatform('android');
  });

  test('can be called multiple times within a single test block', () => {
    setPlatform('ios');
    expect(utils.isIOS).toBe(true);
    expect(utils.isAndroid).toBe(false);

    setPlatform('android');
    expect(utils.isAndroid).toBe(true);
    expect(utils.isIOS).toBe(false);

    setPlatform('ios');
    expect(utils.isIOS).toBe(true);
    expect(utils.isAndroid).toBe(false);
  });
});
