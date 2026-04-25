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

#import <UIKit/UIKit.h>
#import <dispatch/dispatch.h>
#include <math.h>

#import "Intents/Intents.h"
#import "NotifeeCore+UNUserNotificationCenter.h"
#import "NotifeeCore.h"
#import "NotifeeCoreDelegateHolder.h"
#import "NotifeeCoreExtensionHelper.h"
#import "NotifeeCoreUtil.h"

static NSString *const kNotifeeRollingPublicId = @"notifee_rolling_public_id";
static NSString *const kNotifeeRollingOccurrenceMs = @"notifee_rolling_occurrence_ms";
static NSString *const kNotifeeRollingInternalId = @"notifee_rolling_internal_id";
static NSString *const kNotifeeRollingInternalIdPrefix = @"__notifee_rolling__";
static NSString *const kNotifeeCoreErrorDomain = @"app.notifee.core";

typedef NS_ENUM(NSInteger, NotifeeCoreRollingErrorCode) {
  NotifeeCoreRollingErrorCodeInvalidTrigger = 1,
  NotifeeCoreRollingErrorCodeBudgetExceeded = 2,
  NotifeeCoreRollingErrorCodeStorageFailed = 3,
};

@implementation NotifeeCore

+ (dispatch_queue_t)rollingTimestampQueue {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("app.notifee.core.rollingTimestamp", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

+ (NSError *)rollingTimestampErrorWithCode:(NotifeeCoreRollingErrorCode)code
                                   message:(NSString *)message {
  return [NSError errorWithDomain:kNotifeeCoreErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

+ (NSNumber *)currentTimestampMs {
  return @((long long)llround([[NSDate date] timeIntervalSince1970] * 1000.0));
}

+ (void)resolveBlock:(notifeeMethodVoidBlock)block withError:(NSError *)error {
  dispatch_async(dispatch_get_main_queue(), ^{
    block(error);
  });
}

+ (NSArray<UNNotificationRequest *> *)pendingNotificationRequests:
    (UNUserNotificationCenter *)center {
  __block NSArray<UNNotificationRequest *> *pendingRequests = @[];
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

  [center getPendingNotificationRequestsWithCompletionHandler:^(
              NSArray<UNNotificationRequest *> *_Nonnull requests) {
    pendingRequests = requests != nil ? requests : @[];
    dispatch_semaphore_signal(semaphore);
  }];

  dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
  return pendingRequests;
}

+ (NSArray<UNNotification *> *)deliveredNotifications:(UNUserNotificationCenter *)center {
  __block NSArray<UNNotification *> *deliveredNotifications = @[];
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

  [center getDeliveredNotificationsWithCompletionHandler:^(
              NSArray<UNNotification *> *_Nonnull notifications) {
    deliveredNotifications = notifications != nil ? notifications : @[];
    dispatch_semaphore_signal(semaphore);
  }];

  dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
  return deliveredNotifications;
}

+ (NSString *)rollingPublicIdForNotification:(NSDictionary *)notification {
  NSString *publicId = notification[@"id"];
  if (![publicId isKindOfClass:NSString.class] || [publicId length] == 0) {
    return nil;
  }

  return publicId;
}

+ (BOOL)isPotentialRollingInternalNotificationId:(NSString *)notificationId {
  return [notificationId isKindOfClass:NSString.class] &&
         [notificationId hasPrefix:kNotifeeRollingInternalIdPrefix];
}

+ (NSString *)rollingPublicIdForRequest:(UNNotificationRequest *)request {
  NSString *identifier = request.identifier;
  NSString *mappedPublicId =
      [NotifeeCoreUtil rollingPublicIdFromInternalNotificationId:identifier];
  if ([mappedPublicId isKindOfClass:NSString.class] && [mappedPublicId length] > 0) {
    return mappedPublicId;
  }

  if ([self isPotentialRollingInternalNotificationId:identifier]) {
    NSString *metadataPublicId = request.content.userInfo[kNotifeeRollingPublicId];
    if ([metadataPublicId isKindOfClass:NSString.class] && [metadataPublicId length] > 0) {
      return metadataPublicId;
    }

    NSDictionary *notification = request.content.userInfo[kNotifeeUserInfoNotification];
    if ([notification isKindOfClass:NSDictionary.class]) {
      NSString *payloadPublicId = notification[@"id"];
      if ([payloadPublicId isKindOfClass:NSString.class] && [payloadPublicId length] > 0) {
        return payloadPublicId;
      }
    }
  }

  return nil;
}

+ (NSString *)publicIdentifierForRequest:(UNNotificationRequest *)request {
  NSString *rollingPublicId = [self rollingPublicIdForRequest:request];
  if (rollingPublicId != nil) {
    return rollingPublicId;
  }

  NSString *identifier = request.identifier;
  if ([self isPotentialRollingInternalNotificationId:identifier]) {
    return nil;
  }

  return identifier;
}

+ (void)addString:(NSString *)string toOrderedSet:(NSMutableOrderedSet<NSString *> *)orderedSet {
  if ([string isKindOfClass:NSString.class] && [string length] > 0) {
    [orderedSet addObject:string];
  }
}

+ (NSMutableOrderedSet<NSString *> *)rollingIdentifiersForPublicId:(NSString *)publicId
                                                    pendingRequests:
                                                        (NSArray<UNNotificationRequest *> *)
                                                            pendingRequests
                                                            record:(NSDictionary *)record {
  NSMutableOrderedSet<NSString *> *identifiers = [NSMutableOrderedSet orderedSet];

  NSArray *scheduledIds = record[@"scheduledIds"];
  if ([scheduledIds isKindOfClass:NSArray.class]) {
    for (id scheduledId in scheduledIds) {
      [self addString:scheduledId toOrderedSet:identifiers];
    }
  }

  for (UNNotificationRequest *request in pendingRequests) {
    NSString *identifier = request.identifier;
    if ([identifier isEqualToString:publicId]) {
      [self addString:identifier toOrderedSet:identifiers];
      continue;
    }

    NSString *mappedPublicId =
        [NotifeeCoreUtil rollingPublicIdFromInternalNotificationId:identifier];
    if ([mappedPublicId isEqualToString:publicId]) {
      [self addString:identifier toOrderedSet:identifiers];
    }
  }

  return identifiers;
}

+ (NSMutableOrderedSet<NSString *> *)rollingDeliveredIdentifiersForPublicId:
                                      (NSString *)publicId
                                                   deliveredNotifications:
                                                       (NSArray<UNNotification *> *)
                                                           deliveredNotifications
                                                                 record:(NSDictionary *)record {
  NSMutableOrderedSet<NSString *> *identifiers = [NSMutableOrderedSet orderedSet];

  NSArray *scheduledIds = record[@"scheduledIds"];
  if ([scheduledIds isKindOfClass:NSArray.class]) {
    for (id scheduledId in scheduledIds) {
      [self addString:scheduledId toOrderedSet:identifiers];
    }
  }

  for (UNNotification *notification in deliveredNotifications) {
    UNNotificationRequest *request = notification.request;
    NSString *identifier = request.identifier;
    if ([identifier isEqualToString:publicId]) {
      [self addString:identifier toOrderedSet:identifiers];
      continue;
    }

    NSString *mappedPublicId = [self rollingPublicIdForRequest:request];
    if ([mappedPublicId isEqualToString:publicId]) {
      [self addString:identifier toOrderedSet:identifiers];
    }
  }

  return identifiers;
}

+ (NSUInteger)pendingRequestCountForIdentifiers:(NSOrderedSet<NSString *> *)identifiers
                                pendingRequests:
                                    (NSArray<UNNotificationRequest *> *)pendingRequests {
  NSUInteger count = 0;
  for (UNNotificationRequest *request in pendingRequests) {
    if ([identifiers containsObject:request.identifier]) {
      count += 1;
    }
  }
  return count;
}

+ (UNCalendarNotificationTrigger *)rollingOneShotTriggerForOccurrenceMs:
    (NSNumber *)occurrenceMs {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([occurrenceMs doubleValue] / 1000.0)];
  NSDateComponents *components =
      [[NSCalendar currentCalendar] components:NSCalendarUnitYear | NSCalendarUnitMonth |
                                   NSCalendarUnitDay | NSCalendarUnitHour |
                                   NSCalendarUnitMinute | NSCalendarUnitSecond
                                      fromDate:date];

  return [UNCalendarNotificationTrigger triggerWithDateMatchingComponents:components repeats:NO];
}

+ (UNMutableNotificationContent *)rollingContentFromContent:(UNMutableNotificationContent *)content
                                                   publicId:(NSString *)publicId
                                               occurrenceMs:(NSNumber *)occurrenceMs
                                                 internalId:(NSString *)internalId {
  UNMutableNotificationContent *rollingContent = [content mutableCopy];
  NSMutableDictionary *userInfo = [rollingContent.userInfo mutableCopy];
  userInfo[kNotifeeRollingPublicId] = publicId;
  userInfo[kNotifeeRollingOccurrenceMs] = occurrenceMs;
  userInfo[kNotifeeRollingInternalId] = internalId;
  rollingContent.userInfo = userInfo;

  return rollingContent;
}

+ (void)removeRollingPendingRequestsForIds:(NSArray<NSString *> *)identifiers
                                    center:(UNUserNotificationCenter *)center {
  if ([identifiers count] > 0) {
    [center removePendingNotificationRequestsWithIdentifiers:identifiers];
  }
}

+ (void)createRollingTriggerNotification:(NSDictionary *)notification
                             withTrigger:(NSDictionary *)trigger
                             withContent:(UNMutableNotificationContent *)content
                  withNotificationDetail:(NSDictionary *)notificationDetail
                                  center:(UNUserNotificationCenter *)center
                                   block:(notifeeMethodVoidBlock)block {
  dispatch_async([self rollingTimestampQueue], ^{
    NSString *publicId = [self rollingPublicIdForNotification:notification];
    if (publicId == nil) {
      NSError *error = [self
          rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                message:@"NotifeeCore: Rolling timestamp trigger requires a "
                                        @"notification id."];
      [self resolveBlock:block withError:error];
      return;
    }

    NSArray<UNNotificationRequest *> *pendingRequests = [self pendingNotificationRequests:center];
    NSMutableDictionary *records = [NotifeeCoreUtil getRollingTimestampTriggers];
    NSDictionary *existingRecord = records[publicId];
    NSMutableOrderedSet<NSString *> *replacementIdentifiers =
        [self rollingIdentifiersForPublicId:publicId
                            pendingRequests:pendingRequests
                                     record:existingRecord];
    NSUInteger replacingPendingCount =
        [self pendingRequestCountForIdentifiers:replacementIdentifiers
                                pendingRequests:pendingRequests];
    NSInteger pendingAfterReplacement =
        (NSInteger)[pendingRequests count] - (NSInteger)replacingPendingCount;
    NSInteger availableBudget = [NotifeeCoreUtil rollingPendingBudget] - pendingAfterReplacement;

    if (availableBudget <= 0) {
      NSError *error = [self
          rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeBudgetExceeded
                                message:@"NotifeeCore: iOS rolling timestamp trigger pending "
                                        @"notification budget exhausted."];
      [self resolveBlock:block withError:error];
      return;
    }

    NSInteger maxCount = MIN([NotifeeCoreUtil rollingTargetPerTrigger], availableBudget);
    NSNumber *nowMs = [self currentTimestampMs];
    NSArray<NSNumber *> *occurrences =
        [NotifeeCoreUtil rollingTimestampOccurrencesFromTrigger:trigger
                                                          nowMs:nowMs
                                                       maxCount:maxCount];
    if ([occurrences count] == 0) {
      NSError *error = [self
          rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                message:@"NotifeeCore: Rolling timestamp trigger did not produce "
                                        @"any future occurrences."];
      [self resolveBlock:block withError:error];
      return;
    }

    NSMutableArray<UNNotificationRequest *> *requestsToAdd = [NSMutableArray array];
    NSMutableArray<NSString *> *scheduledIds = [NSMutableArray array];
    for (NSNumber *occurrenceMs in occurrences) {
      NSString *internalId = [NotifeeCoreUtil rollingInternalNotificationIdForPublicId:publicId
                                                                          occurrenceMs:occurrenceMs];
      if (internalId == nil) {
        NSError *error = [self
            rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                  message:@"NotifeeCore: Failed to create rolling timestamp "
                                          @"notification identifier."];
        [self resolveBlock:block withError:error];
        return;
      }

      UNMutableNotificationContent *rollingContent = [self rollingContentFromContent:content
                                                                            publicId:publicId
                                                                        occurrenceMs:occurrenceMs
                                                                          internalId:internalId];
      UNNotificationRequest *request = [UNNotificationRequest
          requestWithIdentifier:internalId
                        content:rollingContent
                        trigger:[self rollingOneShotTriggerForOccurrenceMs:occurrenceMs]];
      [requestsToAdd addObject:request];
      [scheduledIds addObject:internalId];
    }

    NSMutableOrderedSet<NSString *> *identifiersToRemove =
        [NSMutableOrderedSet orderedSetWithOrderedSet:replacementIdentifiers];
    [self addString:publicId toOrderedSet:identifiersToRemove];
    for (NSString *scheduledId in scheduledIds) {
      [identifiersToRemove removeObject:scheduledId];
    }

    [NotifeeCoreUtil removeRollingTimestampTriggerRecordForPublicId:publicId];
    [self removeRollingPendingRequestsForIds:[identifiersToRemove array] center:center];

    dispatch_group_t group = dispatch_group_create();
    NSObject *scheduleLock = [[NSObject alloc] init];
    __block NSError *scheduleError = nil;

    for (UNNotificationRequest *request in requestsToAdd) {
      dispatch_group_enter(group);
    }

    dispatch_async(dispatch_get_main_queue(), ^{
      for (UNNotificationRequest *request in requestsToAdd) {
        [center addNotificationRequest:request
                 withCompletionHandler:^(NSError *_Nullable error) {
                   if (error != nil) {
                     @synchronized(scheduleLock) {
                       if (scheduleError == nil) {
                         scheduleError = error;
                       }
                     }
                   }
                   dispatch_group_leave(group);
                 }];
      }
    });

    dispatch_group_wait(group, DISPATCH_TIME_FOREVER);

    if (scheduleError != nil) {
      [self removeRollingPendingRequestsForIds:scheduledIds center:center];
      [self resolveBlock:block withError:scheduleError];
      return;
    }

    NSDictionary *record = @{
      @"publicId" : publicId,
      @"notification" : notification,
      @"trigger" : trigger,
      @"lastScheduledOccurrenceMs" : [occurrences lastObject],
      @"scheduledIds" : scheduledIds,
      @"createdAtMs" : nowMs
    };
    [NotifeeCoreUtil upsertRollingTimestampTriggerRecord:record publicId:publicId];

    NSDictionary *persistedRecords = [NotifeeCoreUtil getRollingTimestampTriggers];
    if (persistedRecords[publicId] == nil) {
      [self removeRollingPendingRequestsForIds:scheduledIds center:center];
      NSError *error = [self
          rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeStorageFailed
                                message:@"NotifeeCore: Failed to persist rolling timestamp "
                                        @"trigger record."];
      [self resolveBlock:block withError:error];
      return;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
      [[NotifeeCoreDelegateHolder instance] didReceiveNotifeeCoreEvent:@{
        @"type" : @(NotifeeCoreEventTypeTriggerNotificationCreated),
        @"detail" : @{
          @"notification" : notificationDetail,
        }
      }];
      block(nil);
    });
  });
}

+ (void)cancelRollingNotification:(NSString *)notificationId
             withNotificationType:(NSInteger)notificationType
                            block:(notifeeMethodVoidBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  BOOL cancelDisplayed = notificationType == NotifeeCoreNotificationTypeDisplayed ||
                         notificationType == NotifeeCoreNotificationTypeAll;
  BOOL cancelTrigger = notificationType == NotifeeCoreNotificationTypeTrigger ||
                       notificationType == NotifeeCoreNotificationTypeAll;

  if (!cancelDisplayed && !cancelTrigger) {
    block(nil);
    return;
  }

  dispatch_async([self rollingTimestampQueue], ^{
    NSDictionary *records = [NotifeeCoreUtil getRollingTimestampTriggers];
    NSDictionary *record = records[notificationId];

    if (cancelDisplayed) {
      NSArray<UNNotification *> *deliveredNotifications = [self deliveredNotifications:center];
      NSMutableOrderedSet<NSString *> *deliveredIdentifiersToRemove =
          [self rollingDeliveredIdentifiersForPublicId:notificationId
                               deliveredNotifications:deliveredNotifications
                                               record:record];
      [self addString:notificationId toOrderedSet:deliveredIdentifiersToRemove];
      if ([deliveredIdentifiersToRemove count] > 0) {
        [center removeDeliveredNotificationsWithIdentifiers:[deliveredIdentifiersToRemove array]];
      }
    }

    if (cancelTrigger) {
      NSArray<UNNotificationRequest *> *pendingRequests = [self pendingNotificationRequests:center];
      NSMutableOrderedSet<NSString *> *pendingIdentifiersToRemove =
          [self rollingIdentifiersForPublicId:notificationId
                              pendingRequests:pendingRequests
                                       record:record];
      [self addString:notificationId toOrderedSet:pendingIdentifiersToRemove];

      [self removeRollingPendingRequestsForIds:[pendingIdentifiersToRemove array] center:center];
      if (record != nil) {
        [NotifeeCoreUtil removeRollingTimestampTriggerRecordForPublicId:notificationId];
      }
    }

    [self resolveBlock:block withError:nil];
  });
}

+ (void)cancelRollingNotificationsWithIds:(NSArray<NSString *> *)ids
                     withNotificationType:(NSInteger)notificationType
                                    block:(notifeeMethodVoidBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  BOOL cancelDisplayed = notificationType == NotifeeCoreNotificationTypeDisplayed ||
                         notificationType == NotifeeCoreNotificationTypeAll;
  BOOL cancelTrigger = notificationType == NotifeeCoreNotificationTypeTrigger ||
                       notificationType == NotifeeCoreNotificationTypeAll;

  NSMutableOrderedSet<NSString *> *publicIds = [NSMutableOrderedSet orderedSet];
  for (id notificationId in ids) {
    [self addString:notificationId toOrderedSet:publicIds];
  }

  if (!cancelDisplayed && !cancelTrigger) {
    block(nil);
    return;
  }

  dispatch_async([self rollingTimestampQueue], ^{
    NSDictionary *records = [NotifeeCoreUtil getRollingTimestampTriggers];
    NSArray<UNNotification *> *deliveredNotifications =
        cancelDisplayed ? [self deliveredNotifications:center] : @[];
    NSArray<UNNotificationRequest *> *pendingRequests =
        cancelTrigger ? [self pendingNotificationRequests:center] : @[];
    NSMutableOrderedSet<NSString *> *deliveredIdentifiersToRemove =
        [NSMutableOrderedSet orderedSet];
    NSMutableOrderedSet<NSString *> *pendingIdentifiersToRemove =
        [NSMutableOrderedSet orderedSet];

    for (NSString *publicId in publicIds) {
      NSDictionary *record = records[publicId];

      if (cancelDisplayed) {
        NSMutableOrderedSet<NSString *> *rollingDeliveredIdentifiers =
            [self rollingDeliveredIdentifiersForPublicId:publicId
                                 deliveredNotifications:deliveredNotifications
                                                 record:record];
        [deliveredIdentifiersToRemove unionOrderedSet:rollingDeliveredIdentifiers];
        [self addString:publicId toOrderedSet:deliveredIdentifiersToRemove];
      }

      if (cancelTrigger) {
        NSMutableOrderedSet<NSString *> *rollingPendingIdentifiers =
            [self rollingIdentifiersForPublicId:publicId
                                pendingRequests:pendingRequests
                                         record:record];
        [pendingIdentifiersToRemove unionOrderedSet:rollingPendingIdentifiers];
        [self addString:publicId toOrderedSet:pendingIdentifiersToRemove];
        if (record != nil) {
          [NotifeeCoreUtil removeRollingTimestampTriggerRecordForPublicId:publicId];
        }
      }
    }

    if ([deliveredIdentifiersToRemove count] > 0) {
      [center removeDeliveredNotificationsWithIdentifiers:[deliveredIdentifiersToRemove array]];
    }
    [self removeRollingPendingRequestsForIds:[pendingIdentifiersToRemove array] center:center];
    [self resolveBlock:block withError:nil];
  });
}

#pragma mark - Library Methods

+ (void)setCoreDelegate:(id<NotifeeCoreDelegate>)coreDelegate {
  [NotifeeCoreDelegateHolder instance].delegate = coreDelegate;
}

/**
 * Cancel a currently displayed or pending trigger notification.
 *
 * @param notificationId NSString id of the notification to cancel
 * @param block notifeeMethodVoidBlock
 */
+ (void)cancelNotification:(NSString *)notificationId
      withNotificationType:(NSInteger)notificationType
                 withBlock:(notifeeMethodVoidBlock)block {
  [self cancelRollingNotification:notificationId
             withNotificationType:notificationType
                            block:block];
}

/**
 * Cancel all currently displayed or pending trigger notifications.
 *
 * @param notificationType NSInteger
 * @param block notifeeMethodVoidBlock
 */
+ (void)cancelAllNotifications:(NSInteger)notificationType withBlock:(notifeeMethodVoidBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

  // cancel displayed notifications
  if (notificationType == NotifeeCoreNotificationTypeDisplayed ||
      notificationType == NotifeeCoreNotificationTypeAll)
    [center removeAllDeliveredNotifications];

  if (notificationType != NotifeeCoreNotificationTypeTrigger &&
      notificationType != NotifeeCoreNotificationTypeAll) {
    block(nil);
    return;
  }

  dispatch_async([self rollingTimestampQueue], ^{
    [center removeAllPendingNotificationRequests];
    [NotifeeCoreUtil clearRollingTimestampTriggerRecords];
    [self resolveBlock:block withError:nil];
  });
}

/**
 * Cancel currently displayed or pending trigger notifications by ids.
 *
 * @param notificationType NSInteger
 * @param ids NSInteger
 * @param block notifeeMethodVoidBlock
 */
+ (void)cancelAllNotificationsWithIds:(NSInteger)notificationType
                              withIds:(NSArray<NSString *> *)ids
                            withBlock:(notifeeMethodVoidBlock)block {
  [self cancelRollingNotificationsWithIds:ids withNotificationType:notificationType block:block];
}

+ (void)getDisplayedNotifications:(notifeeMethodNSArrayBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  NSMutableArray *triggerNotifications = [[NSMutableArray alloc] init];
  [center getDeliveredNotificationsWithCompletionHandler:^(
              NSArray<UNNotification *> *_Nonnull deliveredNotifications) {
    for (UNNotification *deliveredNotification in deliveredNotifications) {
      UNNotificationRequest *request = deliveredNotification.request;
      NSString *notificationId = [self publicIdentifierForRequest:request];
      if (notificationId == nil) {
        continue;
      }

      NSMutableDictionary *triggerNotification = [NSMutableDictionary dictionary];
      triggerNotification[@"id"] = notificationId;

      triggerNotification[@"date"] =
          [NotifeeCoreUtil convertToTimestamp:deliveredNotification.date];
      triggerNotification[@"notification"] =
          request.content.userInfo[kNotifeeUserInfoNotification];
      triggerNotification[@"trigger"] =
          request.content.userInfo[kNotifeeUserInfoTrigger];

      if (triggerNotification[@"notification"] == nil) {
        // parse remote notification
        triggerNotification[@"notification"] = [NotifeeCoreUtil parseUNNotificationRequest:request];
      }

      NSString *rollingPublicId = [self rollingPublicIdForRequest:request];
      NSDictionary *notification = triggerNotification[@"notification"];
      if (rollingPublicId != nil && [notification isKindOfClass:NSDictionary.class]) {
        NSMutableDictionary *publicNotification = [notification mutableCopy];
        publicNotification[@"id"] = rollingPublicId;
        triggerNotification[@"notification"] = publicNotification;
      }

      [triggerNotifications addObject:triggerNotification];
    }
    block(nil, triggerNotifications);
  }];
}

+ (void)getTriggerNotifications:(notifeeMethodNSArrayBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

  [center getPendingNotificationRequestsWithCompletionHandler:^(
              NSArray<UNNotificationRequest *> *_Nonnull requests) {
    NSDictionary *rollingRecords = [NotifeeCoreUtil getRollingTimestampTriggers];
    NSMutableSet<NSString *> *rollingPublicIds = [NSMutableSet set];
    NSMutableArray *triggerNotifications = [[NSMutableArray alloc] init];

    for (id publicId in rollingRecords) {
      if (![publicId isKindOfClass:NSString.class]) {
        continue;
      }

      NSDictionary *record = rollingRecords[publicId];
      NSDictionary *notification = record[@"notification"];
      NSDictionary *trigger = record[@"trigger"];
      if (![notification isKindOfClass:NSDictionary.class] ||
          ![trigger isKindOfClass:NSDictionary.class]) {
        continue;
      }

      NSMutableDictionary *triggerNotification = [NSMutableDictionary dictionary];
      triggerNotification[@"notification"] = notification;
      triggerNotification[@"trigger"] = trigger;
      [triggerNotifications addObject:triggerNotification];
      [rollingPublicIds addObject:publicId];
    }

    for (UNNotificationRequest *request in requests) {
      NSString *rollingPublicId =
          [NotifeeCoreUtil rollingPublicIdFromInternalNotificationId:request.identifier];
      if (rollingPublicId != nil) {
        continue;
      }

      if ([rollingPublicIds containsObject:request.identifier]) {
        continue;
      }

      NSMutableDictionary *triggerNotification = [NSMutableDictionary dictionary];

      triggerNotification[@"notification"] = request.content.userInfo[kNotifeeUserInfoNotification];
      triggerNotification[@"trigger"] = request.content.userInfo[kNotifeeUserInfoTrigger];

      [triggerNotifications addObject:triggerNotification];
    }

    block(nil, triggerNotifications);
  }];
}

/**
 * Retrieve a NSArray of pending UNNotificationRequest for the application.
 * Resolves a NSArray of UNNotificationRequest identifiers.
 *
 * @param block notifeeMethodNSArrayBlock
 */
+ (void)getTriggerNotificationIds:(notifeeMethodNSArrayBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getPendingNotificationRequestsWithCompletionHandler:^(
              NSArray<UNNotificationRequest *> *_Nonnull requests) {
    NSMutableOrderedSet<NSString *> *ids = [NSMutableOrderedSet orderedSet];

    for (UNNotificationRequest *request in requests) {
      NSString *notificationId = request.identifier;
      NSString *rollingPublicId =
          [NotifeeCoreUtil rollingPublicIdFromInternalNotificationId:notificationId];
      [self addString:(rollingPublicId != nil ? rollingPublicId : notificationId)
          toOrderedSet:ids];
    }

    NSDictionary *rollingRecords = [NotifeeCoreUtil getRollingTimestampTriggers];
    for (id publicId in rollingRecords) {
      [self addString:publicId toOrderedSet:ids];
    }

    block(nil, [ids array]);
  }];
}

/**
 * Display a local notification immediately.
 *
 * @param notification NSDictionary representation of
 * UNMutableNotificationContent
 * @param block notifeeMethodVoidBlock
 */
+ (void)displayNotification:(NSDictionary *)notification withBlock:(notifeeMethodVoidBlock)block {
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    UNMutableNotificationContent *content = [self buildNotificationContent:notification
                                                               withTrigger:nil];

    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

    NSMutableDictionary *notificationDetail = [notification mutableCopy];
    notificationDetail[@"remote"] = @NO;

    if (@available(iOS 15.0, *)) {
      if (notification[@"ios"][@"communicationInfo"] != nil) {
        INSendMessageIntent *intent = [NotifeeCoreUtil
            generateSenderIntentForCommunicationNotification:notification[@"ios"]
                                                                         [@"communicationInfo"]];

        // Use the intent to initialize the interaction.
        INInteraction *interaction = [[INInteraction alloc] initWithIntent:intent response:nil];
        interaction.direction = INInteractionDirectionIncoming;
        [interaction donateInteractionWithCompletion:^(NSError *donateError) {
          if (donateError)
            NSLog(@"NotifeeCore: Could not donate interaction for communication notification: %@",
                  donateError);
        }];

        NSError *contentUpdateError = nil;
        UNNotificationContent *updatedContent =
            [content contentByUpdatingWithProvider:intent error:&contentUpdateError];
        if (contentUpdateError) {
          NSLog(@"NotifeeCore: Could not update notification content with communication intent: %@",
                contentUpdateError);
        } else if (updatedContent != nil) {
          content = [updatedContent mutableCopy];
        }
      }
    }

    UNNotificationRequest *request =
        [UNNotificationRequest requestWithIdentifier:notification[@"id"]
                                             content:content
                                             trigger:nil];

    dispatch_async(dispatch_get_main_queue(), ^{
      [center
          addNotificationRequest:request
           withCompletionHandler:^(NSError *error) {
             if (error == nil) {
               // When the app is in foreground, willPresentNotification: emits
               // DELIVERED for all Notifee-owned notifications. Only emit here
               // when the app is NOT active to avoid duplicate events.
               dispatch_async(dispatch_get_main_queue(), ^{
                 if (UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
                   [[NotifeeCoreDelegateHolder instance] didReceiveNotifeeCoreEvent:@{
                     @"type" : @(NotifeeCoreEventTypeDelivered),
                     @"detail" : @{
                       @"notification" : notificationDetail,
                     }
                   }];
                 }
               });
             }
             block(error);
           }];
    });
  });
}

