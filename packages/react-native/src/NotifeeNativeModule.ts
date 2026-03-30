/*
 * Copyright (c) 2016-present Invertase Limited
 */

import NotifeeJSEventEmitter from './NotifeeJSEventEmitter';
import { EventSubscription, NativeEventEmitter, TurboModuleRegistry } from 'react-native';
import type { Spec } from './specs/NativeNotifeeModule';

export interface NativeModuleConfig {
  version: string;
  nativeModuleName: string;
  nativeEvents: string[];
}

export default class NotifeeNativeModule {
  private _nativeModule: Spec;
  private _nativeEmitter: NativeEventEmitter;

  public constructor(config: NativeModuleConfig) {
    this._nativeModule = TurboModuleRegistry.getEnforcing<Spec>(config.nativeModuleName);

    // @ts-ignore - change here needs resolution https://github.com/DefinitelyTyped/DefinitelyTyped/pull/49560/files
    this._nativeEmitter = new NativeEventEmitter(this.native as EventSubscription['subscriber']);
    for (let i = 0; i < config.nativeEvents.length; i++) {
      const eventName = config.nativeEvents[i];
      this._nativeEmitter.addListener(eventName, (payload: any) => {
        this.emitter.emit(eventName, payload);
      });
    }
  }

  public get emitter() {
    return NotifeeJSEventEmitter;
  }

  public get native(): Spec {
    return this._nativeModule;
  }
}
