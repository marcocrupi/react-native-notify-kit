/**
 * Copyright (c) 2016-present Invertase Limited & Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#pragma once

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

// The NSE stores the logical ID in NotifyKit-owned metadata. APNs owns the
// request identifier, so it must remain a separate physical identity.
static inline NSString *NotifeeFcmLogicalIdForRequest(UNNotificationRequest *request) {
  if (![request.trigger isKindOfClass:UNPushNotificationTrigger.class]) {
    return nil;
  }
  NSDictionary *userInfo = request.content.userInfo;
  NSDictionary *notification = userInfo[@"__notifee_notification"];
  if (![notification isKindOfClass:NSDictionary.class]) {
    return nil;
  }
  NSNumber *remote = notification[@"remote"];
  id options = userInfo[@"notifee_options"];
  NSString *logicalId = notification[@"id"];
  if (![remote isKindOfClass:NSNumber.class] || !remote.boolValue ||
      (![options isKindOfClass:NSString.class] && ![options isKindOfClass:NSDictionary.class]) ||
      ![logicalId isKindOfClass:NSString.class] || logicalId.length == 0) {
    return nil;
  }
  return logicalId;
}

static inline NSArray<NSString *> *NotifeeFcmIdentifiersForLogicalId(
    NSArray<UNNotificationRequest *> *requests, NSString *logicalId) {
  NSMutableOrderedSet<NSString *> *physicalIds = [NSMutableOrderedSet orderedSet];
  for (UNNotificationRequest *request in requests) {
    if ([NotifeeFcmLogicalIdForRequest(request) isEqualToString:logicalId]) {
      [physicalIds addObject:request.identifier];
    }
  }
  return physicalIds.array;
}

// Preserve legacy physical-ID cancellation except when a divergent FCM logical
// ID has been resolved. In that case a foreign request whose R equals N must
// not be removed as collateral.
static inline BOOL NotifeeShouldRemoveDirectIdentifierForLogicalId(
    NSArray<UNNotificationRequest *> *requests, NSString *logicalId) {
  BOOL hasDivergentFcmRequest = NO;
  for (UNNotificationRequest *request in requests) {
    NSString *requestLogicalId = NotifeeFcmLogicalIdForRequest(request);
    if ([request.identifier isEqualToString:logicalId] && requestLogicalId != nil &&
        ![requestLogicalId isEqualToString:logicalId]) {
      return NO;
    }
    if ([requestLogicalId isEqualToString:logicalId] &&
        ![request.identifier isEqualToString:logicalId]) {
      hasDivergentFcmRequest = YES;
      break;
    }
  }
  if (!hasDivergentFcmRequest) {
    return YES;
  }
  for (UNNotificationRequest *request in requests) {
    if (![request.identifier isEqualToString:logicalId]) {
      continue;
    }
    NSDictionary *notification = request.content.userInfo[@"__notifee_notification"];
    if (![notification isKindOfClass:NSDictionary.class]) {
      continue;
    }
    NSString *notificationId = notification[@"id"];
    if ([notificationId isKindOfClass:NSString.class] &&
        [notificationId isEqualToString:logicalId]) {
      return YES;
    }
  }
  return NO;
}
