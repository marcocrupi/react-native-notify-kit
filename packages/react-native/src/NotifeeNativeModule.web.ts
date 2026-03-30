import { NativeModulesStatic } from 'react-native';
import NotifeeJSEventEmitter from './NotifeeJSEventEmitter';

export interface NativeModuleConfig {
  version: string;
  nativeModuleName: string;
  nativeEvents: string[];
}

export default class NotifeeNativeModule {
  // @ts-ignore unused value
  private readonly _moduleConfig: NativeModuleConfig;

  public constructor(config: NativeModuleConfig) {
    this._moduleConfig = Object.assign({}, config);
  }

  public get emitter() {
    return NotifeeJSEventEmitter;
  }

  public get native(): NativeModulesStatic {
    return {};
  }
}