/* Create a trigger notification .
 *
 * @param notification NSDictionary representation of
 * UNMutableNotificationContent
 * @param block notifeeMethodVoidBlock
 */
+ (void)createTriggerNotification:(NSDictionary *)notification
                      withTrigger:(NSDictionary *)trigger
                        withBlock:(notifeeMethodVoidBlock)block {
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    UNMutableNotificationContent *content = [self buildNotificationContent:notification
                                                               withTrigger:trigger];
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

    NSMutableDictionary *notificationDetail = [notification mutableCopy];
    notificationDetail[@"remote"] = @NO;

    if (@available(iOS 15.0, *)) {
      if (notification[@"ios"][@"communicationInfo"] != nil) {
        INSendMessageIntent *intent = [NotifeeCoreUtil
            generateSenderIntentForCommunicationNotification:notification[@"ios"]
                                                                         [@"communicationInfo"]];

        // Use the intent to initialize the interaction.
        INInteraction *interaction = [[INInteraction alloc] initWithIntent:intent response:nil];
        interaction.direction = INInteractionDirectionIncoming;
        [interaction donateInteractionWithCompletion:^(NSError *donateError) {
          if (donateError)
            NSLog(@"NotifeeCore: Could not donate interaction for communication notification: %@",
                  donateError);
        }];

        NSError *contentUpdateError = nil;
        UNNotificationContent *updatedContent =
            [content contentByUpdatingWithProvider:intent error:&contentUpdateError];
        if (contentUpdateError) {
          NSLog(@"NotifeeCore: Could not update notification content with communication intent: %@",
                contentUpdateError);
        } else if (updatedContent != nil) {
          content = [updatedContent mutableCopy];
        }
      }
    }

    if ([NotifeeCoreUtil isRollingTimestampTrigger:trigger]) {
      [self createRollingTriggerNotification:notification
                                 withTrigger:trigger
                                 withContent:content
                      withNotificationDetail:notificationDetail
                                      center:center
                                       block:block];
      return;
    }

    UNNotificationTrigger *unTrigger = [NotifeeCoreUtil triggerFromDictionary:trigger];

    if (unTrigger == nil) {
      // do nothing if trigger is null
      return dispatch_async(dispatch_get_main_queue(), ^{
        block(nil);
      });
    }

    UNNotificationRequest *request =
        [UNNotificationRequest requestWithIdentifier:notification[@"id"]
                                             content:content
                                             trigger:unTrigger];

    dispatch_async(dispatch_get_main_queue(), ^{
      [center addNotificationRequest:request
               withCompletionHandler:^(NSError *error) {
                 if (error == nil) {
                   [[NotifeeCoreDelegateHolder instance] didReceiveNotifeeCoreEvent:@{
                     @"type" : @(NotifeeCoreEventTypeTriggerNotificationCreated),
                     @"detail" : @{
                       @"notification" : notificationDetail,
                     }
                   }];
                 }
                 block(error);
               }];
    });
  });
}

