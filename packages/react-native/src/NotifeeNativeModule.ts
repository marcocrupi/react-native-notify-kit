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
  private readonly _config: NativeModuleConfig;
  private _nativeModule?: Spec;
  private _nativeEmitter?: NativeEventEmitter;

  public constructor(config: NativeModuleConfig) {
    // Defer all native access out of the constructor. The default export of this package is a
    // singleton constructed at module-evaluation time, so resolving the TurboModule here meant
    // it ran the instant `react-native-notify-kit` was imported. On the New Architecture in
    // bridgeless mode, importing the package early (e.g. registering `onBackgroundEvent` at the
    // top of index.js, before the app root mounts) executes before TurboModules are installed,
    // so `getEnforcing` throws "NotifeeApiModule could not be found" / "runtime not ready" and
    // the module is unusable for the whole session. Resolving lazily on first `.native` access
    // defers it until a notifee method actually runs, when the TurboModule is available.
    this._config = config;
  }

  public get emitter() {
    return NotifeeJSEventEmitter;
  }

  public get native(): Spec {
    if (!this._nativeModule) {
      this._nativeModule = TurboModuleRegistry.getEnforcing<Spec>(this._config.nativeModuleName);

      // @ts-ignore - change here needs resolution https://github.com/DefinitelyTyped/DefinitelyTyped/pull/49560/files
      this._nativeEmitter = new NativeEventEmitter(this._nativeModule as EventSubscription['subscriber']);
      for (let i = 0; i < this._config.nativeEvents.length; i++) {
        const eventName = this._config.nativeEvents[i];
        this._nativeEmitter.addListener(eventName, (payload: any) => {
          this.emitter.emit(eventName, payload);
        });
      }
    }
    return this._nativeModule;
  }
}
