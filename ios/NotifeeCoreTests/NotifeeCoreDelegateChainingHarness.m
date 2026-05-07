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
    HarnessTestLateDelegateOverridesNotifyKit(center, notifeeCenter, lateDelegate,
                                              existingDelegate);
    HarnessTestHandleRemoteFlagDoesNotRechain(center, notifeeCenter, lateDelegate,
                                              existingDelegate);
    HarnessRunFutureRechainTests(center, notifeeCenter, lateDelegate, existingDelegate);

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