/**
 * Builds a UNMutableNotificationContent from a NSDictionary.
 *
 * @param notification NSDictionary representation of UNNotificationContent
 */

+ (UNMutableNotificationContent *)buildNotificationContent:(NSDictionary *)notification
                                               withTrigger:(NSDictionary *)trigger {
  NSDictionary *iosDict = notification[@"ios"];
  UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];

  // title
  if (notification[@"title"] != nil) {
    content.title = notification[@"title"];
  }

  // subtitle
  if (notification[@"subtitle"] != nil) {
    content.subtitle = notification[@"subtitle"];
  }

  // body
  if (notification[@"body"] != nil) {
    content.body = notification[@"body"];
  }

  NSMutableDictionary *userInfo = [[NSMutableDictionary alloc] init];

  // data
  if (notification[@"data"] != nil) {
    userInfo = [notification[@"data"] mutableCopy];
  }

  // attach a copy of the original notification payload into the data object,
  // for internal use
  userInfo[kNotifeeUserInfoNotification] = [notification mutableCopy];
  if (trigger != nil) {
    userInfo[kNotifeeUserInfoTrigger] = [trigger mutableCopy];
  }

  content.userInfo = userInfo;

  // badgeCount - nil is an acceptable value so no need to check key existence
  content.badge = iosDict[@"badgeCount"];

  // categoryId
  if (iosDict[@"categoryId"] != nil && iosDict[@"categoryId"] != [NSNull null]) {
    content.categoryIdentifier = iosDict[@"categoryId"];
  }

  // launchImageName
  if (iosDict[@"launchImageName"] != nil && iosDict[@"launchImageName"] != [NSNull null]) {
    content.launchImageName = iosDict[@"launchImageName"];
  }

  // interruptionLevel
  if (@available(iOS 15.0, *)) {
    if (iosDict[@"interruptionLevel"] != nil) {
      if ([iosDict[@"interruptionLevel"] isEqualToString:@"passive"]) {
        content.interruptionLevel = UNNotificationInterruptionLevelPassive;
      } else if ([iosDict[@"interruptionLevel"] isEqualToString:@"active"]) {
        content.interruptionLevel = UNNotificationInterruptionLevelActive;
      } else if ([iosDict[@"interruptionLevel"] isEqualToString:@"timeSensitive"]) {
        content.interruptionLevel = UNNotificationInterruptionLevelTimeSensitive;
      } else if ([iosDict[@"interruptionLevel"] isEqualToString:@"critical"]) {
        content.interruptionLevel = UNNotificationInterruptionLevelCritical;
      }
    }
  }

  // critical, criticalVolume, sound
  if (iosDict[@"critical"] != nil && iosDict[@"critical"] != [NSNull null]) {
    UNNotificationSound *notificationSound;
    BOOL criticalSound = [iosDict[@"critical"] boolValue];
    NSNumber *criticalSoundVolume = iosDict[@"criticalVolume"];
    NSString *soundName = iosDict[@"sound"] != nil ? iosDict[@"sound"] : @"default";

    if ([soundName isEqualToString:@"default"]) {
      if (criticalSound) {
        if (@available(iOS 12.0, *)) {
          if (criticalSoundVolume != nil) {
            notificationSound = [UNNotificationSound
                defaultCriticalSoundWithAudioVolume:[criticalSoundVolume floatValue]];
          } else {
            notificationSound = [UNNotificationSound defaultCriticalSound];
          }
        } else {
          notificationSound = [UNNotificationSound defaultSound];
        }
      } else {
        notificationSound = [UNNotificationSound defaultSound];
      }
    } else {
      if (criticalSound) {
        if (@available(iOS 12.0, *)) {
          if (criticalSoundVolume != nil) {
            notificationSound =
                [UNNotificationSound criticalSoundNamed:soundName
                                        withAudioVolume:[criticalSoundVolume floatValue]];
          } else {
            notificationSound = [UNNotificationSound criticalSoundNamed:soundName];
          }
        } else {
          notificationSound = [UNNotificationSound soundNamed:soundName];
        }
      } else {
        notificationSound = [UNNotificationSound soundNamed:soundName];
      }
    }
    content.sound = notificationSound;
  } else if (iosDict[@"sound"] != nil) {
    UNNotificationSound *notificationSound;
    NSString *soundName = iosDict[@"sound"];

    if ([soundName isEqualToString:@"default"]) {
      notificationSound = [UNNotificationSound defaultSound];
    } else {
      notificationSound = [UNNotificationSound soundNamed:soundName];
    }

    content.sound = notificationSound;

  }  // critical, criticalVolume, sound

  // threadId
  if (iosDict[@"threadId"] != nil) {
    content.threadIdentifier = iosDict[@"threadId"];
  }

  if (@available(iOS 12.0, *)) {
    // summaryArgument
    if (iosDict[@"summaryArgument"] != nil) {
      content.summaryArgument = iosDict[@"summaryArgument"];
    }

    // summaryArgumentCount
    if (iosDict[@"summaryArgumentCount"] != nil) {
      content.summaryArgumentCount = [iosDict[@"summaryArgumentCount"] unsignedIntValue];
    }
  }

  if (@available(iOS 13.0, *)) {
    // targetContentId
    if (iosDict[@"targetContentId"] != nil) {
      content.targetContentIdentifier = iosDict[@"targetContentId"];
    }
  }

  // Ignore downloading attachments here if remote notifications via NSE
  BOOL remote = [notification[@"remote"] boolValue];

  if (iosDict[@"attachments"] != nil && !remote) {
    content.attachments =
        [NotifeeCoreUtil notificationAttachmentsFromDictionaryArray:iosDict[@"attachments"]];
  }

  return content;
}

