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

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>

#import "NotifeeCoreFcmIdentity.h"

static NSInteger failures = 0;

@interface HarnessRequest : NSObject
@property(nonatomic, copy) NSString *identifier;
@property(nonatomic, strong) UNNotificationContent *content;
@property(nonatomic, strong) UNNotificationTrigger *trigger;
@end

@implementation HarnessRequest
@end

static void Assert(BOOL condition, NSString *message) {
  if (!condition) {
    failures += 1;
    fprintf(stderr, "FAIL FCM native identity: %s\n", message.UTF8String);
  }
}

static UNNotificationRequest *Request(NSString *physicalId, NSString *logicalId, BOOL remote,
                                      BOOL hasFcmOptions) {
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
  if (logicalId != nil) {
    userInfo[@"__notifee_notification"] = @{@"id" : logicalId, @"remote" : @(remote)};
  }
  if (hasFcmOptions) {
    userInfo[@"notifee_options"] = @"{\"_v\":1}";
  }
  content.userInfo = userInfo;
  HarnessRequest *request = [HarnessRequest new];
  request.identifier = physicalId;
  request.content = content;
  if (remote) {
    request.trigger =
        (UNNotificationTrigger *)class_createInstance(UNPushNotificationTrigger.class, 0);
  }
  return (UNNotificationRequest *)(id)request;
}

int main(void) {
  @autoreleasepool {
    UNNotificationRequest *fcmA = Request(@"physical-A", @"logical-N", YES, YES);
    UNNotificationRequest *fcmB = Request(@"physical-B", @"logical-N", YES, YES);
    UNNotificationRequest *fcmSame = Request(@"same", @"same", YES, YES);
    UNNotificationRequest *legacy = Request(@"legacy-R", @"legacy-R", YES, YES);
    UNNotificationRequest *local = Request(@"local-R", @"logical-N", NO, YES);
    UNNotificationRequest *foreign = Request(@"logical-N", nil, NO, NO);
    UNNotificationRequest *otherLogical = Request(@"physical-other", @"other-N", YES, YES);
    UNNotificationRequest *collidingLogical = Request(@"logical-N", @"different-N", YES, YES);
    NSArray *requests = @[ fcmA, fcmB, fcmSame, legacy, local, foreign, otherLogical ];

    Assert([NotifeeFcmLogicalIdForRequest(fcmA) isEqualToString:@"logical-N"],
           @"owned FCM N was not read from metadata");
    Assert(NotifeeFcmLogicalIdForRequest(local) == nil, @"local notification was reinterpreted");
    Assert(NotifeeFcmLogicalIdForRequest(foreign) == nil, @"foreign notification was claimed");
    Assert([NotifeeFcmIdentifiersForLogicalId(requests, @"logical-N")
               isEqual:@[ @"physical-A", @"physical-B" ]],
           @"cancel(N) did not resolve every physical R or included another "
           @"notification");
    Assert([NotifeeFcmIdentifiersForLogicalId(requests, @"same") isEqual:@[ @"same" ]],
           @"N=R physical identity was not retained");
    Assert([NotifeeFcmIdentifiersForLogicalId(requests, @"legacy-R") isEqual:@[ @"legacy-R" ]],
           @"legacy R fallback changed");
    Assert(!NotifeeShouldRemoveDirectIdentifierForLogicalId(requests, @"logical-N"),
           @"cancel(N) would remove foreign physical R=N");
    Assert(
        !NotifeeShouldRemoveDirectIdentifierForLogicalId(@[ fcmA, collidingLogical ], @"logical-N"),
        @"cancel(N) would remove another FCM notification whose R=N");
    Assert(NotifeeShouldRemoveDirectIdentifierForLogicalId(requests, @"unmatched"),
           @"legacy physical cancellation changed");
    Assert(!NotifeeShouldRemoveDirectIdentifierForLogicalId(requests, @"physical-other"),
           @"cancel by physical R would remove a different FCM logical N");
  }
  if (failures > 0) return 1;
  fprintf(stdout, "PASS FCM native identity helper\n");
  return 0;
}
