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
 *
 */

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>

#import "NotifeeCore+UNUserNotificationCenter.h"
#import "NotifeeCoreDelegateHolder.h"
#import "NotifeeCoreUtil.h"

static NSInteger gFailures = 0;

@interface HarnessUserNotificationCenter : NSObject
@property(nonatomic, weak) id<UNUserNotificationCenterDelegate> delegate;
@end

@implementation HarnessUserNotificationCenter
@end

static HarnessUserNotificationCenter *gHarnessCenter = nil;

static void HarnessInstallUserNotificationCenterStub(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    gHarnessCenter = [HarnessUserNotificationCenter new];

    Method method = class_getClassMethod([UNUserNotificationCenter class],
                                         @selector(currentNotificationCenter));
    if (method == NULL) {
      gFailures += 1;
      fprintf(
          stderr,
          "[delegate-chaining] FAIL install-center-stub: currentNotificationCenter not found\n");
      return;
    }

    IMP replacement = imp_implementationWithBlock(^UNUserNotificationCenter *(id receiver) {
      (void)receiver;
      return (UNUserNotificationCenter *)(id)gHarnessCenter;
    });
    method_setImplementation(method, replacement);
  });
}

@implementation NotifeeCore

+ (void)topUpRollingTimestampTriggersWithCompletion:(void (^)(NSError *error))completion {
  if (completion != nil) {
    completion(nil);
  }
}

@end

@implementation NotifeeCoreDelegateHolder

+ (instancetype)instance {
  static dispatch_once_t once;
  __strong static NotifeeCoreDelegateHolder *sharedInstance;
  dispatch_once(&once, ^{
    sharedInstance = [[NotifeeCoreDelegateHolder alloc] init];
    sharedInstance.pendingEvents = [NSMutableArray new];
  });
  return sharedInstance;
}

- (void)didReceiveNotifeeCoreEvent:(NSDictionary *)event {
  if (event != nil) {
    [self.pendingEvents addObject:event];
  }
}

@end

@implementation NotifeeCoreUtil

+ (BOOL)isRollingTimestampTrigger:(NSDictionary *)triggerDict {
  (void)triggerDict;
  return NO;
}

+ (BOOL)isRollingInternalNotificationId:(NSString *)notificationId {
  (void)notificationId;
  return NO;
}

+ (NSDictionary *)parseUNNotificationRequest:(UNNotificationRequest *)request {
  (void)request;
  return nil;
}

@end

@interface HarnessNotification : NSObject
@property(nonatomic, strong) UNNotificationRequest *request;
@end

@implementation HarnessNotification
@end

@interface HarnessNotificationResponse : NSObject
@property(nonatomic, strong) id notification;
@property(nonatomic, copy) NSString *actionIdentifier;
@end

@implementation HarnessNotificationResponse
@end

@interface HarnessThirdPartyDelegate : NSObject <UNUserNotificationCenterDelegate>
@property(nonatomic, copy) NSString *name;
@property(nonatomic, assign) NSInteger willPresentCount;
@property(nonatomic, assign) NSInteger didReceiveCount;
@property(nonatomic, assign) NSInteger openSettingsCount;
@property(nonatomic, assign) BOOL callCompletion;
@property(nonatomic, assign) NSInteger completionCallCount;
@property(nonatomic, assign) UNNotificationPresentationOptions presentationOptions;
@end

@implementation HarnessThirdPartyDelegate

- (instancetype)initWithName:(NSString *)name {
  self = [super init];
  if (self != nil) {
    _name = [name copy];
    _callCompletion = YES;
    _completionCallCount = 1;
    _presentationOptions = UNNotificationPresentationOptionSound;
  }
  return self;
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:
             (void (^)(UNNotificationPresentationOptions options))completionHandler {
  (void)center;
  (void)notification;
  self.willPresentCount += 1;
  if (self.callCompletion && completionHandler != nil) {
    for (NSInteger i = 0; i < self.completionCallCount; i++) {
      completionHandler(self.presentationOptions);
    }
  }
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  (void)center;
  (void)response;
  self.didReceiveCount += 1;
  if (self.callCompletion && completionHandler != nil) {
    for (NSInteger i = 0; i < self.completionCallCount; i++) {
      completionHandler();
    }
  }
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    openSettingsForNotification:(UNNotification *)notification {
  (void)center;
  (void)notification;
  self.openSettingsCount += 1;
}

@end

@interface HarnessDidReceiveOnlyDelegate : NSObject <UNUserNotificationCenterDelegate>
@property(nonatomic, assign) NSInteger didReceiveCount;
@property(nonatomic, assign) NSInteger completionCallCount;
@end

@implementation HarnessDidReceiveOnlyDelegate

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    _completionCallCount = 1;
  }
  return self;
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  (void)center;
  (void)response;
  self.didReceiveCount += 1;
  if (completionHandler != nil) {
    for (NSInteger i = 0; i < self.completionCallCount; i++) {
      completionHandler();
    }
  }
}

@end

static void HarnessFail(NSString *testName, NSString *message) {
  gFailures += 1;
  fprintf(stderr, "[delegate-chaining] FAIL %s: %s\n", testName.UTF8String, message.UTF8String);
  fflush(stderr);
}

static void HarnessExpectedFutureFailure(NSString *testName, NSString *message) {
  gFailures += 1;
  fprintf(stdout, "[delegate-chaining] EXPECTED-FAIL %s: %s\n", testName.UTF8String,
          message.UTF8String);
  fflush(stdout);
}

static void HarnessPass(NSString *testName) {
  fprintf(stdout, "[delegate-chaining] PASS %s\n", testName.UTF8String);
  fflush(stdout);
}

static void HarnessFinishTest(NSString *testName, NSInteger failuresBefore) {
  if (gFailures == failuresBefore) {
    HarnessPass(testName);
  }
}

static void HarnessAssert(BOOL condition, NSString *testName, NSString *message) {
  if (!condition) {
    HarnessFail(testName, message);
  }
}

static BOOL HarnessShouldRunFutureRechainTests(void) {
  NSString *value = [NSProcessInfo processInfo].environment[@"EXPECT_RECHAIN_FIX"];
  return [value isEqualToString:@"1"];
}

static SEL HarnessFutureRechainSelector(void) {
  return NSSelectorFromString(@"rechainUserNotificationCenterDelegate");
}

static void HarnessInvokeFutureRechain(NotifeeCoreUNUserNotificationCenter *notifeeCenter) {
  SEL selector = HarnessFutureRechainSelector();
  IMP implementation = [notifeeCenter methodForSelector:selector];
  void (*rechain)(id, SEL) = (void *)implementation;
  rechain(notifeeCenter, selector);
}