+ (void)getNotificationCategories:(notifeeMethodNSArrayBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getNotificationCategoriesWithCompletionHandler:^(
              NSSet<UNNotificationCategory *> *categories) {
    NSMutableArray<NSDictionary *> *categoriesArray = [[NSMutableArray alloc] init];

    for (UNNotificationCategory *notificationCategory in categories) {
      NSMutableDictionary *categoryDictionary = [NSMutableDictionary dictionary];

      categoryDictionary[@"id"] = notificationCategory.identifier;
      categoryDictionary[@"allowInCarPlay"] =
          @(((notificationCategory.options & UNNotificationCategoryOptionAllowInCarPlay) != 0));

      if (@available(iOS 11.0, *)) {
        categoryDictionary[@"hiddenPreviewsShowTitle"] =
            @(((notificationCategory.options &
                UNNotificationCategoryOptionHiddenPreviewsShowTitle) != 0));
        categoryDictionary[@"hiddenPreviewsShowSubtitle"] =
            @(((notificationCategory.options &
                UNNotificationCategoryOptionHiddenPreviewsShowSubtitle) != 0));
        if (notificationCategory.hiddenPreviewsBodyPlaceholder != nil) {
          categoryDictionary[@"hiddenPreviewsBodyPlaceholder"] =
              notificationCategory.hiddenPreviewsBodyPlaceholder;
        }
      } else {
        categoryDictionary[@"hiddenPreviewsShowTitle"] = @(NO);
        categoryDictionary[@"hiddenPreviewsShowSubtitle"] = @(NO);
      }

      if (@available(iOS 12.0, *)) {
        if (notificationCategory.categorySummaryFormat != nil) {
          categoryDictionary[@"summaryFormat"] = notificationCategory.categorySummaryFormat;
        }
      }

      if (@available(iOS 13.0, *)) {
        categoryDictionary[@"allowAnnouncement"] = @(
            ((notificationCategory.options & UNNotificationCategoryOptionAllowAnnouncement) != 0));
      } else {
        categoryDictionary[@"allowAnnouncement"] = @(NO);
      }

      categoryDictionary[@"actions"] =
          [NotifeeCoreUtil notificationActionsToDictionaryArray:notificationCategory.actions];
      categoryDictionary[@"intentIdentifiers"] =
          [NotifeeCoreUtil intentIdentifiersFromStringArray:notificationCategory.intentIdentifiers];

      [categoriesArray addObject:categoryDictionary];
    }

    block(nil, categoriesArray);
  }];
}

