/**
 * Copyright (c) 2016-present Invertase Limited & Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this library except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

#import "NotifeeApiModule.h"
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

static NSString *kReactNativeNotifeeNotificationEvent = @"app.notifee.notification-event";
static NSString *kReactNativeNotifeeNotificationBackgroundEvent =
    @"app.notifee.notification-event-background";

static NSInteger kReactNativeNotifeeNotificationTypeDisplayed = 1;
static NSInteger kReactNativeNotifeeNotificationTypeTrigger = 2;
static NSInteger kReactNativeNotifeeNotificationTypeAll = 0;

@implementation NotifeeApiModule {
  bool hasListeners;
  NSMutableArray *pendingCoreEvents;
}

#pragma mark - Module Setup

RCT_EXPORT_MODULE();

- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

- (id)init {
  if (self = [super init]) {
    pendingCoreEvents = [[NSMutableArray alloc] init];
    [NotifeeCore setCoreDelegate:self];
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[ kReactNativeNotifeeNotificationEvent, kReactNativeNotifeeNotificationBackgroundEvent ];
}

- (void)startObserving {
  hasListeners = YES;
  for (NSDictionary *eventBody in pendingCoreEvents) {
    [self sendNotifeeCoreEvent:eventBody];
  }
  [pendingCoreEvents removeAllObjects];
}

- (void)stopObserving {
  hasListeners = NO;
}

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeNotifeeModuleSpecJSI>(params);
}

- (NSDictionary *)getConstants {
  return @{@"ANDROID_API_LEVEL" : @0};
}

#pragma mark - Events

- (void)didReceiveNotifeeCoreEvent:(NSDictionary *_Nonnull)event {
  if (hasListeners) {
    [self sendNotifeeCoreEvent:event];
  } else {
    [pendingCoreEvents addObject:event];
  }
}

- (void)sendNotifeeCoreEvent:(NSDictionary *_Nonnull)eventBody {
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (RCTRunningInAppExtension() ||
            [UIApplication sharedApplication].applicationState == UIApplicationStateBackground) {
          [self sendEventWithName:kReactNativeNotifeeNotificationBackgroundEvent body:eventBody];
        } else {
          [self sendEventWithName:kReactNativeNotifeeNotificationEvent body:eventBody];
        }
      });
}

// clang-format off

#pragma mark - Shared Methods

- (void)cancelAllNotifications:(RCTPromiseResolveBlock)resolve
                        reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore cancelAllNotifications:kReactNativeNotifeeNotificationTypeAll withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)cancelDisplayedNotifications:(RCTPromiseResolveBlock)resolve
                              reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore cancelAllNotifications:kReactNativeNotifeeNotificationTypeDisplayed withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)cancelTriggerNotifications:(RCTPromiseResolveBlock)resolve
                            reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore cancelAllNotifications:kReactNativeNotifeeNotificationTypeTrigger withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)cancelAllNotificationsWithIds:(NSArray *)ids
                     notificationType:(double)notificationType
                                  tag:(NSString *_Nullable)tag
                              resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject {
  // tag is Android-only, ignored on iOS
  [NotifeeCore cancelAllNotificationsWithIds:(NSInteger)notificationType withIds:ids withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)getDisplayedNotifications:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore getDisplayedNotifications:^(NSError *_Nullable error, NSArray<NSDictionary *> *notifications) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:notifications];
  }];
}

- (void)getTriggerNotifications:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore getTriggerNotifications:^(NSError *_Nullable error, NSArray<NSDictionary *> *notifications) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:notifications];
  }];
}

- (void)getTriggerNotificationIds:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore getTriggerNotificationIds:^(NSError *_Nullable error, NSArray<NSDictionary *> *notifications) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:notifications];
  }];
}

- (void)displayNotification:(NSDictionary *)notification
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore displayNotification:notification withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)createTriggerNotification:(NSDictionary *)notification
                          trigger:(NSDictionary *)trigger
                          resolve:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore createTriggerNotification:notification withTrigger:trigger withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)requestPermission:(NSDictionary *)permissions
                  resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore requestPermission:permissions withBlock:^(NSError *_Nullable error, NSDictionary *settings) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:settings];
  }];
}

- (void)getNotificationSettings:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore getNotificationSettings:^(NSError *_Nullable error, NSDictionary *settings) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:settings];
  }];
}

- (void)getInitialNotification:(RCTPromiseResolveBlock)resolve
                        reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore getInitialNotification:^(NSError *_Nullable error, NSDictionary *notification) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:notification];
  }];
}

#pragma mark - iOS-only Methods

- (void)cancelNotification:(NSString *)notificationId
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore cancelNotification:notificationId withNotificationType:kReactNativeNotifeeNotificationTypeAll withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)cancelDisplayedNotification:(NSString *)notificationId
                            resolve:(RCTPromiseResolveBlock)resolve
                             reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore cancelNotification:notificationId withNotificationType:kReactNativeNotifeeNotificationTypeDisplayed withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)cancelTriggerNotification:(NSString *)notificationId
                          resolve:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore cancelNotification:notificationId withNotificationType:kReactNativeNotifeeNotificationTypeTrigger withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)cancelDisplayedNotificationsWithIds:(NSArray *)ids
                                    resolve:(RCTPromiseResolveBlock)resolve
                                     reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore cancelAllNotificationsWithIds:kReactNativeNotifeeNotificationTypeDisplayed withIds:ids withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)cancelTriggerNotificationsWithIds:(NSArray *)ids
                                  resolve:(RCTPromiseResolveBlock)resolve
                                   reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore cancelAllNotificationsWithIds:kReactNativeNotifeeNotificationTypeTrigger withIds:ids withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)getNotificationCategories:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore getNotificationCategories:^(NSError *_Nullable error, NSArray<NSDictionary *> *categories) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:categories];
  }];
}

- (void)setNotificationCategories:(NSArray *)categories
                          resolve:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore setNotificationCategories:categories withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)setBadgeCount:(double)count
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore setBadgeCount:(NSInteger)count withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)getBadgeCount:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore getBadgeCount:^(NSError *_Nullable error, NSInteger count) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:@(count)];
  }];
}

- (void)incrementBadgeCount:(double)incrementBy
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore incrementBadgeCount:(NSInteger)incrementBy withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

- (void)decrementBadgeCount:(double)decrementBy
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  [NotifeeCore decrementBadgeCount:(NSInteger)decrementBy withBlock:^(NSError *_Nullable error) {
    [self resolve:resolve orReject:reject promiseWithError:error orResult:nil];
  }];
}

#pragma mark - Android-only stubs (required by NativeNotifeeModuleSpec)

- (void)createChannel:(NSDictionary *)channelMap
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)createChannels:(NSArray *)channelsArray
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)createChannelGroup:(NSDictionary *)channelGroupMap
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)createChannelGroups:(NSArray *)channelGroupsArray
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)deleteChannel:(NSString *)channelId
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)deleteChannelGroup:(NSString *)channelGroupId
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)getChannel:(NSString *)channelId
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)getChannels:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)getChannelGroup:(NSString *)channelGroupId
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)getChannelGroups:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)isChannelCreated:(NSString *)channelId
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
  resolve(@(NO));
}

- (void)isChannelBlocked:(NSString *)channelId
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
  resolve(@(NO));
}

- (void)openAlarmPermissionSettings:(RCTPromiseResolveBlock)resolve
                             reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)openNotificationSettings:(NSString *_Nullable)channelId
                         resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)openBatteryOptimizationSettings:(RCTPromiseResolveBlock)resolve
                                 reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)isBatteryOptimizationEnabled:(RCTPromiseResolveBlock)resolve
                              reject:(RCTPromiseRejectBlock)reject {
  resolve(@(NO));
}

- (void)getPowerManagerInfo:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  resolve(@{});
}

- (void)openPowerManagerSettings:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)stopForegroundService:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject {
  resolve(nil);
}

- (void)hideNotificationDrawer {
  // Android-only, no-op on iOS
}

- (void)addListener:(NSString *)eventName {
  [super addListener:eventName];
}

- (void)removeListeners:(double)count {
  [super removeListeners:count];
}

// clang-format on

#pragma mark - Internals

- (void)resolve:(RCTPromiseResolveBlock)resolve
            orReject:(RCTPromiseRejectBlock)reject
    promiseWithError:(NSError *_Nullable)error
            orResult:(id _Nullable)result {
  if (error != nil) {
    reject(@"unknown", error.localizedDescription, error);
  } else {
    resolve(result);
  }
}

@end