static void HarnessClearCoreEvents(void) {
  [[NotifeeCoreDelegateHolder instance].pendingEvents removeAllObjects];
}

static NSInteger HarnessCoreEventCount(void) {
  return (NSInteger)[NotifeeCoreDelegateHolder instance].pendingEvents.count;
}

static NSDictionary *HarnessLastCoreEvent(void) {
  return [NotifeeCoreDelegateHolder instance].pendingEvents.lastObject;
}

static UNNotificationRequest *HarnessNonNotifeeRequest(NSString *identifier) {
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = @"delegate chaining harness";
  content.body = @"non-Notifee notification";
  content.userInfo = @{};
  return [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
}

static NSDictionary *HarnessNotifeeNotificationPayload(NSString *identifier) {
  return @{
    @"id" : identifier,
    @"ios" : @{
      @"foregroundPresentationOptions" : @{
        @"alert" : @NO,
        @"badge" : @YES,
        @"sound" : @YES,
        @"banner" : @YES,
        @"list" : @YES,
      },
    },
  };
}

static UNNotificationRequest *HarnessNotifeeRequest(NSString *identifier) {
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = @"delegate chaining harness";
  content.body = @"NotifyKit-owned notification";
  content.userInfo = @{
    kNotifeeUserInfoNotification : HarnessNotifeeNotificationPayload(identifier),
  };
  return [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
}

static UNNotification *HarnessNonNotifeeNotification(NSString *identifier) {
  HarnessNotification *notification = [HarnessNotification new];
  notification.request = HarnessNonNotifeeRequest(identifier);
  return (UNNotification *)(id)notification;
}

static UNNotification *HarnessNotifeeNotification(NSString *identifier) {
  HarnessNotification *notification = [HarnessNotification new];
  notification.request = HarnessNotifeeRequest(identifier);
  return (UNNotification *)(id)notification;
}

static UNNotificationResponse *HarnessNonNotifeeResponse(NSString *identifier) {
  HarnessNotificationResponse *response = [HarnessNotificationResponse new];
  response.notification = HarnessNonNotifeeNotification(identifier);
  response.actionIdentifier = UNNotificationDefaultActionIdentifier;
  return (UNNotificationResponse *)(id)response;
}

static UNNotificationResponse *HarnessNotifeeResponse(NSString *identifier) {
  HarnessNotificationResponse *response = [HarnessNotificationResponse new];
  response.notification = HarnessNotifeeNotification(identifier);
  response.actionIdentifier = UNNotificationDefaultActionIdentifier;
  return (UNNotificationResponse *)(id)response;
}

static UNNotificationResponse *HarnessFcmResponse(NSString *physicalId, NSString *logicalId,
                                                  NSString *actionId) {
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.userInfo = @{
    kNotifeeUserInfoNotification : @{@"id" : logicalId, @"remote" : @YES},
    @"notifee_options" : @"{\"_v\":1}"
  };
  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:physicalId
                                                                        content:content
                                                                        trigger:nil];
  HarnessNotification *notification = [HarnessNotification new];
  notification.request = request;
  HarnessNotificationResponse *response = [HarnessNotificationResponse new];
  response.notification = notification;
  response.actionIdentifier = actionId;
  return (UNNotificationResponse *)(id)response;
}

static void HarnessTestFcmLogicalIdInPressEvents(UNUserNotificationCenter *center) {
  NSString *testName = @"fcm-logical-id-in-press-events";
  NSInteger failuresBefore = gFailures;
  NotifeeCoreUNUserNotificationCenter *delegate = [NotifeeCoreUNUserNotificationCenter instance];
  for (NSString *actionId in @[ UNNotificationDefaultActionIdentifier, @"reply-action" ]) {
    HarnessClearCoreEvents();
    __block NSInteger completions = 0;
    [delegate userNotificationCenter:center
        didReceiveNotificationResponse:HarnessFcmResponse(@"physical-R", @"logical-N", actionId)
                 withCompletionHandler:^{
                   completions += 1;
                 }];
    NSDictionary *event = HarnessLastCoreEvent();
    HarnessAssert(completions == 1, testName, @"response completion count changed");
    HarnessAssert(
        [event[@"type"]
            isEqual:@([actionId isEqualToString:UNNotificationDefaultActionIdentifier] ? 1 : 2)],
        testName, @"PRESS/ACTION_PRESS type changed");
    HarnessAssert([event[@"detail"][@"notification"][@"id"] isEqualToString:@"logical-N"], testName,
                  @"event reported physical R instead of logical N");
    HarnessAssert([delegate.notificationOpenedAppID isEqualToString:@"logical-N"], testName,
                  @"initial notification opening ID was physical R");
  }
  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessAssertCurrentDelegate(id actualDelegate, id expectedDelegate, NSString *testName,
                                         NSString *message) {
  HarnessAssert(actualDelegate == expectedDelegate, testName, message);
}

static void HarnessTestCapturesExistingDelegate(UNUserNotificationCenter *center,
                                                NotifeeCoreUNUserNotificationCenter *notifeeCenter,
                                                HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"captures-existing-delegate";
  NSInteger failuresBefore = gFailures;

  HarnessAssertCurrentDelegate(center.delegate, notifeeCenter, testName,
                               @"NotifyKit did not become the current delegate");
  HarnessAssert(notifeeCenter.originalDelegate == existingDelegate, testName,
                @"NotifyKit did not retain the pre-existing delegate as originalDelegate");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessTestForwardsNonNotifeeWillPresent(UNUserNotificationCenter *center,
                                                     HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"forwards-non-notifee-will-present";
  NSInteger failuresBefore = gFailures;
  NSInteger existingWillPresentBefore = existingDelegate.willPresentCount;
  __block NSInteger completionCount = 0;
  __block UNNotificationPresentationOptions receivedOptions = UNNotificationPresentationOptionNone;

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
                  willPresentNotification:HarnessNonNotifeeNotification(@"will-present")
                    withCompletionHandler:^(UNNotificationPresentationOptions options) {
                      completionCount += 1;
                      receivedOptions = options;
                    }];

  HarnessAssert(existingDelegate.willPresentCount == existingWillPresentBefore + 1, testName,
                @"pre-existing delegate did not receive willPresentNotification");
  HarnessAssert(completionCount == 1, testName,
                @"willPresentNotification completion was not called exactly once");
  HarnessAssert(receivedOptions == existingDelegate.presentationOptions, testName,
                @"willPresentNotification did not return options from original delegate");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessTestForwardsNonNotifeeDidReceive(UNUserNotificationCenter *center,
                                                    HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"forwards-non-notifee-did-receive";
  NSInteger failuresBefore = gFailures;
  NSInteger existingDidReceiveBefore = existingDelegate.didReceiveCount;
  __block NSInteger completionCount = 0;

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
           didReceiveNotificationResponse:HarnessNonNotifeeResponse(@"did-receive")
                    withCompletionHandler:^{
                      completionCount += 1;
                    }];

  HarnessAssert(existingDelegate.didReceiveCount == existingDidReceiveBefore + 1, testName,
                @"pre-existing delegate did not receive didReceiveNotificationResponse");
  HarnessAssert(completionCount == 1, testName,
                @"didReceiveNotificationResponse completion was not called exactly once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessTestForwardsOpenSettings(UNUserNotificationCenter *center,
                                            HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"forwards-open-settings";
  NSInteger failuresBefore = gFailures;
  NSInteger existingOpenSettingsBefore = existingDelegate.openSettingsCount;

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
              openSettingsForNotification:HarnessNonNotifeeNotification(@"open-settings")];

  HarnessAssert(existingDelegate.openSettingsCount == existingOpenSettingsBefore + 1, testName,
                @"pre-existing delegate did not receive openSettingsForNotification");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessTestCompletionCalledOnceInCoveredPaths(
    UNUserNotificationCenter *center, HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"completion-called-once";
  NSInteger failuresBefore = gFailures;
  NSInteger existingWillPresentBefore = existingDelegate.willPresentCount;
  NSInteger existingDidReceiveBefore = existingDelegate.didReceiveCount;
  __block NSInteger willPresentCompletionCount = 0;
  __block NSInteger didReceiveCompletionCount = 0;

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
                  willPresentNotification:HarnessNonNotifeeNotification(@"completion-will-present")
                    withCompletionHandler:^(UNNotificationPresentationOptions options) {
                      (void)options;
                      willPresentCompletionCount += 1;
                    }];
  [currentDelegate userNotificationCenter:center
           didReceiveNotificationResponse:HarnessNonNotifeeResponse(@"completion-did-receive")
                    withCompletionHandler:^{
                      didReceiveCompletionCount += 1;
                    }];

  HarnessAssert(existingDelegate.willPresentCount == existingWillPresentBefore + 1, testName,
                @"willPresentNotification did not forward during completion one-shot check");
  HarnessAssert(existingDelegate.didReceiveCount == existingDidReceiveBefore + 1, testName,
                @"didReceiveNotificationResponse did not forward during completion one-shot check");
  HarnessAssert(willPresentCompletionCount == 1, testName,
                @"willPresentNotification completion was called more or less than once");
  HarnessAssert(didReceiveCompletionCount == 1, testName,
                @"didReceiveNotificationResponse completion was called more or less than once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessTestLateDelegateOverridesNotifyKit(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    HarnessThirdPartyDelegate *lateDelegate, HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"late-delegate-overrides-notifykit";
  NSInteger failuresBefore = gFailures;
  NSInteger lateWillPresentBefore = lateDelegate.willPresentCount;
  NSInteger existingWillPresentBefore = existingDelegate.willPresentCount;
  __block NSInteger completionCount = 0;

  center.delegate = lateDelegate;

  HarnessAssertCurrentDelegate(center.delegate, lateDelegate, testName,
                               @"late delegate did not become current delegate");
  HarnessAssert(center.delegate != notifeeCenter, testName,
                @"NotifyKit unexpectedly remained the current delegate after late override");

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
                  willPresentNotification:HarnessNonNotifeeNotification(@"late-will-present")
                    withCompletionHandler:^(UNNotificationPresentationOptions options) {
                      (void)options;
                      completionCount += 1;
                    }];

  HarnessAssert(lateDelegate.willPresentCount == lateWillPresentBefore + 1, testName,
                @"late delegate did not receive willPresentNotification");
  HarnessAssert(existingDelegate.willPresentCount == existingWillPresentBefore, testName,
                @"pre-existing delegate changed, suggesting NotifyKit stayed in the callback path");
  HarnessAssert(completionCount == 1, testName,
                @"late delegate willPresentNotification completion was not called exactly once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessTestHandleRemoteFlagDoesNotRechain(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    HarnessThirdPartyDelegate *lateDelegate, HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"handle-remote-flag-does-not-rechain";
  NSInteger failuresBefore = gFailures;
  NSInteger lateDidReceiveBefore = lateDelegate.didReceiveCount;
  NSInteger existingDidReceiveBefore = existingDelegate.didReceiveCount;
  __block NSInteger completionCount = 0;

  notifeeCenter.shouldHandleRemoteNotifications = NO;

  HarnessAssert(notifeeCenter.shouldHandleRemoteNotifications == NO, testName,
                @"handleRemoteNotifications flag did not switch off on NotifyKit delegate");
  HarnessAssertCurrentDelegate(
      center.delegate, lateDelegate, testName,
      @"handleRemoteNotifications flag unexpectedly changed current delegate");
  HarnessAssert(
      center.delegate != notifeeCenter, testName,
      @"NotifyKit unexpectedly became current delegate after handleRemoteNotifications=false");

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
           didReceiveNotificationResponse:HarnessNonNotifeeResponse(@"late-did-receive")
                    withCompletionHandler:^{
                      completionCount += 1;
                    }];

  HarnessAssert(lateDelegate.didReceiveCount == lateDidReceiveBefore + 1, testName,
                @"late delegate did not keep didReceiveNotificationResponse after flag change");
  HarnessAssert(
      existingDelegate.didReceiveCount == existingDidReceiveBefore, testName,
      @"pre-existing delegate changed, suggesting NotifyKit re-entered the callback path");
  HarnessAssert(
      completionCount == 1, testName,
      @"late delegate didReceiveNotificationResponse completion was not called exactly once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessPrepareFutureRechainScenario(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    id<UNUserNotificationCenterDelegate> originalDelegate,
    id<UNUserNotificationCenterDelegate> lateDelegate, BOOL shouldHandleRemoteNotifications) {
  notifeeCenter.shouldHandleRemoteNotifications = shouldHandleRemoteNotifications;
  notifeeCenter.initialNotification = nil;
  notifeeCenter.notificationOpenedAppID = @"";
  notifeeCenter.originalDelegate = originalDelegate;
  center.delegate = notifeeCenter;
  center.delegate = lateDelegate;
  HarnessClearCoreEvents();
}

static void HarnessFutureTestRechainLateDelegate(UNUserNotificationCenter *center,
                                                 NotifeeCoreUNUserNotificationCenter *notifeeCenter,
                                                 HarnessThirdPartyDelegate *lateDelegate,
                                                 HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-late-delegate";
  NSInteger failuresBefore = gFailures;
  NSInteger lateWillPresentBefore = lateDelegate.willPresentCount;
  NSInteger existingWillPresentBefore = existingDelegate.willPresentCount;
  __block NSInteger completionCount = 0;
  __block UNNotificationPresentationOptions receivedOptions = UNNotificationPresentationOptionNone;

  HarnessPrepareFutureRechainScenario(center, notifeeCenter, existingDelegate, lateDelegate, YES);
  HarnessInvokeFutureRechain(notifeeCenter);

  HarnessAssertCurrentDelegate(center.delegate, notifeeCenter, testName,
                               @"future rechain did not restore NotifyKit as current delegate");
  HarnessAssert(notifeeCenter.originalDelegate == lateDelegate, testName,
                @"future rechain did not capture late delegate as downstream originalDelegate");

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
                  willPresentNotification:HarnessNonNotifeeNotification(@"future-late-will-present")
                    withCompletionHandler:^(UNNotificationPresentationOptions options) {
                      completionCount += 1;
                      receivedOptions = options;
                    }];

  HarnessAssert(lateDelegate.willPresentCount == lateWillPresentBefore + 1, testName,
                @"non-NotifyKit willPresentNotification was not forwarded to late delegate");
  HarnessAssert(existingDelegate.willPresentCount == existingWillPresentBefore, testName,
                @"old pre-existing delegate received willPresentNotification after rechain");
  HarnessAssert(completionCount == 1, testName,
                @"forwarded willPresentNotification completion was not called exactly once");
  HarnessAssert(receivedOptions == lateDelegate.presentationOptions, testName,
                @"forwarded willPresentNotification did not return late delegate options");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessFutureTestRechainIdempotent(UNUserNotificationCenter *center,
                                               NotifeeCoreUNUserNotificationCenter *notifeeCenter,
                                               HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-idempotent";
  NSInteger failuresBefore = gFailures;
  NSInteger existingWillPresentBefore = existingDelegate.willPresentCount;
  __block NSInteger completionCount = 0;

  notifeeCenter.shouldHandleRemoteNotifications = YES;
  notifeeCenter.originalDelegate = existingDelegate;
  center.delegate = notifeeCenter;

  HarnessInvokeFutureRechain(notifeeCenter);

  HarnessAssertCurrentDelegate(center.delegate, notifeeCenter, testName,
                               @"idempotent rechain changed current delegate away from NotifyKit");
  HarnessAssert(notifeeCenter.originalDelegate == existingDelegate, testName,
                @"idempotent rechain overwrote the existing downstream delegate");
  HarnessAssert(
      notifeeCenter.originalDelegate != (id<UNUserNotificationCenterDelegate>)notifeeCenter,
      testName, @"idempotent rechain captured NotifyKit as its own downstream delegate");

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
                  willPresentNotification:HarnessNonNotifeeNotification(@"future-idempotent-will")
                    withCompletionHandler:^(UNNotificationPresentationOptions options) {
                      (void)options;
                      completionCount += 1;
                    }];

  HarnessAssert(existingDelegate.willPresentCount == existingWillPresentBefore + 1, testName,
                @"idempotent rechain broke downstream willPresent forwarding");
  HarnessAssert(completionCount == 1, testName,
                @"idempotent rechain forwarding completion was not exactly once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessFutureTestRechainUpdatesDownstream(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    HarnessThirdPartyDelegate *lateDelegate, HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-updates-downstream";
  NSInteger failuresBefore = gFailures;
  NSInteger lateDidReceiveBefore = lateDelegate.didReceiveCount;
  NSInteger existingDidReceiveBefore = existingDelegate.didReceiveCount;
  __block NSInteger completionCount = 0;

  HarnessPrepareFutureRechainScenario(center, notifeeCenter, existingDelegate, lateDelegate, YES);
  HarnessInvokeFutureRechain(notifeeCenter);

  HarnessAssert(notifeeCenter.originalDelegate == lateDelegate, testName,
                @"future rechain kept the stale pre-existing downstream delegate");

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
           didReceiveNotificationResponse:HarnessNonNotifeeResponse(@"future-update-did-receive")
                    withCompletionHandler:^{
                      completionCount += 1;
                    }];

  HarnessAssert(lateDelegate.didReceiveCount == lateDidReceiveBefore + 1, testName,
                @"non-NotifyKit didReceiveNotificationResponse was not forwarded to late delegate");
  HarnessAssert(
      existingDelegate.didReceiveCount == existingDidReceiveBefore, testName,
      @"stale pre-existing delegate received didReceiveNotificationResponse after rechain");
  HarnessAssert(
      completionCount == 1, testName,
      @"updated downstream didReceiveNotificationResponse completion was not exactly once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessFutureTestNotifeeOwnedDoesNotForward(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    HarnessThirdPartyDelegate *lateDelegate, HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-notifee-owned-not-forwarded";
  NSInteger failuresBefore = gFailures;
  NSInteger lateWillPresentBefore = lateDelegate.willPresentCount;
  NSInteger coreEventsBefore = 0;
  __block NSInteger completionCount = 0;
  __block UNNotificationPresentationOptions receivedOptions = UNNotificationPresentationOptionNone;
  UNNotificationPresentationOptions expectedOptions =
      UNNotificationPresentationOptionBadge | UNNotificationPresentationOptionSound |
      UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList;

  HarnessPrepareFutureRechainScenario(center, notifeeCenter, existingDelegate, lateDelegate, YES);
  HarnessInvokeFutureRechain(notifeeCenter);
  coreEventsBefore = HarnessCoreEventCount();

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
                  willPresentNotification:HarnessNotifeeNotification(@"future-owned-will-present")
                    withCompletionHandler:^(UNNotificationPresentationOptions options) {
                      completionCount += 1;
                      receivedOptions = options;
                    }];

  NSDictionary *event = HarnessLastCoreEvent();
  HarnessAssert(lateDelegate.willPresentCount == lateWillPresentBefore, testName,
                @"NotifyKit-owned willPresentNotification was forwarded to late delegate");
  HarnessAssert(HarnessCoreEventCount() == coreEventsBefore + 1, testName,
                @"NotifyKit-owned willPresentNotification did not emit exactly one core event");
  HarnessAssert([event[@"type"] isEqual:@(NotifeeCoreEventTypeDelivered)], testName,
                @"NotifyKit-owned willPresentNotification did not emit DELIVERED");
  HarnessAssert(completionCount == 1, testName,
                @"NotifyKit-owned willPresentNotification completion was not exactly once");
  HarnessAssert(
      receivedOptions == expectedOptions, testName,
      @"NotifyKit-owned willPresentNotification did not use NotifyKit presentation options");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessFutureTestNonNotifeeForwarded(UNUserNotificationCenter *center,
                                                 NotifeeCoreUNUserNotificationCenter *notifeeCenter,
                                                 HarnessThirdPartyDelegate *lateDelegate,
                                                 HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-non-notifee-forwarded";
  NSInteger failuresBefore = gFailures;
  NSInteger lateDidReceiveBefore = lateDelegate.didReceiveCount;
  NSInteger coreEventsBefore = 0;
  __block NSInteger completionCount = 0;

  HarnessPrepareFutureRechainScenario(center, notifeeCenter, existingDelegate, lateDelegate, YES);
  HarnessInvokeFutureRechain(notifeeCenter);
  coreEventsBefore = HarnessCoreEventCount();

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
           didReceiveNotificationResponse:HarnessNonNotifeeResponse(@"future-forwarded-did-receive")
                    withCompletionHandler:^{
                      completionCount += 1;
                    }];

  HarnessAssert(lateDelegate.didReceiveCount == lateDidReceiveBefore + 1, testName,
                @"non-NotifyKit didReceiveNotificationResponse was not forwarded after rechain");
  HarnessAssert(HarnessCoreEventCount() == coreEventsBefore, testName,
                @"non-NotifyKit didReceiveNotificationResponse emitted a NotifyKit core event");
  HarnessAssert(completionCount == 1, testName,
                @"non-NotifyKit didReceiveNotificationResponse completion was not exactly once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessFutureTestHandleRemoteFalsePreserved(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    HarnessThirdPartyDelegate *lateDelegate, HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-handle-remote-false-preserved";
  NSInteger failuresBefore = gFailures;
  NSInteger lateDidReceiveBefore = lateDelegate.didReceiveCount;
  NSInteger coreEventsBefore = 0;
  __block NSInteger completionCount = 0;

  HarnessPrepareFutureRechainScenario(center, notifeeCenter, existingDelegate, lateDelegate, NO);
  HarnessInvokeFutureRechain(notifeeCenter);
  coreEventsBefore = HarnessCoreEventCount();

  HarnessAssert(notifeeCenter.shouldHandleRemoteNotifications == NO, testName,
                @"future rechain changed shouldHandleRemoteNotifications");

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
           didReceiveNotificationResponse:HarnessNonNotifeeResponse(@"future-handle-false-remote")
                    withCompletionHandler:^{
                      completionCount += 1;
                    }];

  HarnessAssert(
      lateDelegate.didReceiveCount == lateDidReceiveBefore + 1, testName,
      @"remote non-NotifyKit response was not forwarded with handleRemoteNotifications=false");
  HarnessAssert(
      HarnessCoreEventCount() == coreEventsBefore, testName,
      @"remote non-NotifyKit response emitted a core event with handleRemoteNotifications=false");
  HarnessAssert(completionCount == 1, testName,
                @"remote non-NotifyKit response completion was not exactly once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessFutureTestFcmMarkedRemainsNotifeeOwned(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    HarnessThirdPartyDelegate *lateDelegate, HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-fcm-marked-remains-notifee-owned";
  NSInteger failuresBefore = gFailures;
  NSInteger lateDidReceiveBefore = lateDelegate.didReceiveCount;
  NSInteger coreEventsBefore = 0;
  __block NSInteger completionCount = 0;

  HarnessPrepareFutureRechainScenario(center, notifeeCenter, existingDelegate, lateDelegate, NO);
  notifeeCenter.initialNotification = nil;
  notifeeCenter.notificationOpenedAppID = @"previous";
  HarnessInvokeFutureRechain(notifeeCenter);
  coreEventsBefore = HarnessCoreEventCount();

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
           didReceiveNotificationResponse:HarnessNotifeeResponse(@"future-fcm-marked")
                    withCompletionHandler:^{
                      completionCount += 1;
                    }];

  NSDictionary *event = HarnessLastCoreEvent();
  NSDictionary *eventDetail = event[@"detail"];
  NSDictionary *eventNotification = eventDetail[@"notification"];

  HarnessAssert(lateDelegate.didReceiveCount == lateDidReceiveBefore, testName,
                @"marked FCM Mode response was forwarded to late delegate");
  HarnessAssert(HarnessCoreEventCount() == coreEventsBefore + 1, testName,
                @"marked FCM Mode response did not emit exactly one core event");
  HarnessAssert([event[@"type"] isEqual:@1], testName,
                @"marked FCM Mode response did not emit PRESS");
  HarnessAssert([eventNotification[@"id"] isEqualToString:@"future-fcm-marked"], testName,
                @"marked FCM Mode response emitted the wrong notification payload");
  HarnessAssert([notifeeCenter.initialNotification[@"notification"][@"id"]
                    isEqualToString:@"future-fcm-marked"],
                testName, @"marked FCM Mode response did not set initialNotification");
  HarnessAssert([notifeeCenter.notificationOpenedAppID isEqualToString:@"future-fcm-marked"],
                testName, @"marked FCM Mode response did not set notificationOpenedAppID");
  HarnessAssert(completionCount == 1, testName,
                @"marked FCM Mode response completion was not exactly once");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessFutureTestDownstreamCompletionDouble(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    HarnessThirdPartyDelegate *lateDelegate, HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-downstream-completion-double";
  NSInteger failuresBefore = gFailures;
  NSInteger lateWillPresentBefore = lateDelegate.willPresentCount;
  __block NSInteger completionCount = 0;

  HarnessPrepareFutureRechainScenario(center, notifeeCenter, existingDelegate, lateDelegate, YES);
  lateDelegate.completionCallCount = 2;
  HarnessInvokeFutureRechain(notifeeCenter);

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
                  willPresentNotification:HarnessNonNotifeeNotification(@"future-double-completion")
                    withCompletionHandler:^(UNNotificationPresentationOptions options) {
                      (void)options;
                      completionCount += 1;
                    }];

  HarnessAssert(lateDelegate.willPresentCount == lateWillPresentBefore + 1, testName,
                @"double-completion downstream was not called");
  HarnessAssert(completionCount == 1, testName,
                @"downstream completion wrapper did not enforce one-shot completion");

  lateDelegate.completionCallCount = 1;

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessFutureTestRechainRefreshesSelectorFlags(
    UNUserNotificationCenter *center, NotifeeCoreUNUserNotificationCenter *notifeeCenter,
    HarnessThirdPartyDelegate *existingDelegate) {
  NSString *testName = @"rechain-refreshes-selector-flags";
  NSInteger failuresBefore = gFailures;
  HarnessDidReceiveOnlyDelegate *didReceiveOnlyDelegate = [HarnessDidReceiveOnlyDelegate new];
  NSInteger didReceiveOnlyBefore = didReceiveOnlyDelegate.didReceiveCount;
  __block NSInteger willPresentCompletionCount = 0;
  __block NSInteger didReceiveCompletionCount = 0;
  __block UNNotificationPresentationOptions receivedOptions = UNNotificationPresentationOptionNone;
  UNNotificationPresentationOptions fallbackOptions =
      UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound |
      UNNotificationPresentationOptionList | UNNotificationPresentationOptionBadge;

  HarnessPrepareFutureRechainScenario(center, notifeeCenter, existingDelegate,
                                      didReceiveOnlyDelegate, YES);
  HarnessInvokeFutureRechain(notifeeCenter);

  HarnessAssert(notifeeCenter.originalDelegate ==
                    (id<UNUserNotificationCenterDelegate>)didReceiveOnlyDelegate,
                testName, @"future rechain did not capture selector-sparse downstream delegate");

  id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
  [currentDelegate userNotificationCenter:center
                  willPresentNotification:HarnessNonNotifeeNotification(@"future-selector-will")
                    withCompletionHandler:^(UNNotificationPresentationOptions options) {
                      willPresentCompletionCount += 1;
                      receivedOptions = options;
                    }];
  [currentDelegate userNotificationCenter:center
           didReceiveNotificationResponse:HarnessNonNotifeeResponse(@"future-selector-did")
                    withCompletionHandler:^{
                      didReceiveCompletionCount += 1;
                    }];

  HarnessAssert(
      willPresentCompletionCount == 1, testName,
      @"willPresent fallback completion was not exactly once for selector-sparse downstream");
  HarnessAssert(receivedOptions == fallbackOptions, testName,
                @"willPresent fallback options were not used for selector-sparse downstream");
  HarnessAssert(didReceiveOnlyDelegate.didReceiveCount == didReceiveOnlyBefore + 1, testName,
                @"didReceive selector on selector-sparse downstream was not refreshed");
  HarnessAssert(didReceiveCompletionCount == 1, testName,
                @"didReceive completion was not exactly once for selector-sparse downstream");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessRunFutureRechainTests(UNUserNotificationCenter *center,
                                         NotifeeCoreUNUserNotificationCenter *notifeeCenter,
                                         HarnessThirdPartyDelegate *lateDelegate,
                                         HarnessThirdPartyDelegate *existingDelegate) {
  if (!HarnessShouldRunFutureRechainTests()) {
    return;
  }

  fprintf(stdout, "[delegate-chaining] INFO EXPECT_RECHAIN_FIX=1 enabled\n");
  fflush(stdout);

  if (![notifeeCenter respondsToSelector:HarnessFutureRechainSelector()]) {
    NSString *message = @"runtime rechain helper not implemented yet; expected selector "
                         "rechainUserNotificationCenterDelegate";
    NSArray<NSString *> *futureTests = @[
      @"rechain-late-delegate",
      @"rechain-idempotent",
      @"rechain-updates-downstream",
      @"rechain-notifee-owned-not-forwarded",
      @"rechain-non-notifee-forwarded",
      @"rechain-handle-remote-false-preserved",
      @"rechain-fcm-marked-remains-notifee-owned",
      @"rechain-downstream-completion-double",
      @"rechain-refreshes-selector-flags",
    ];

    for (NSString *testName in futureTests) {
      HarnessExpectedFutureFailure(testName, message);
    }
    return;
  }

  HarnessFutureTestRechainLateDelegate(center, notifeeCenter, lateDelegate, existingDelegate);
  HarnessFutureTestRechainIdempotent(center, notifeeCenter, existingDelegate);
  HarnessFutureTestRechainUpdatesDownstream(center, notifeeCenter, lateDelegate, existingDelegate);
  HarnessFutureTestNotifeeOwnedDoesNotForward(center, notifeeCenter, lateDelegate,
                                              existingDelegate);
  HarnessFutureTestNonNotifeeForwarded(center, notifeeCenter, lateDelegate, existingDelegate);
  HarnessFutureTestHandleRemoteFalsePreserved(center, notifeeCenter, lateDelegate,
                                              existingDelegate);
  HarnessFutureTestFcmMarkedRemainsNotifeeOwned(center, notifeeCenter, lateDelegate,
                                                existingDelegate);
  HarnessFutureTestDownstreamCompletionDouble(center, notifeeCenter, lateDelegate,
                                              existingDelegate);
  HarnessFutureTestRechainRefreshesSelectorFlags(center, notifeeCenter, existingDelegate);
}

// Issue #95: production delegate is exercised; the SDK proxy only bounds RED recursion.
@interface HarnessCycleProxy : NSObject <UNUserNotificationCenterDelegate>
@property(nonatomic, weak) id<UNUserNotificationCenterDelegate> next;
@property(nonatomic) NSInteger hops;
@property(nonatomic) BOOL completeBefore;
@property(nonatomic) BOOL completeAfter;
@property(nonatomic, copy) void (^pendingPresentation)(UNNotificationPresentationOptions);
@property(nonatomic, copy) void (^pendingResponse)(void);
@property(nonatomic) BOOL asynchronous;
@end
@implementation HarnessCycleProxy
- (void)step {
  if (++_hops > 12) {
    @throw [NSException exceptionWithName:@"BoundedCycle"
                                   reason:@"forwarding revisited proxy"
                                 userInfo:nil];
  }
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))done {
  [self step];
  if (_asynchronous) {
    self.pendingPresentation = done;
    return;
  }
  if (_completeBefore) done(UNNotificationPresentationOptionSound);
  [_next userNotificationCenter:center
        willPresentNotification:notification
          withCompletionHandler:done];
  if (_completeAfter) done(UNNotificationPresentationOptionBadge);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))done {
  [self step];
  if (_asynchronous) {
    self.pendingResponse = done;
    return;
  }
  if (_completeBefore) done();
  [_next userNotificationCenter:center
      didReceiveNotificationResponse:response
               withCompletionHandler:done];
  if (_completeAfter) done();
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    openSettingsForNotification:(UNNotification *)notification {
  [self step];
  [_next userNotificationCenter:center openSettingsForNotification:notification];
}
@end

static void HarnessBoundDelegateRecursion(void) {
  for (NSString *name in @[
         @"userNotificationCenter:willPresentNotification:withCompletionHandler:",
         @"userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:",
         @"userNotificationCenter:openSettingsForNotification:"
       ]) {
    SEL selector = NSSelectorFromString(name);
    Method method = class_getInstanceMethod(NotifeeCoreUNUserNotificationCenter.class, selector);
    IMP original = method_getImplementation(method);
    __block NSInteger depth = 0;
    id block;
    if ([name containsString:@"withCompletionHandler:"]) {
      block = ^(id owner, id center, id event, id done) {
        if (depth >= 12)
          @throw [NSException exceptionWithName:@"BoundedCycle"
                                         reason:@"production delegate revisited"
                                       userInfo:nil];
        depth++;
        @try {
          ((void (*)(id, SEL, id, id, id))original)(owner, selector, center, event, done);
        } @finally {
          depth--;
        }
      };
    } else {
      block = ^(id owner, id center, id event) {
        if (depth >= 12)
          @throw [NSException exceptionWithName:@"BoundedCycle"
                                         reason:@"production delegate revisited"
                                       userInfo:nil];
        depth++;
        @try {
          ((void (*)(id, SEL, id, id))original)(owner, selector, center, event);
        } @finally {
          depth--;
        }
      };
    }
    method_setImplementation(method, imp_implementationWithBlock(block));
  }
}

static void HarnessIssue95(UNUserNotificationCenter *center) {
  HarnessBoundDelegateRecursion();
  NSString *testName = @"issue95-peer-adoption-preserves-leaf";
  NSInteger before = gFailures;
  NotifeeCoreUNUserNotificationCenter *a = [NotifeeCoreUNUserNotificationCenter new];
  NotifeeCoreUNUserNotificationCenter *b = [NotifeeCoreUNUserNotificationCenter new];
  HarnessThirdPartyDelegate *leaf = [[HarnessThirdPartyDelegate alloc] initWithName:@"leaf"];
  center.delegate = leaf;
  [a observe];
  [b observe];
  [a observe];
  HarnessAssert(a.originalDelegate == leaf, testName, @"healthy leaf lost to peer adoption");
  HarnessAssert(!(a.originalDelegate == b && b.originalDelegate == a), testName,
                @"A-B-A adoption formed cycle");
  HarnessFinishTest(testName, before);

  for (NSNumber *flag in @[ @NO, @YES ]) {
    for (NSString *topology in @[ @"self", @"trusted-three", @"opaque-one", @"opaque-three" ]) {
      for (NSNumber *completionMode in @[ @0, @1, @2 ]) {
        testName = [NSString
            stringWithFormat:@"issue95-%@-flag%@-completion%@", topology, flag, completionMode];
        before = gFailures;
        a = [NotifeeCoreUNUserNotificationCenter new];
        b = [NotifeeCoreUNUserNotificationCenter new];
        NotifeeCoreUNUserNotificationCenter *c = [NotifeeCoreUNUserNotificationCenter new];
        HarnessCycleProxy *proxy = [HarnessCycleProxy new];
        proxy.completeBefore = completionMode.intValue == 1;
        proxy.completeAfter = completionMode.intValue == 2;
        a.shouldHandleRemoteNotifications = flag.boolValue;
        center.delegate = leaf;
        [a observe];
        if ([topology isEqualToString:@"self"]) a.originalDelegate = a;
        if ([topology isEqualToString:@"trusted-three"]) {
          a.originalDelegate = b;
          b.originalDelegate = c;
          c.originalDelegate = a;
        }
        if ([topology isEqualToString:@"opaque-one"]) {
          proxy.next = a;
          center.delegate = proxy;
          [a observe];
        }
        if ([topology isEqualToString:@"opaque-three"]) {
          a.originalDelegate = b;
          b.originalDelegate = c;
          c.originalDelegate = proxy;
          proxy.next = a;
        }
        UNNotification *notification = HarnessNonNotifeeNotification(@"same-id");
        UNNotificationResponse *response = HarnessNonNotifeeResponse(@"same-id");
        HarnessClearCoreEvents();
        for (NSInteger selector = 0; selector < 3; selector++) {
          proxy.hops = 0;
          __block NSInteger completions = 0;
          __block UNNotificationPresentationOptions options = 0;
          @try {
            if (selector == 0)
              [a userNotificationCenter:center
                  willPresentNotification:notification
                    withCompletionHandler:^(UNNotificationPresentationOptions value) {
                      completions++;
                      options = value;
                    }];
            if (selector == 1)
              [a userNotificationCenter:center
                  didReceiveNotificationResponse:response
                           withCompletionHandler:^{
                             completions++;
                           }];
            if (selector == 2)
              [a userNotificationCenter:center openSettingsForNotification:notification];
          } @catch (NSException *exception) {
            if (![exception.name isEqualToString:@"BoundedCycle"]) @throw;
            HarnessFail(testName, [NSString stringWithFormat:@"selector %ld recursed beyond bound",
                                                             (long)selector]);
          }
          if (selector < 2) HarnessAssert(completions == 1, testName, @"cycle must complete once");
          if (selector == 0 && [topology isEqualToString:@"opaque-one"] &&
              completionMode.intValue != 0) {
            HarnessAssert(
                options == (completionMode.intValue == 1 ? UNNotificationPresentationOptionSound
                                                         : UNNotificationPresentationOptionBadge),
                testName, @"lost already supplied downstream options");
          }
        }
        HarnessAssert(HarnessCoreEventCount() == 0, testName,
                      @"cycle emitted spurious external events");
        // Repeat the identical object after synchronous unwind: containment must be scoped to the
        // call.
        proxy.next = leaf;
        a.originalDelegate = proxy;
        proxy.hops = 0;
        __block NSInteger repeated = 0;
        [a userNotificationCenter:center
            willPresentNotification:notification
              withCompletionHandler:^(UNNotificationPresentationOptions value) {
                repeated++;
              }];
        HarnessAssert(repeated == 1 && proxy.hops == 1, testName,
                      @"sequential notification was suppressed");
        HarnessFinishTest(testName, before);
      }
    }
  }

  testName = @"issue95-async-completion-and-deallocated-leaf";
  before = gFailures;
  a = [NotifeeCoreUNUserNotificationCenter new];
  HarnessCycleProxy *async = [HarnessCycleProxy new];
  async.asynchronous = YES;
  center.delegate = async;
  [a observe];
  __block NSInteger presentations = 0, responses = 0;
  __block UNNotificationPresentationOptions received = 0;
  [a userNotificationCenter:center
      willPresentNotification:HarnessNonNotifeeNotification(@"async")
        withCompletionHandler:^(UNNotificationPresentationOptions value) {
          presentations++;
          received = value;
        }];
  [a userNotificationCenter:center
      didReceiveNotificationResponse:HarnessNonNotifeeResponse(@"async")
               withCompletionHandler:^{
                 responses++;
               }];
  HarnessAssert(presentations == 0 && responses == 0, testName, @"eager downstream completion");
  async.pendingPresentation(UNNotificationPresentationOptionSound);
  async.pendingPresentation(UNNotificationPresentationOptionBadge);
  async.pendingResponse();
  async.pendingResponse();
  HarnessAssert(
      presentations == 1 && responses == 1 && received == UNNotificationPresentationOptionSound,
      testName, @"asynchronous one-shot contract changed");
  async.pendingPresentation = nil;
  async.pendingResponse = nil;
  a.originalDelegate = nil;
  @autoreleasepool {
    HarnessThirdPartyDelegate *temporary =
        [[HarnessThirdPartyDelegate alloc] initWithName:@"temporary"];
    a.originalDelegate = temporary;
  }
  HarnessAssert(a.originalDelegate == nil, testName, @"downstream unexpectedly retained");
  [a userNotificationCenter:center
      willPresentNotification:HarnessNonNotifeeNotification(@"nil")
        withCompletionHandler:^(UNNotificationPresentationOptions value) {
          presentations++;
        }];
  HarnessAssert(presentations == 2, testName, @"deallocated leaf did not complete");
  HarnessFinishTest(testName, before);
}

@interface HarnessNestedDelegate : NSObject <UNUserNotificationCenterDelegate>
@property(nonatomic, weak) id<UNUserNotificationCenterDelegate> owner;
@property(nonatomic) BOOL inside;
@property(nonatomic) NSInteger visits;
@property(nonatomic) NSInteger nestedCompletions;
@end
@implementation HarnessNestedDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))done {
  self.visits++;
  if (!self.inside) {
    self.inside = YES;
    // Distinct object, identical identifier: it must reach this downstream too.
    [self.owner
         userNotificationCenter:center
        willPresentNotification:HarnessNonNotifeeNotification(notification.request.identifier)
          withCompletionHandler:^(UNNotificationPresentationOptions value) {
            self.nestedCompletions++;
          }];
    self.inside = NO;
  }
  done(UNNotificationPresentationOptionSound);
}
@end

static void HarnessIssue95Audit(UNUserNotificationCenter *center) {
  NSString *name = @"issue95-distinct-nested-same-id-and-selector-snapshots";
  NSInteger before = gFailures;
  NotifeeCoreUNUserNotificationCenter *a = [NotifeeCoreUNUserNotificationCenter new];
  HarnessNestedDelegate *nested = [HarnessNestedDelegate new];
  nested.owner = a;
  center.delegate = nested;
  [a observe];
  __block NSInteger completions = 0;
  [a userNotificationCenter:center
      willPresentNotification:HarnessNonNotifeeNotification(@"same-id")
        withCompletionHandler:^(UNNotificationPresentationOptions value) {
          completions++;
        }];
  HarnessAssert(nested.visits == 2 && nested.nestedCompletions == 1 && completions == 1, name,
                @"distinct nested notification was conflated with recursion");
  HarnessThirdPartyDelegate *leaf = [[HarnessThirdPartyDelegate alloc] initWithName:@"healthy"];
  NotifeeCoreUNUserNotificationCenter *b = [NotifeeCoreUNUserNotificationCenter new];
  b.originalDelegate = leaf;
  a.originalDelegate = b;
  // Another instance rechain must not overwrite this instance's selector support.
  HarnessDidReceiveOnlyDelegate *sparse = [HarnessDidReceiveOnlyDelegate new];
  NotifeeCoreUNUserNotificationCenter *other = [NotifeeCoreUNUserNotificationCenter new];
  center.delegate = sparse;
  [other observe];
  [a userNotificationCenter:center
      willPresentNotification:HarnessNonNotifeeNotification(@"leaf")
        withCompletionHandler:^(UNNotificationPresentationOptions value) {
          completions++;
        }];
  [a userNotificationCenter:center openSettingsForNotification:nil];
  HarnessAssert(leaf.willPresentCount == 1 && leaf.openSettingsCount == 1 && completions == 2, name,
                @"healthy retained peer/leaf lost callbacks");
  HarnessFinishTest(name, before);

  for (NSNumber *flag in @[ @NO, @YES ]) {
    name = [NSString stringWithFormat:@"issue95-owned-cycle-flag%@", flag];
    before = gFailures;
    a.shouldHandleRemoteNotifications = flag.boolValue;
    HarnessCycleProxy *proxy = [HarnessCycleProxy new];
    proxy.next = a;
    a.originalDelegate = proxy;
    HarnessClearCoreEvents();
    __block NSInteger ownedCompletions = 0;
    [a userNotificationCenter:center
        willPresentNotification:HarnessNotifeeNotification(@"local")
          withCompletionHandler:^(UNNotificationPresentationOptions value) {
            ownedCompletions++;
          }];
    [a userNotificationCenter:center
        didReceiveNotificationResponse:HarnessNotifeeResponse(@"trigger")
                 withCompletionHandler:^{
                   ownedCompletions++;
                 }];
    [a userNotificationCenter:center
        didReceiveNotificationResponse:HarnessFcmResponse(@"physical", @"logical",
                                                          UNNotificationDefaultActionIdentifier)
                 withCompletionHandler:^{
                   ownedCompletions++;
                 }];
    HarnessAssert(ownedCompletions == 3 && HarnessCoreEventCount() == 3 && proxy.hops == 0, name,
                  @"owned local/trigger/FCM paths changed under cycle state");
    HarnessFinishTest(name, before);
  }
}

int main(void) {
  @autoreleasepool {
    HarnessInstallUserNotificationCenterStub();
    if (gFailures > 0) {
      return 1;
    }

    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    center.delegate = nil;

    HarnessThirdPartyDelegate *existingDelegate =
        [[HarnessThirdPartyDelegate alloc] initWithName:@"existing"];
    HarnessThirdPartyDelegate *lateDelegate =
        [[HarnessThirdPartyDelegate alloc] initWithName:@"late"];

    center.delegate = existingDelegate;

    NotifeeCoreUNUserNotificationCenter *notifeeCenter =
        [NotifeeCoreUNUserNotificationCenter instance];
    [notifeeCenter observe];

    HarnessTestCapturesExistingDelegate(center, notifeeCenter, existingDelegate);
    HarnessTestForwardsNonNotifeeWillPresent(center, existingDelegate);
    HarnessTestForwardsNonNotifeeDidReceive(center, existingDelegate);
    HarnessTestForwardsOpenSettings(center, existingDelegate);
    HarnessTestCompletionCalledOnceInCoveredPaths(center, existingDelegate);
    HarnessTestFcmLogicalIdInPressEvents(center);
    HarnessTestLateDelegateOverridesNotifyKit(center, notifeeCenter, lateDelegate,
                                              existingDelegate);
    HarnessTestHandleRemoteFlagDoesNotRechain(center, notifeeCenter, lateDelegate,
                                              existingDelegate);
    HarnessRunFutureRechainTests(center, notifeeCenter, lateDelegate, existingDelegate);

    HarnessIssue95(center);
    HarnessIssue95Audit(center);
    center.delegate = nil;
  }

  if (gFailures > 0) {
    fflush(stdout);
    fprintf(stderr, "[delegate-chaining] FAIL %ld harness failure(s)\n", (long)gFailures);
    return 1;
  }

  fprintf(stdout, "[delegate-chaining] PASS all\n");
  fflush(stdout);
  return 0;
}