/**
 * Builds and replaces the existing notification categories on
 * UNUserNotificationCenter
 *
 * @param categories NSArray<NSDictionary *> *
 * @param block notifeeMethodVoidBlock
 */
+ (void)setNotificationCategories:(NSArray<NSDictionary *> *)categories
                        withBlock:(notifeeMethodVoidBlock)block {
  NSMutableSet *UNNotificationCategories = [[NSMutableSet alloc] init];

  for (NSDictionary *categoryDictionary in categories) {
    UNNotificationCategory *category;

    NSString *id = categoryDictionary[@"id"];
    NSString *summaryFormat = categoryDictionary[@"summaryFormat"];
    NSString *bodyPlaceHolder = categoryDictionary[@"hiddenPreviewsBodyPlaceholder"];

    NSArray<UNNotificationAction *> *actions =
        [NotifeeCoreUtil notificationActionsFromDictionaryArray:categoryDictionary[@"actions"]];
    NSArray<NSString *> *intentIdentifiers =
        [NotifeeCoreUtil intentIdentifiersFromNumberArray:categoryDictionary[@"intentIdentifiers"]];

    UNNotificationCategoryOptions options = UNNotificationCategoryOptionCustomDismissAction;

    if ([categoryDictionary[@"allowInCarPlay"] isEqual:@(YES)]) {
      options |= UNNotificationCategoryOptionAllowInCarPlay;
    }

    if (@available(iOS 11.0, *)) {
      if ([categoryDictionary[@"hiddenPreviewsShowTitle"] isEqual:@(YES)]) {
        options |= UNNotificationCategoryOptionHiddenPreviewsShowTitle;
      }

      if ([categoryDictionary[@"hiddenPreviewsShowSubtitle"] isEqual:@(YES)]) {
        options |= UNNotificationCategoryOptionHiddenPreviewsShowSubtitle;
      }
    }

    if (@available(iOS 13.0, *)) {
      if ([categoryDictionary[@"allowAnnouncement"] isEqual:@(YES)]) {
        options |= UNNotificationCategoryOptionAllowAnnouncement;
      }
    }

    if (@available(iOS 12.0, *)) {
      category = [UNNotificationCategory categoryWithIdentifier:id
                                                        actions:actions
                                              intentIdentifiers:intentIdentifiers
                                  hiddenPreviewsBodyPlaceholder:bodyPlaceHolder
                                          categorySummaryFormat:summaryFormat
                                                        options:options];
    } else if (@available(iOS 11.0, *)) {
      category = [UNNotificationCategory categoryWithIdentifier:id
                                                        actions:actions
                                              intentIdentifiers:intentIdentifiers
                                  hiddenPreviewsBodyPlaceholder:bodyPlaceHolder
                                                        options:options];
    } else {
      category = [UNNotificationCategory categoryWithIdentifier:id
                                                        actions:actions
                                              intentIdentifiers:intentIdentifiers
                                                        options:options];
    }

    [UNNotificationCategories addObject:category];
  }

  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center setNotificationCategories:UNNotificationCategories];
  block(nil);
}

