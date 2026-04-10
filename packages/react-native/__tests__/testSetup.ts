import * as utils from 'react-native-notify-kit/src/utils';

export const setPlatform = (platform: string): void => {
  Object.defineProperty(utils, 'isIOS', {
    value: platform === 'ios',
    configurable: true,
    writable: true,
  });
  Object.defineProperty(utils, 'isAndroid', {
    value: platform === 'android',
    configurable: true,
    writable: true,
  });
};
