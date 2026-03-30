/*
 * Copyright (c) 2016-present Invertase Limited
 */

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  // Constants (Android only; iOS returns 0)
  getConstants(): { ANDROID_API_LEVEL: number };

  // ─── Shared ───────────────────────────────────────────────────────────────

  cancelAllNotifications(): Promise<void>;
  cancelDisplayedNotifications(): Promise<void>;
  cancelTriggerNotifications(): Promise<void>;
  cancelAllNotificationsWithIds(
    ids: Array<string>,
    notificationType: number,
    tag: string | null,
  ): Promise<void>;
  getDisplayedNotifications(): Promise<Array<Object>>;
  getTriggerNotifications(): Promise<Array<Object>>;
  getTriggerNotificationIds(): Promise<Array<string>>;
  displayNotification(notification: Object): Promise<void>;
  createTriggerNotification(notification: Object, trigger: Object): Promise<void>;
  requestPermission(permissions: Object): Promise<Object>;
  getNotificationSettings(): Promise<Object>;
  getInitialNotification(): Promise<Object | null>;

  // ─── Android-only ─────────────────────────────────────────────────────────

  createChannel(channelMap: Object): Promise<void>;
  createChannels(channelsArray: Array<Object>): Promise<void>;
  createChannelGroup(channelGroupMap: Object): Promise<void>;
  createChannelGroups(channelGroupsArray: Array<Object>): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  deleteChannelGroup(channelGroupId: string): Promise<void>;
  getChannel(channelId: string): Promise<Object | null>;
  getChannels(): Promise<Array<Object>>;
  getChannelGroup(channelGroupId: string): Promise<Object | null>;
  getChannelGroups(): Promise<Array<Object>>;
  isChannelCreated(channelId: string): Promise<boolean>;
  isChannelBlocked(channelId: string): Promise<boolean>;
  openAlarmPermissionSettings(): Promise<void>;
  openNotificationSettings(channelId: string | null): Promise<void>;
  openBatteryOptimizationSettings(): Promise<void>;
  isBatteryOptimizationEnabled(): Promise<boolean>;
  getPowerManagerInfo(): Promise<Object>;
  openPowerManagerSettings(): Promise<void>;
  stopForegroundService(): Promise<void>;
  hideNotificationDrawer(): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;

  // ─── iOS-only ─────────────────────────────────────────────────────────────

  cancelNotification(notificationId: string): Promise<void>;
  cancelDisplayedNotification(notificationId: string): Promise<void>;
  cancelTriggerNotification(notificationId: string): Promise<void>;
  cancelDisplayedNotificationsWithIds(ids: Array<string>): Promise<void>;
  cancelTriggerNotificationsWithIds(ids: Array<string>): Promise<void>;
  getNotificationCategories(): Promise<Array<Object>>;
  setNotificationCategories(categories: Array<Object>): Promise<void>;
  setBadgeCount(count: number): Promise<void>;
  getBadgeCount(): Promise<number>;
  incrementBadgeCount(incrementBy: number): Promise<void>;
  decrementBadgeCount(decrementBy: number): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NotifeeApiModule');