/**
 * Request UNAuthorizationOptions for user notifications.
 * Resolves a NSDictionary representation of UNNotificationSettings.
 *
 * @param permissions NSDictionary
 * @param block NSDictionary block
 */
+ (void)requestPermission:(NSDictionary *)permissions
                withBlock:(notifeeMethodNSDictionaryBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

  UNAuthorizationOptions options = UNAuthorizationOptionNone;

  if ([permissions[@"alert"] isEqual:@(YES)]) {
    options |= UNAuthorizationOptionAlert;
  }

  if ([permissions[@"badge"] isEqual:@(YES)]) {
    options |= UNAuthorizationOptionBadge;
  }

  if ([permissions[@"sound"] isEqual:@(YES)]) {
    options |= UNAuthorizationOptionSound;
  }

  if ([permissions[@"inAppNotificationSettings"] isEqual:@(YES)]) {
    if (@available(iOS 12.0, *)) {
      options |= UNAuthorizationOptionProvidesAppNotificationSettings;
    }
  }

  if ([permissions[@"provisional"] isEqual:@(YES)]) {
    if (@available(iOS 12.0, *)) {
      options |= UNAuthorizationOptionProvisional;
    }
  }

  if ([permissions[@"announcement"] isEqual:@(YES)]) {
    if (@available(iOS 13.0, *)) {
      options |= UNAuthorizationOptionAnnouncement;
    }
  }

  if ([permissions[@"carPlay"] isEqual:@(YES)]) {
    options |= UNAuthorizationOptionCarPlay;
  }

  if ([permissions[@"criticalAlert"] isEqual:@(YES)]) {
    if (@available(iOS 12.0, *)) {
      options |= UNAuthorizationOptionCriticalAlert;
    }
  }

  id handler = ^(BOOL granted, NSError *_Nullable error) {
    if (error != nil) {
      block(error, nil);
      return;
    }

    [self getNotificationSettings:block];
  };

  [center requestAuthorizationWithOptions:options completionHandler:handler];
}

