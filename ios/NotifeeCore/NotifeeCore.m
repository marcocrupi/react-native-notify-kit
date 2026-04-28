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
  NSString *mappedPublicId = [NotifeeCoreUtil rollingPublicIdFromInternalNotificationId:identifier];
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

+ (NSMutableOrderedSet<NSString *> *)
    rollingIdentifiersForPublicId:(NSString *)publicId
                  pendingRequests:(NSArray<UNNotificationRequest *> *)pendingRequests
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

+ (NSMutableOrderedSet<NSString *> *)
    rollingDeliveredIdentifiersForPublicId:(NSString *)publicId
                    deliveredNotifications:(NSArray<UNNotification *> *)deliveredNotifications
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

+ (UNCalendarNotificationTrigger *)rollingOneShotTriggerForOccurrenceMs:(NSNumber *)occurrenceMs {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([occurrenceMs doubleValue] / 1000.0)];
  NSDateComponents *components = [[NSCalendar currentCalendar]
      components:NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay | NSCalendarUnitHour |
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

+ (UNMutableNotificationContent *)
    triggerNotificationContentForNotification:(NSDictionary *)notification
                                      trigger:(NSDictionary *)trigger {
  UNMutableNotificationContent *content = [self buildNotificationContent:notification
                                                             withTrigger:trigger];

  if (@available(iOS 15.0, *)) {
    if (notification[@"ios"][@"communicationInfo"] != nil) {
      INSendMessageIntent *intent = [NotifeeCoreUtil
          generateSenderIntentForCommunicationNotification:notification[@"ios"]
                                                                       [@"communicationInfo"]];

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

  return content;
}

+ (UNNotificationRequest *)rollingNotificationRequestForPublicId:(NSString *)publicId
                                                    occurrenceMs:(NSNumber *)occurrenceMs
                                                         content:
                                                             (UNMutableNotificationContent *)content
                                                           error:(NSError **)error {
  NSString *internalId = [NotifeeCoreUtil rollingInternalNotificationIdForPublicId:publicId
                                                                      occurrenceMs:occurrenceMs];
  if (internalId == nil) {
    if (error != nil) {
      *error =
          [self rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                      message:@"NotifeeCore: Failed to create rolling timestamp "
                                              @"notification identifier."];
    }
    return nil;
  }

  UNMutableNotificationContent *rollingContent = [self rollingContentFromContent:content
                                                                        publicId:publicId
                                                                    occurrenceMs:occurrenceMs
                                                                      internalId:internalId];
  return [UNNotificationRequest
      requestWithIdentifier:internalId
                    content:rollingContent
                    trigger:[self rollingOneShotTriggerForOccurrenceMs:occurrenceMs]];
}

+ (void)removeRollingPendingRequestsForIds:(NSArray<NSString *> *)identifiers
                                    center:(UNUserNotificationCenter *)center {
  if ([identifiers count] > 0) {
    [center removePendingNotificationRequestsWithIdentifiers:identifiers];
  }
}

+ (NSMutableSet<NSString *> *)pendingIdentifierSetFromRequests:
    (NSArray<UNNotificationRequest *> *)pendingRequests {
  NSMutableSet<NSString *> *identifiers = [NSMutableSet set];
  for (UNNotificationRequest *request in pendingRequests) {
    NSString *identifier = request.identifier;
    if ([identifier isKindOfClass:NSString.class] && [identifier length] > 0) {
      [identifiers addObject:identifier];
    }
  }
  return identifiers;
}

+ (NSComparisonResult)compareRollingRebalanceState:(NSDictionary *)firstState
                                        otherState:(NSDictionary *)secondState {
  return [firstState[@"publicId"] compare:secondState[@"publicId"]];
}

+ (NSError *)scheduleRollingNotificationRequests:(NSArray<UNNotificationRequest *> *)requests
                                          center:(UNUserNotificationCenter *)center
                           successfulIdentifiers:(NSMutableSet<NSString *> *)successfulIdentifiers {
  if ([requests count] == 0) {
    return nil;
  }

  dispatch_group_t group = dispatch_group_create();
  NSObject *scheduleLock = [[NSObject alloc] init];
  __block NSError *scheduleError = nil;

  for (__unused UNNotificationRequest *request in requests) {
    dispatch_group_enter(group);
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    for (UNNotificationRequest *request in requests) {
      [center addNotificationRequest:request
               withCompletionHandler:^(NSError *_Nullable error) {
                 @synchronized(scheduleLock) {
                   if (error != nil && scheduleError == nil) {
                     scheduleError = error;
                   } else if (error == nil && successfulIdentifiers != nil) {
                     [successfulIdentifiers addObject:request.identifier];
                   }
                 }
                 dispatch_group_leave(group);
               }];
    }
  });

  dispatch_group_wait(group, DISPATCH_TIME_FOREVER);
  return scheduleError;
}

+ (BOOL)persistedRollingRecords:(NSDictionary *)persistedRecords
            matchUpdatedRecords:(NSDictionary *)updatedRecords {
  if ([persistedRecords count] != [updatedRecords count]) {
    return NO;
  }

  for (id publicId in updatedRecords) {
    if (persistedRecords[publicId] == nil) {
      return NO;
    }
  }

  return YES;
}

+ (NSArray<NSMutableDictionary *> *)rollingRebalanceStatesFromRecords:(NSDictionary *)records
                                                                nowMs:(NSNumber *)nowMs
                                                     requiredPublicId:(NSString *)requiredPublicId
                                                                error:(NSError **)error {
  NSMutableArray<NSMutableDictionary *> *states = [NSMutableArray array];
  BOOL foundRequiredPublicId = requiredPublicId == nil;

  for (id key in records) {
    if (![key isKindOfClass:NSString.class] || [key length] == 0) {
      continue;
    }

    NSString *publicId = key;
    BOOL isRequiredPublicId = [publicId isEqualToString:requiredPublicId];
    if (isRequiredPublicId) {
      foundRequiredPublicId = YES;
    }

    NSDictionary *record = records[publicId];
    NSDictionary *notification = record[@"notification"];
    NSDictionary *trigger = record[@"trigger"];
    if (![notification isKindOfClass:NSDictionary.class] ||
        ![trigger isKindOfClass:NSDictionary.class] ||
        ![NotifeeCoreUtil isRollingTimestampTrigger:trigger]) {
      if (isRequiredPublicId && error != nil) {
        *error = [self
            rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                  message:@"NotifeeCore: Rolling timestamp trigger requires a "
                                          @"valid notification and trigger record."];
        return nil;
      }
      continue;
    }

    NSArray<NSNumber *> *firstOccurrence =
        [NotifeeCoreUtil rollingTimestampOccurrencesFromTrigger:trigger nowMs:nowMs maxCount:1];
    NSNumber *firstOccurrenceMs = [firstOccurrence firstObject];
    NSString *firstInternalId =
        [NotifeeCoreUtil rollingInternalNotificationIdForPublicId:publicId
                                                     occurrenceMs:firstOccurrenceMs];
    if (firstOccurrenceMs == nil || firstInternalId == nil) {
      if (isRequiredPublicId && error != nil) {
        *error =
            [self rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                        message:@"NotifeeCore: Rolling timestamp trigger did not "
                                                @"produce any future occurrences."];
        return nil;
      }
      continue;
    }

    NSNumber *createdAt = record[@"createdAtMs"];
    if (![createdAt isKindOfClass:NSNumber.class]) {
      createdAt = nowMs;
    }

    NSMutableDictionary *state = [NSMutableDictionary dictionary];
    state[@"publicId"] = publicId;
    state[@"notification"] = notification;
    state[@"trigger"] = trigger;
    state[@"createdAtMs"] = createdAt;
    state[@"quota"] = @0;
    [states addObject:state];
  }

  if (!foundRequiredPublicId) {
    if (error != nil) {
      *error = [self rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                           message:@"NotifeeCore: Rolling timestamp trigger "
                                                   @"record was not found for rebalance."];
    }
    return nil;
  }

  [states
      sortUsingComparator:^NSComparisonResult(NSDictionary *firstState, NSDictionary *secondState) {
        return [self compareRollingRebalanceState:firstState otherState:secondState];
      }];

  return states;
}

+ (BOOL)prepareRollingRebalanceDesiredSchedulesForStates:(NSArray<NSMutableDictionary *> *)states
                                                   nowMs:(NSNumber *)nowMs
                                                   error:(NSError **)error {
  for (NSMutableDictionary *state in states) {
    NSInteger quota = [state[@"quota"] integerValue];
    if (quota <= 0) {
      continue;
    }

    NSString *publicId = state[@"publicId"];
    NSDictionary *notification = state[@"notification"];
    NSDictionary *trigger = state[@"trigger"];
    NSArray<NSNumber *> *occurrences =
        [NotifeeCoreUtil rollingTimestampOccurrencesFromTrigger:trigger nowMs:nowMs maxCount:quota];
    if ([occurrences count] == 0) {
      if (error != nil) {
        *error =
            [self rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                        message:@"NotifeeCore: Rolling timestamp trigger did not "
                                                @"produce any future occurrences."];
      }
      return NO;
    }

    UNMutableNotificationContent *content =
        [self triggerNotificationContentForNotification:notification trigger:trigger];
    NSMutableOrderedSet<NSString *> *desiredIds = [NSMutableOrderedSet orderedSet];
    NSMutableDictionary<NSString *, UNNotificationRequest *> *desiredRequests =
        [NSMutableDictionary dictionary];
    NSNumber *lastScheduledOccurrence = nil;

    for (NSNumber *occurrenceMs in occurrences) {
      if ([desiredIds count] >= (NSUInteger)quota) {
        break;
      }

      NSError *requestError = nil;
      UNNotificationRequest *request = [self rollingNotificationRequestForPublicId:publicId
                                                                      occurrenceMs:occurrenceMs
                                                                           content:content
                                                                             error:&requestError];
      if (request == nil) {
        if (error != nil) {
          *error = requestError;
        }
        return NO;
      }

      if ([desiredIds containsObject:request.identifier]) {
        continue;
      }

      [desiredIds addObject:request.identifier];
      desiredRequests[request.identifier] = request;
      lastScheduledOccurrence = occurrenceMs;
    }

    if ([desiredIds count] == 0 || lastScheduledOccurrence == nil) {
      if (error != nil) {
        *error =
            [self rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                        message:@"NotifeeCore: Rolling timestamp trigger did not "
                                                @"produce any future occurrences."];
      }
      return NO;
    }

    NSMutableDictionary *updatedRecord = [NSMutableDictionary dictionary];
    updatedRecord[@"publicId"] = publicId;
    updatedRecord[@"notification"] = notification;
    updatedRecord[@"trigger"] = trigger;
    updatedRecord[@"scheduledIds"] = [desiredIds array];
    updatedRecord[@"lastScheduledOccurrenceMs"] = lastScheduledOccurrence;
    updatedRecord[@"createdAtMs"] = state[@"createdAtMs"];

    state[@"desiredIds"] = desiredIds;
    state[@"desiredRequests"] = desiredRequests;
    state[@"updatedRecord"] = updatedRecord;
  }

  return YES;
}

+ (void)rollbackRollingRebalanceRemovedRequests:(NSArray<UNNotificationRequest *> *)removedRequests
                       successfulNewIdentifiers:(NSSet<NSString *> *)successfulNewIdentifiers
                                         center:(UNUserNotificationCenter *)center {
  if ([successfulNewIdentifiers count] > 0) {
    [self removeRollingPendingRequestsForIds:[successfulNewIdentifiers allObjects] center:center];
  }

  if ([removedRequests count] > 0) {
    [self scheduleRollingNotificationRequests:removedRequests
                                       center:center
                        successfulIdentifiers:nil];
  }
}

+ (BOOL)rebalanceRollingTimestampTriggerRecords:(NSDictionary *)records
                                         center:(UNUserNotificationCenter *)center
                                pendingRequests:(NSArray<UNNotificationRequest *> *)pendingRequests
                                          nowMs:(NSNumber *)nowMs
                                refreshPublicId:(NSString *)refreshPublicId
                               requiredPublicId:(NSString *)requiredPublicId
                                          error:(NSError **)error {
  NSError *stateError = nil;
  NSArray<NSMutableDictionary *> *states = [self rollingRebalanceStatesFromRecords:records
                                                                             nowMs:nowMs
                                                                  requiredPublicId:requiredPublicId
                                                                             error:&stateError];
  if (states == nil) {
    if (error != nil) {
      *error = stateError;
    }
    return NO;
  }

  NSMutableSet<NSString *> *pendingIdentifierSet =
      [self pendingIdentifierSetFromRequests:pendingRequests];
  NSMutableDictionary<NSString *, UNNotificationRequest *> *pendingRequestByIdentifier =
      [NSMutableDictionary dictionary];
  NSMutableOrderedSet<NSString *> *rollingPendingIdentifiers = [NSMutableOrderedSet orderedSet];
  NSMutableOrderedSet<NSString *> *replacementPendingIdentifiers = [NSMutableOrderedSet orderedSet];
  NSInteger nonRollingPendingCount = 0;

  for (UNNotificationRequest *request in pendingRequests) {
    NSString *identifier = request.identifier;
    if (![identifier isKindOfClass:NSString.class] || [identifier length] == 0) {
      continue;
    }

    pendingRequestByIdentifier[identifier] = request;
    if ([self isPotentialRollingInternalNotificationId:identifier]) {
      [rollingPendingIdentifiers addObject:identifier];
    } else if ([identifier isEqualToString:refreshPublicId]) {
      [replacementPendingIdentifiers addObject:identifier];
    } else {
      nonRollingPendingCount += 1;
    }
  }

  NSInteger rollingBudget = [NotifeeCoreUtil rollingPendingBudget] - nonRollingPendingCount;
  if (rollingBudget < 0) {
    rollingBudget = 0;
  }

  if ((NSInteger)[states count] > rollingBudget) {
    if (error != nil) {
      *error = [self
          rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeBudgetExceeded
                                message:@"NotifeeCore: iOS rolling timestamp trigger budget "
                                        @"cannot allocate one occurrence per active trigger."];
    }
    return NO;
  }

  NSInteger targetPerTrigger = [NotifeeCoreUtil rollingTargetPerTrigger];
  NSInteger remainingBudget = rollingBudget;
  for (NSMutableDictionary *state in states) {
    state[@"quota"] = @1;
    remainingBudget -= 1;
  }

  BOOL allocatedAdditionalSlot = YES;
  while (remainingBudget > 0 && allocatedAdditionalSlot) {
    allocatedAdditionalSlot = NO;
    for (NSMutableDictionary *state in states) {
      if (remainingBudget <= 0) {
        break;
      }

      NSInteger quota = [state[@"quota"] integerValue];
      if (quota >= targetPerTrigger) {
        continue;
      }

      state[@"quota"] = @(quota + 1);
      remainingBudget -= 1;
      allocatedAdditionalSlot = YES;
    }
  }

  NSError *planError = nil;
  if (![self prepareRollingRebalanceDesiredSchedulesForStates:states
                                                        nowMs:nowMs
                                                        error:&planError]) {
    if (error != nil) {
      *error = planError;
    }
    return NO;
  }

  NSMutableOrderedSet<NSString *> *desiredIdentifiers = [NSMutableOrderedSet orderedSet];
  NSMutableDictionary *updatedRecords = [NSMutableDictionary dictionary];
  for (NSMutableDictionary *state in states) {
    NSOrderedSet<NSString *> *stateDesiredIds = state[@"desiredIds"];
    [desiredIdentifiers unionOrderedSet:stateDesiredIds];

    NSString *publicId = state[@"publicId"];
    NSDictionary *updatedRecord = state[@"updatedRecord"];
    if (publicId != nil && updatedRecord != nil) {
      updatedRecords[publicId] = updatedRecord;
    }
  }

  if (requiredPublicId != nil && updatedRecords[requiredPublicId] == nil) {
    if (error != nil) {
      *error = [self
          rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                message:@"NotifeeCore: Rolling timestamp trigger did not produce "
                                        @"any future occurrences."];
    }
    return NO;
  }

  NSMutableOrderedSet<NSString *> *identifiersToRemove = [NSMutableOrderedSet orderedSet];
  for (NSString *identifier in rollingPendingIdentifiers) {
    if (![desiredIdentifiers containsObject:identifier]) {
      [identifiersToRemove addObject:identifier];
    }
  }
  [identifiersToRemove unionOrderedSet:replacementPendingIdentifiers];

  NSMutableArray<UNNotificationRequest *> *removedRequests = [NSMutableArray array];
  for (NSString *identifier in identifiersToRemove) {
    UNNotificationRequest *request = pendingRequestByIdentifier[identifier];
    if (request != nil) {
      [removedRequests addObject:request];
    }
  }

  NSMutableArray<UNNotificationRequest *> *requestsToSchedule = [NSMutableArray array];
  NSMutableSet<NSString *> *newRequestIdentifiers = [NSMutableSet set];
  for (NSMutableDictionary *state in states) {
    NSString *publicId = state[@"publicId"];
    NSOrderedSet<NSString *> *stateDesiredIds = state[@"desiredIds"];
    NSDictionary<NSString *, UNNotificationRequest *> *desiredRequests = state[@"desiredRequests"];
    BOOL shouldRefresh = refreshPublicId != nil && [publicId isEqualToString:refreshPublicId];

    for (NSString *identifier in stateDesiredIds) {
      UNNotificationRequest *request = desiredRequests[identifier];
      if (request == nil) {
        continue;
      }

      BOOL isAlreadyPending = [pendingIdentifierSet containsObject:identifier];
      if (!isAlreadyPending || shouldRefresh) {
        [requestsToSchedule addObject:request];
      }
      if (!isAlreadyPending) {
        [newRequestIdentifiers addObject:identifier];
      }
    }
  }

  [self removeRollingPendingRequestsForIds:[identifiersToRemove array] center:center];

  NSMutableSet<NSString *> *successfulScheduledIdentifiers = [NSMutableSet set];
  NSError *scheduleError =
      [self scheduleRollingNotificationRequests:requestsToSchedule
                                         center:center
                          successfulIdentifiers:successfulScheduledIdentifiers];
  if (scheduleError != nil) {
    NSMutableSet<NSString *> *successfulNewIdentifiers = [NSMutableSet set];
    for (NSString *identifier in successfulScheduledIdentifiers) {
      if ([newRequestIdentifiers containsObject:identifier]) {
        [successfulNewIdentifiers addObject:identifier];
      }
    }

    [self rollbackRollingRebalanceRemovedRequests:removedRequests
                         successfulNewIdentifiers:successfulNewIdentifiers
                                           center:center];
    if (error != nil) {
      *error = scheduleError;
    }
    return NO;
  }

  [NotifeeCoreUtil setRollingTimestampTriggers:updatedRecords];
  NSDictionary *persistedRecords = [NotifeeCoreUtil getRollingTimestampTriggers];
  if (![self persistedRollingRecords:persistedRecords matchUpdatedRecords:updatedRecords]) {
    NSMutableSet<NSString *> *successfulNewIdentifiers = [NSMutableSet set];
    for (NSString *identifier in successfulScheduledIdentifiers) {
      if ([newRequestIdentifiers containsObject:identifier]) {
        [successfulNewIdentifiers addObject:identifier];
      }
    }
    [self removeRollingPendingRequestsForIds:[successfulNewIdentifiers allObjects] center:center];

    if (error != nil) {
      *error =
          [self rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeStorageFailed
                                      message:@"NotifeeCore: Failed to persist rolling timestamp "
                                              @"trigger records after rebalance."];
    }
    return NO;
  }

  return YES;
}

+ (void)topUpRollingTimestampTriggersWithCompletion:(void (^)(NSError *error))completion {
  dispatch_async([self rollingTimestampQueue], ^{
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    NSNumber *nowMs = [self currentTimestampMs];
    NSArray<UNNotificationRequest *> *pendingRequests = [self pendingNotificationRequests:center];
    NSMutableDictionary *records = [NotifeeCoreUtil getRollingTimestampTriggers];
    NSError *topUpError = nil;

    [self rebalanceRollingTimestampTriggerRecords:records
                                           center:center
                                  pendingRequests:pendingRequests
                                            nowMs:nowMs
                                  refreshPublicId:nil
                                 requiredPublicId:nil
                                            error:&topUpError];

    if (completion != nil) {
      dispatch_async(dispatch_get_main_queue(), ^{
        completion(topUpError);
      });
    }
  });
}

+ (void)createRollingTriggerNotification:(NSDictionary *)notification
                             withTrigger:(NSDictionary *)trigger
                  withNotificationDetail:(NSDictionary *)notificationDetail
                                  center:(UNUserNotificationCenter *)center
                                   block:(notifeeMethodVoidBlock)block {
  dispatch_async([self rollingTimestampQueue], ^{
    NSString *publicId = [self rollingPublicIdForNotification:notification];
    if (publicId == nil) {
      NSError *error =
          [self rollingTimestampErrorWithCode:NotifeeCoreRollingErrorCodeInvalidTrigger
                                      message:@"NotifeeCore: Rolling timestamp trigger requires a "
                                              @"notification id."];
      [self resolveBlock:block withError:error];
      return;
    }

    NSArray<UNNotificationRequest *> *pendingRequests = [self pendingNotificationRequests:center];
    NSMutableDictionary *records = [NotifeeCoreUtil getRollingTimestampTriggers];
    NSNumber *nowMs = [self currentTimestampMs];
    NSDictionary *record = @{
      @"publicId" : publicId,
      @"notification" : notification,
      @"trigger" : trigger,
      @"scheduledIds" : @[],
      @"createdAtMs" : nowMs
    };
    records[publicId] = record;

    NSError *rebalanceError = nil;
    if (![self rebalanceRollingTimestampTriggerRecords:records
                                                center:center
                                       pendingRequests:pendingRequests
                                                 nowMs:nowMs
                                       refreshPublicId:publicId
                                      requiredPublicId:publicId
                                                 error:&rebalanceError]) {
      [self resolveBlock:block withError:rebalanceError];
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
    NSMutableOrderedSet<NSString *> *pendingIdentifiersToRemove = [NSMutableOrderedSet orderedSet];

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
  [self cancelRollingNotification:notificationId withNotificationType:notificationType block:block];
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
      triggerNotification[@"notification"] = request.content.userInfo[kNotifeeUserInfoNotification];
      triggerNotification[@"trigger"] = request.content.userInfo[kNotifeeUserInfoTrigger];

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
      [self addString:(rollingPublicId != nil ? rollingPublicId : notificationId) toOrderedSet:ids];
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
                 BOOL isApplicationActive = NO;
                 if (![NotifeeCoreUtil isAppExtension]) {
                   UIApplication *application = [NotifeeCoreUtil notifeeUIApplication];
                   if (application != nil) {
                     isApplicationActive = application.applicationState == UIApplicationStateActive;
                   }
                 }
                 if (!isApplicationActive) {
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
    UNMutableNotificationContent *content =
        [self triggerNotificationContentForNotification:notification trigger:trigger];
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

    NSMutableDictionary *notificationDetail = [notification mutableCopy];
    notificationDetail[@"remote"] = @NO;

    if ([NotifeeCoreUtil isRollingTimestampTrigger:trigger]) {
      [self createRollingTriggerNotification:notification
                                 withTrigger:trigger
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

      categoryDictionary[@"allowAnnouncement"] = @(NO);

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
