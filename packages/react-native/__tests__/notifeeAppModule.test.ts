import Notifee from 'react-native-notify-kit';

describe('Notifee App Module', () => {
  test('Module is defined on import', () => {
    expect(Notifee).toBeDefined();
  });
  test('Version from module package.json matches SDK_VERSION', () => {
    const notifeePackageJSON = require('react-native-notify-kit/package.json');
    expect(Notifee.SDK_VERSION).toEqual(notifeePackageJSON.version);
  });
});