/**
 * Retrieve UNNotificationSettings for the application.
 * Resolves a NSDictionary representation of UNNotificationSettings.
 *
 * @param block NSDictionary block
 */
+ (void)getNotificationSettings:(notifeeMethodNSDictionaryBlock)block {
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

  [center
      getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *_Nonnull settings) {
        NSMutableDictionary *settingsDictionary = [NSMutableDictionary dictionary];
        NSMutableDictionary *iosDictionary = [NSMutableDictionary dictionary];

        // authorizationStatus
        NSNumber *authorizationStatus = @-1;
        if (settings.authorizationStatus == UNAuthorizationStatusNotDetermined) {
          authorizationStatus = @-1;
        } else if (settings.authorizationStatus == UNAuthorizationStatusDenied) {
          authorizationStatus = @0;
        } else if (settings.authorizationStatus == UNAuthorizationStatusAuthorized) {
          authorizationStatus = @1;
        }

        if (@available(iOS 12.0, *)) {
          if (settings.authorizationStatus == UNAuthorizationStatusProvisional) {
            authorizationStatus = @2;
          }
        }

        NSNumber *showPreviews = @-1;
        if (@available(iOS 11.0, *)) {
          if (settings.showPreviewsSetting == UNShowPreviewsSettingNever) {
            showPreviews = @0;
          } else if (settings.showPreviewsSetting == UNShowPreviewsSettingAlways) {
            showPreviews = @1;
          } else if (settings.showPreviewsSetting == UNShowPreviewsSettingWhenAuthenticated) {
            showPreviews = @2;
          }
        }

        if (@available(iOS 13.0, *)) {
          iosDictionary[@"announcement"] =
              [NotifeeCoreUtil numberForUNNotificationSetting:settings.announcementSetting];
        } else {
          iosDictionary[@"announcement"] = @-1;
        }

        if (@available(iOS 12.0, *)) {
          iosDictionary[@"criticalAlert"] =
              [NotifeeCoreUtil numberForUNNotificationSetting:settings.criticalAlertSetting];
        } else {
          iosDictionary[@"criticalAlert"] = @-1;
        }

        if (@available(iOS 12.0, *)) {
          iosDictionary[@"inAppNotificationSettings"] =
              settings.providesAppNotificationSettings ? @1 : @0;
        } else {
          iosDictionary[@"inAppNotificationSettings"] = @-1;
        }

        iosDictionary[@"showPreviews"] = showPreviews;
        iosDictionary[@"authorizationStatus"] = authorizationStatus;
        iosDictionary[@"alert"] =
            [NotifeeCoreUtil numberForUNNotificationSetting:settings.alertSetting];
        iosDictionary[@"badge"] =
            [NotifeeCoreUtil numberForUNNotificationSetting:settings.badgeSetting];
        iosDictionary[@"sound"] =
            [NotifeeCoreUtil numberForUNNotificationSetting:settings.soundSetting];
        iosDictionary[@"carPlay"] =
            [NotifeeCoreUtil numberForUNNotificationSetting:settings.carPlaySetting];
        iosDictionary[@"lockScreen"] =
            [NotifeeCoreUtil numberForUNNotificationSetting:settings.lockScreenSetting];
        iosDictionary[@"notificationCenter"] =
            [NotifeeCoreUtil numberForUNNotificationSetting:settings.notificationCenterSetting];

        settingsDictionary[@"authorizationStatus"] = authorizationStatus;
        settingsDictionary[@"ios"] = iosDictionary;

        block(nil, settingsDictionary);
      }];
}

