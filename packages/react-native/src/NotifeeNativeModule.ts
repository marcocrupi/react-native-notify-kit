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
    if (!this._nativeModule || !this._nativeEmitter) {
      const nativeModule = TurboModuleRegistry.getEnforcing<Spec>(this._config.nativeModuleName);

      // @ts-ignore - change here needs resolution https://github.com/DefinitelyTyped/DefinitelyTyped/pull/49560/files
      const nativeEmitter = new NativeEventEmitter(nativeModule as EventSubscription['subscriber']);
      const subscriptions: EventSubscription[] = [];

      try {
        for (let i = 0; i < this._config.nativeEvents.length; i++) {
          const eventName = this._config.nativeEvents[i];
          subscriptions.push(
            nativeEmitter.addListener(eventName, (payload: any) => {
              this.emitter.emit(eventName, payload);
            }),
          );
        }
      } catch (error) {
        for (let i = 0; i < subscriptions.length; i++) {
          subscriptions[i].remove();
        }
        throw error;
      }

      this._nativeModule = nativeModule;
      this._nativeEmitter = nativeEmitter;
    }
    return this._nativeModule;
  }
}