+ (void)getInitialNotification:(notifeeMethodNSDictionaryBlock)block {
  [NotifeeCoreUNUserNotificationCenter instance].initialNotificationBlock = block;
  [[NotifeeCoreUNUserNotificationCenter instance] getInitialNotification];
}

+ (void)setBadgeCount:(NSInteger)count withBlock:(notifeeMethodVoidBlock)block {
  if (![NotifeeCoreUtil isAppExtension]) {
    if (@available(iOS 16.0, macOS 10.13, macCatalyst 16.0, tvOS 16.0, visionOS 1.0, *)) {
      UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
      [center setBadgeCount:count
          withCompletionHandler:^(NSError *error) {
            if (error) {
              NSLog(@"NotifeeCore: Could not setBadgeCount: %@", error);
              block(error);
            } else {
              block(nil);
            }
          }];
      return;
    } else {
      // If count is 0, set to -1 instead to avoid notifications in tray being cleared
      // this breaks in iOS 18, but at that point we're using the new setBadge API
      NSInteger newCount = count == 0 ? -1 : count;
      UIApplication *application = (UIApplication *)[NotifeeCoreUtil notifeeUIApplication];
      [application setApplicationIconBadgeNumber:newCount];
    }
  }
  block(nil);
}

+ (void)getBadgeCount:(notifeeMethodNSIntegerBlock)block {
  if (![NotifeeCoreUtil isAppExtension]) {
    UIApplication *application = (UIApplication *)[NotifeeCoreUtil notifeeUIApplication];
    NSInteger badgeCount = application.applicationIconBadgeNumber;

    block(nil, badgeCount == -1 ? 0 : badgeCount);
    return;
  }
  block(nil, 0);
}

+ (void)incrementBadgeCount:(NSInteger)incrementBy withBlock:(notifeeMethodVoidBlock)block {
  if (![NotifeeCoreUtil isAppExtension]) {
    UIApplication *application = (UIApplication *)[NotifeeCoreUtil notifeeUIApplication];
    NSInteger currentCount = application.applicationIconBadgeNumber;
    // If count -1 (to clear badge w/o clearing notifications),
    // set currentCount to 0 before incrementing
    if (currentCount == -1) {
      currentCount = 0;
    }

    NSInteger newCount = currentCount + incrementBy;

    if (@available(iOS 16.0, macOS 10.13, macCatalyst 16.0, tvOS 16.0, visionOS 1.0, *)) {
      UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
      [center setBadgeCount:newCount
          withCompletionHandler:^(NSError *error) {
            if (error) {
              NSLog(@"NotifeeCore: Could not incrementBadgeCount: %@", error);
              block(error);
            } else {
              block(nil);
            }
          }];
      return;
    } else {
      [application setApplicationIconBadgeNumber:newCount];
    }
  }
  block(nil);
}

+ (void)decrementBadgeCount:(NSInteger)decrementBy withBlock:(notifeeMethodVoidBlock)block {
  if (![NotifeeCoreUtil isAppExtension]) {
    UIApplication *application = (UIApplication *)[NotifeeCoreUtil notifeeUIApplication];
    NSInteger currentCount = application.applicationIconBadgeNumber;
    NSInteger newCount = currentCount - decrementBy;
    if (@available(iOS 16.0, macOS 10.13, macCatalyst 16.0, tvOS 16.0, visionOS 1.0, *)) {
      UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
      [center setBadgeCount:newCount
          withCompletionHandler:^(NSError *error) {
            if (error) {
              NSLog(@"NotifeeCore: Could not incrementBadgeCount: %@", error);
              block(error);
            } else {
              block(nil);
            }
          }];
      return;
    } else {
      // If count is 0 or less, set to -1 instead to avoid notifications in tray being cleared
      // this breaks in iOS 18, but at that point we're using the new setBadge API
      if (newCount < 1) {
        newCount = -1;
      }
      [application setApplicationIconBadgeNumber:newCount];
    }
  }

  block(nil);
}

+ (void)setNotificationConfig:(NSDictionary *)config withBlock:(notifeeMethodVoidBlock)block {
  if (config[@"ios"] != nil && config[@"ios"][@"handleRemoteNotifications"] != nil) {
    [NotifeeCoreUNUserNotificationCenter instance].shouldHandleRemoteNotifications =
        [config[@"ios"][@"handleRemoteNotifications"] boolValue];
  }
  block(nil);
}

+ (nullable instancetype)notifeeUIApplication {
  return (NotifeeCore *)[NotifeeCoreUtil notifeeUIApplication];
};

+ (void)populateNotificationContent:(UNNotificationRequest *)request
                        withContent:(UNMutableNotificationContent *)content
                 withContentHandler:(void (^)(UNNotificationContent *_Nonnull))contentHandler {
  return [[NotifeeCoreExtensionHelper instance] populateNotificationContent:request
                                                                withContent:content
                                                         withContentHandler:contentHandler];
};

@end
