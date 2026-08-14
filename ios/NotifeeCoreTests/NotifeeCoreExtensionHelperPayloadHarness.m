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

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>
#import "NotifeeCore.h"
#import "NotifeeCoreExtensionHelper.h"
#import "NotifeeCoreUtil.h"

static NSString *const kHarnessOriginalTitle = @"Original title";
static NSString *const kHarnessOriginalBody = @"Original body";
static NSString *const kHarnessRequestIdentifier = @"harness-request-id";

typedef void (^HarnessAttachmentCompletion)(UNNotificationAttachment *attachment);
typedef void (^HarnessFinalizer)(void);

static NSInteger gFailures = 0;
static NSDictionary *gLastBuiltNotification = nil;
static UNMutableNotificationContent *gLastBuiltContent = nil;
static BOOL gCaptureAttachmentDownloads = NO;
static NSMutableArray *gPendingAttachmentCompletions = nil;
static NSObject *gHarnessStateLock = nil;
static NSMutableArray<NSString *> *gOrchestrationEvents = nil;
static BOOL gBlockCommunicationGeneration = NO;
static dispatch_semaphore_t gCommunicationStartedSemaphore = nil;
static dispatch_semaphore_t gCommunicationReleaseSemaphore = nil;
static dispatch_time_t gLastCommunicationMediaCutoff = 0;
static NSTimeInterval gHarnessOrchestrationTimeoutInterval = 25.0;
static BOOL gUseControlledTime = NO;
static dispatch_time_t gControlledTime = 0;
static BOOL gCaptureFinalizers = NO;
static NSMutableArray<HarnessFinalizer> *gPendingFinalizers = nil;
static NSMutableArray<NSNumber *> *gPendingFinalizerDeadlines = nil;
static BOOL gProviderShouldFail = NO;
static BOOL gBlockProvider = NO;
static dispatch_semaphore_t gProviderStartedSemaphore = nil;
static dispatch_semaphore_t gProviderReleaseSemaphore = nil;
static NSInteger gProviderCallCount = 0;
static UNNotificationContent *gLastProviderInputContent = nil;
static NSInteger gDonationCallCount = 0;

@interface NotifeeCoreExtensionHelper (PayloadHarness)
- (NSTimeInterval)orchestrationTimeoutInterval;
- (dispatch_time_t)orchestrationCurrentTime;
- (void)scheduleOrchestrationFinalizerAtDeadline:(dispatch_time_t)deadline
                                           block:(dispatch_block_t)block;
- (void)loadAttachment:(NSDictionary *)attachmentDict
     completionHandler:(void (^)(UNNotificationAttachment *))completionHandler;
@end

@interface NotifeeCoreUtil (PayloadHarnessDeadline)
+ (INSendMessageIntent *)generateSenderIntentForCommunicationNotification:
                             (NSDictionary *)communicationInfo
                                                                 deadline:(dispatch_time_t)deadline;
@end

static void HarnessRecordOrchestrationEvent(NSString *event) {
  @synchronized(gHarnessStateLock) {
    [gOrchestrationEvents addObject:event];
  }
}

static INSendMessageIntent *HarnessCommunicationIntent(void) {
  INPersonHandle *personHandle = [[INPersonHandle alloc] initWithValue:@"harness-sender"
                                                                  type:INPersonHandleTypeUnknown];
  INPerson *sender = [[INPerson alloc] initWithPersonHandle:personHandle
                                             nameComponents:nil
                                                displayName:@"Harness Sender"
                                                      image:nil
                                          contactIdentifier:nil
                                           customIdentifier:nil];
  return [[INSendMessageIntent alloc] initWithRecipients:nil
                                     outgoingMessageType:INOutgoingMessageTypeOutgoingMessageText
                                                 content:@"Harness body"
                                      speakableGroupName:nil
                                  conversationIdentifier:@"harness-conversation"
                                             serviceName:nil
                                                  sender:sender
                                             attachments:nil];
}

@implementation NotifeeCore

+ (UNMutableNotificationContent *)buildNotificationContent:(NSDictionary *)notification
                                               withTrigger:(NSDictionary *)trigger {
  @synchronized(gHarnessStateLock) {
    gLastBuiltNotification = [notification copy];
  }

  UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
  if ([notification[@"title"] isKindOfClass:[NSString class]]) {
    content.title = notification[@"title"];
  }
  if ([notification[@"body"] isKindOfClass:[NSString class]]) {
    content.body = notification[@"body"];
  }
  if ([notification[@"data"] isKindOfClass:[NSDictionary class]]) {
    content.userInfo = notification[@"data"];
  }

  @synchronized(gHarnessStateLock) {
    gLastBuiltContent = content;
  }

  return content;
}

@end

@implementation NotifeeCoreUtil

+ (INSendMessageIntent *)generateSenderIntentForCommunicationNotification:
    (NSMutableDictionary *)options {
  return [self generateSenderIntentForCommunicationNotification:options
                                                       deadline:DISPATCH_TIME_FOREVER];
}

+ (INSendMessageIntent *)
    generateSenderIntentForCommunicationNotification:(NSDictionary *)communicationInfo
                                            deadline:(dispatch_time_t)deadline {
  (void)communicationInfo;

  dispatch_semaphore_t startedSemaphore = nil;
  dispatch_semaphore_t releaseSemaphore = nil;
  BOOL shouldBlock = NO;
  @synchronized(gHarnessStateLock) {
    gLastCommunicationMediaCutoff = deadline;
    startedSemaphore = gCommunicationStartedSemaphore;
    releaseSemaphore = gCommunicationReleaseSemaphore;
    shouldBlock = gBlockCommunicationGeneration;
  }
  HarnessRecordOrchestrationEvent(@"communication-start");

  if (startedSemaphore != nil) {
    dispatch_semaphore_signal(startedSemaphore);
  }
  if (shouldBlock && releaseSemaphore != nil) {
    dispatch_semaphore_wait(releaseSemaphore, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
  }

  return HarnessCommunicationIntent();
}

+ (NSDictionary *)attachmentOptionsFromDictionary:(NSDictionary *)optionsDict {
  return @{};
}

@end

static void HarnessFail(NSString *testName, NSString *message) {
  gFailures += 1;
  fprintf(stderr, "FAIL %s: %s\n", testName.UTF8String, message.UTF8String);
}

static void HarnessPass(NSString *testName) { fprintf(stdout, "PASS %s\n", testName.UTF8String); }

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

static void HarnessInstallPrivateOrchestrationSeams(void) {
  Method method = class_getInstanceMethod([NotifeeCoreExtensionHelper class],
                                          @selector(orchestrationTimeoutInterval));
  if (method == NULL) {
    HarnessFail(@"timeoutStub", @"orchestrationTimeoutInterval was not found");
    return;
  }

  IMP stubImp = imp_implementationWithBlock(^NSTimeInterval(NotifeeCoreExtensionHelper *helper) {
    (void)helper;
    @synchronized(gHarnessStateLock) {
      return gHarnessOrchestrationTimeoutInterval;
    }
  });
  method_setImplementation(method, stubImp);

  Method clockMethod = class_getInstanceMethod([NotifeeCoreExtensionHelper class],
                                               @selector(orchestrationCurrentTime));
  if (clockMethod == NULL) {
    HarnessFail(@"clockStub", @"orchestrationCurrentTime was not found");
  } else {
    IMP clockImp =
        imp_implementationWithBlock(^dispatch_time_t(NotifeeCoreExtensionHelper *helper) {
          (void)helper;
          @synchronized(gHarnessStateLock) {
            if (gUseControlledTime) {
              return gControlledTime;
            }
          }
          return dispatch_time(DISPATCH_TIME_NOW, 0);
        });
    method_setImplementation(clockMethod, clockImp);
  }

  Method schedulerMethod = class_getInstanceMethod(
      [NotifeeCoreExtensionHelper class], @selector(scheduleOrchestrationFinalizerAtDeadline:
                                                                                       block:));
  if (schedulerMethod == NULL) {
    HarnessFail(@"schedulerStub", @"scheduleOrchestrationFinalizerAtDeadline:block: was not found");
  } else {
    IMP schedulerImp = imp_implementationWithBlock(
        ^(NotifeeCoreExtensionHelper *helper, dispatch_time_t deadline, dispatch_block_t block) {
          (void)helper;
          @synchronized(gHarnessStateLock) {
            if (gCaptureFinalizers) {
              [gPendingFinalizerDeadlines addObject:@(deadline)];
              [gPendingFinalizers addObject:[block copy]];
              return;
            }
          }
          dispatch_after(deadline, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), block);
        });
    method_setImplementation(schedulerMethod, schedulerImp);
  }
}

static void HarnessInstallNotificationFrameworkStubs(void) {
  Method providerMethod = class_getInstanceMethod([UNNotificationContent class],
                                                  @selector(contentByUpdatingWithProvider:error:));
  if (providerMethod == NULL) {
    HarnessFail(@"providerStub", @"contentByUpdatingWithProvider:error: was not found");
  } else {
    IMP providerImp = imp_implementationWithBlock(
        ^UNNotificationContent *(UNNotificationContent *content, id provider, NSError **error) {
          (void)provider;
          BOOL shouldFail = NO;
          BOOL shouldBlock = NO;
          dispatch_semaphore_t startedSemaphore = nil;
          dispatch_semaphore_t releaseSemaphore = nil;
          @synchronized(gHarnessStateLock) {
            gLastProviderInputContent = content;
            shouldFail = gProviderShouldFail;
            shouldBlock = gBlockProvider;
            startedSemaphore = gProviderStartedSemaphore;
            releaseSemaphore = gProviderReleaseSemaphore;
            gProviderCallCount += 1;
          }

          if (startedSemaphore != nil) {
            dispatch_semaphore_signal(startedSemaphore);
          }
          if (shouldBlock && releaseSemaphore != nil) {
            dispatch_semaphore_wait(releaseSemaphore,
                                    dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
          }

          if (shouldFail) {
            if (error != NULL) {
              *error = [NSError errorWithDomain:@"NotifeeCoreExtensionHelperPayloadHarness"
                                           code:1
                                       userInfo:nil];
            }
            return nil;
          }

          UNMutableNotificationContent *updatedContent = [content mutableCopy];
          updatedContent.title = [updatedContent.title stringByAppendingString:@" [provider]"];
          return updatedContent;
        });
    method_setImplementation(providerMethod, providerImp);
  }

  Method donationMethod =
      class_getInstanceMethod([INInteraction class], @selector(donateInteractionWithCompletion:));
  if (donationMethod == NULL) {
    HarnessFail(@"donationStub", @"donateInteractionWithCompletion: was not found");
  } else {
    IMP donationImp = imp_implementationWithBlock(
        ^(INInteraction *interaction, void (^completion)(NSError *error)) {
          (void)interaction;
          @synchronized(gHarnessStateLock) {
            gDonationCallCount += 1;
          }
          if (completion != nil) {
            completion(nil);
          }
        });
    method_setImplementation(donationMethod, donationImp);
  }
}

static void HarnessResetOrchestrationState(void) {
  @synchronized(gHarnessStateLock) {
    [gOrchestrationEvents removeAllObjects];
    gBlockCommunicationGeneration = NO;
    gCommunicationStartedSemaphore = nil;
    gCommunicationReleaseSemaphore = nil;
    gLastCommunicationMediaCutoff = 0;
    gHarnessOrchestrationTimeoutInterval = 25.0;
    gUseControlledTime = NO;
    gControlledTime = 0;
    gCaptureFinalizers = NO;
    [gPendingFinalizers removeAllObjects];
    [gPendingFinalizerDeadlines removeAllObjects];
    gProviderShouldFail = NO;
    gBlockProvider = NO;
    gProviderStartedSemaphore = nil;
    gProviderReleaseSemaphore = nil;
    gProviderCallCount = 0;
    gLastProviderInputContent = nil;
    gLastBuiltContent = nil;
    gDonationCallCount = 0;
  }
}

static NSArray<NSString *> *HarnessOrchestrationEvents(void) {
  @synchronized(gHarnessStateLock) {
    return [gOrchestrationEvents copy];
  }
}

static NSObject *HarnessFakeAttachment(void) { return [[NSObject alloc] init]; }

static UNMutableNotificationContent *HarnessContentWithUserInfo(NSDictionary *userInfo) {
  UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
  content.title = kHarnessOriginalTitle;
  content.body = kHarnessOriginalBody;
  content.userInfo = userInfo;
  return content;
}

static NSDictionary *HarnessUserInfoWithOptions(id options) {
  return @{kPayloadOptionsName : options};
}

@interface HarnessResult : NSObject
@property(nonatomic, assign) NSInteger handlerCallCount;
@property(nonatomic, strong) UNNotificationContent *deliveredContent;
@property(nonatomic, strong) NSException *exception;
@property(nonatomic, strong) UNMutableNotificationContent *originalContent;
@property(nonatomic, strong) NSDictionary *builtNotification;
@property(nonatomic, strong) UNMutableNotificationContent *builtContent;
@property(nonatomic, strong) dispatch_semaphore_t handlerCalledSemaphore;
@property(nonatomic, strong) dispatch_semaphore_t invocationFinishedSemaphore;
@end

@implementation HarnessResult
@end

static void HarnessCaptureBuiltContent(HarnessResult *result) {
  @synchronized(gHarnessStateLock) {
    result.builtNotification = gLastBuiltNotification;
    result.builtContent = gLastBuiltContent;
  }
}

static HarnessResult *HarnessStartInvocationWithRequestIdentifier(id options,
                                                                  BOOL includeOptionsKey,
                                                                  NSString *requestIdentifier,
                                                                  BOOL asynchronously) {
  @synchronized(gHarnessStateLock) {
    gLastBuiltNotification = nil;
    gLastBuiltContent = nil;
  }

  NSDictionary *userInfo = includeOptionsKey ? HarnessUserInfoWithOptions(options) : @{};
  UNMutableNotificationContent *content = HarnessContentWithUserInfo(userInfo);
  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:requestIdentifier
                                                                        content:content
                                                                        trigger:nil];

  HarnessResult *result = [[HarnessResult alloc] init];
  result.originalContent = content;
  result.handlerCalledSemaphore = dispatch_semaphore_create(0);
  result.invocationFinishedSemaphore = dispatch_semaphore_create(0);

  NotifeeCoreExtensionHelper *helper = [NotifeeCoreExtensionHelper instance];
  void (^invokeBlock)(void) = ^{
    @try {
      [helper populateNotificationContent:request
                              withContent:content
                       withContentHandler:^(UNNotificationContent *contentFromHandler) {
                         @synchronized(result) {
                           result.handlerCallCount += 1;
                           result.deliveredContent = contentFromHandler;
                         }
                         dispatch_semaphore_signal(result.handlerCalledSemaphore);
                       }];
    } @catch (NSException *caughtException) {
      @synchronized(result) {
        result.exception = caughtException;
      }
    }

    HarnessCaptureBuiltContent(result);
    dispatch_semaphore_signal(result.invocationFinishedSemaphore);
  };

  if (asynchronously) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), invokeBlock);
  } else {
    invokeBlock();
  }

  return result;
}

static HarnessResult *HarnessInvokeWithRequestIdentifier(id options, BOOL includeOptionsKey,
                                                         NSString *requestIdentifier) {
  return HarnessStartInvocationWithRequestIdentifier(options, includeOptionsKey, requestIdentifier,
                                                     NO);
}

static HarnessResult *HarnessInvoke(id options, BOOL includeOptionsKey) {
  return HarnessInvokeWithRequestIdentifier(options, includeOptionsKey, kHarnessRequestIdentifier);
}

static BOOL HarnessWaitForSemaphore(dispatch_semaphore_t semaphore, NSTimeInterval timeout) {
  return dispatch_semaphore_wait(
             semaphore, dispatch_time(DISPATCH_TIME_NOW,
                                      (int64_t)(timeout * (NSTimeInterval)NSEC_PER_SEC))) == 0;
}

static NSInteger HarnessHandlerCallCount(HarnessResult *result) {
  @synchronized(result) {
    return result.handlerCallCount;
  }
}

static UNNotificationContent *HarnessDeliveredContent(HarnessResult *result) {
  @synchronized(result) {
    return result.deliveredContent;
  }
}

static void HarnessAssertDeliveredOnce(HarnessResult *result, NSString *testName) {
  HarnessAssert(result.exception == nil, testName, @"helper threw an Objective-C exception");
  HarnessAssert(result.handlerCallCount == 1, testName, @"contentHandler was not called once");
  HarnessAssert(result.deliveredContent != nil, testName, @"contentHandler received nil content");
}

static void HarnessAssertOriginalFallback(HarnessResult *result, NSString *testName) {
  HarnessAssert(result.deliveredContent == result.originalContent, testName,
                @"malformed payload did not deliver the original mutable content");
  HarnessAssert([result.deliveredContent.title isEqualToString:kHarnessOriginalTitle], testName,
                @"fallback title changed");
  HarnessAssert([result.deliveredContent.body isEqualToString:kHarnessOriginalBody], testName,
                @"fallback body changed");
  HarnessAssert(result.builtNotification == nil, testName,
                @"malformed payload unexpectedly reached content rebuild");
}

static void HarnessAssertBuiltNotification(HarnessResult *result, NSString *testName,
                                           NSString *title, NSString *body,
                                           NSString *requestIdentifier) {
  HarnessAssert(result.builtNotification != nil, testName,
                @"valid payload did not reach content rebuild");
  HarnessAssert([result.builtNotification[@"remote"] isEqual:@YES], testName,
                @"valid payload did not mark notification as remote");
  HarnessAssert([result.builtNotification[@"id"] isEqualToString:requestIdentifier], testName,
                @"valid payload did not default id from request");
  HarnessAssert([result.builtNotification[@"title"] isEqualToString:title], testName,
                @"rebuilt title did not match payload");
  HarnessAssert([result.builtNotification[@"body"] isEqualToString:body], testName,
                @"rebuilt body did not match payload");
  HarnessAssert([result.builtNotification[@"data"] isKindOfClass:[NSDictionary class]], testName,
                @"valid payload did not default data to a dictionary");
}

static NSDictionary *HarnessPayload(NSString *title, NSString *body) {
  return @{@"title" : title, @"body" : body};
}

static NSDictionary *HarnessAttachmentPayload(NSString *title, NSString *body,
                                              NSString *attachmentIdentifier) {
  return @{
    @"title" : title,
    @"body" : body,
    @"ios" : @{
      @"attachments" : @[
        @{@"id" : attachmentIdentifier, @"url" : @"https://example.invalid/notifee-harness.png"}
      ]
    }
  };
}

static NSDictionary *HarnessCommunicationPayload(NSString *title, NSString *body,
                                                 NSString *attachmentIdentifier) {
  NSMutableDictionary *ios = [@{
    @"communicationInfo" : @{
      @"conversationId" : @"harness-conversation",
      @"sender" : @{
        @"id" : @"harness-sender",
        @"displayName" : @"Harness Sender",
      },
    },
  } mutableCopy];

  if (attachmentIdentifier != nil) {
    ios[@"attachments"] =
        @[ @{@"id" : attachmentIdentifier, @"url" : @"https://example.invalid/harness.png"} ];
  }

  return @{@"title" : title, @"body" : body, @"ios" : ios};
}

static void HarnessBlockCommunicationGeneration(void) {
  @synchronized(gHarnessStateLock) {
    gBlockCommunicationGeneration = YES;
    gCommunicationStartedSemaphore = dispatch_semaphore_create(0);
    gCommunicationReleaseSemaphore = dispatch_semaphore_create(0);
  }
}

static BOOL HarnessWaitForCommunicationStart(NSTimeInterval timeout) {
  dispatch_semaphore_t semaphore = nil;
  @synchronized(gHarnessStateLock) {
    semaphore = gCommunicationStartedSemaphore;
  }
  return semaphore != nil && HarnessWaitForSemaphore(semaphore, timeout);
}

static void HarnessReleaseCommunicationGeneration(void) {
  dispatch_semaphore_t semaphore = nil;
  @synchronized(gHarnessStateLock) {
    semaphore = gCommunicationReleaseSemaphore;
  }
  if (semaphore != nil) {
    dispatch_semaphore_signal(semaphore);
  }
}

static void HarnessBeginControlledOrchestration(dispatch_time_t startTime) {
  @synchronized(gHarnessStateLock) {
    gUseControlledTime = YES;
    gControlledTime = startTime;
    gCaptureFinalizers = YES;
    [gPendingFinalizers removeAllObjects];
    [gPendingFinalizerDeadlines removeAllObjects];
  }
}

static void HarnessSetControlledTime(dispatch_time_t currentTime) {
  @synchronized(gHarnessStateLock) {
    gControlledTime = currentTime;
  }
}

static NSUInteger HarnessPendingFinalizerCount(void) {
  @synchronized(gHarnessStateLock) {
    return [gPendingFinalizers count];
  }
}

static dispatch_time_t HarnessPendingFinalizerDeadlineAtIndex(NSUInteger index) {
  @synchronized(gHarnessStateLock) {
    if ([gPendingFinalizerDeadlines count] <= index) {
      return 0;
    }
    return [gPendingFinalizerDeadlines[index] unsignedLongLongValue];
  }
}

static HarnessFinalizer HarnessPendingFinalizerAtIndex(NSUInteger index) {
  @synchronized(gHarnessStateLock) {
    if ([gPendingFinalizers count] <= index) {
      return nil;
    }
    return [gPendingFinalizers[index] copy];
  }
}

static void HarnessBlockProviderCompletion(void) {
  @synchronized(gHarnessStateLock) {
    gBlockProvider = YES;
    gProviderStartedSemaphore = dispatch_semaphore_create(0);
    gProviderReleaseSemaphore = dispatch_semaphore_create(0);
  }
}

static BOOL HarnessWaitForProviderStart(NSTimeInterval timeout) {
  dispatch_semaphore_t semaphore = nil;
  @synchronized(gHarnessStateLock) {
    semaphore = gProviderStartedSemaphore;
  }
  return semaphore != nil && HarnessWaitForSemaphore(semaphore, timeout);
}

static void HarnessReleaseProviderCompletion(void) {
  dispatch_semaphore_t semaphore = nil;
  @synchronized(gHarnessStateLock) {
    semaphore = gProviderReleaseSemaphore;
  }
  if (semaphore != nil) {
    dispatch_semaphore_signal(semaphore);
  }
}

static NSInteger HarnessProviderCallCount(void) {
  @synchronized(gHarnessStateLock) {
    return gProviderCallCount;
  }
}

static NSInteger HarnessDonationCallCount(void) {
  @synchronized(gHarnessStateLock) {
    return gDonationCallCount;
  }
}

static void HarnessInstallAttachmentStub(void) {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    Method method = class_getInstanceMethod([NotifeeCoreExtensionHelper class],
                                            @selector(loadAttachment:completionHandler:));
    if (method == NULL) {
      HarnessFail(@"attachmentStub", @"loadAttachment:completionHandler: was not found");
      return;
    }

    IMP stubImp = imp_implementationWithBlock(
        ^(NotifeeCoreExtensionHelper *helper, NSDictionary *attachmentDict,
          void (^completionHandler)(UNNotificationAttachment *attachment)) {
          (void)helper;
          (void)attachmentDict;

          HarnessRecordOrchestrationEvent(@"attachment-start");

          @synchronized(gHarnessStateLock) {
            if (gCaptureAttachmentDownloads) {
              if (gPendingAttachmentCompletions == nil) {
                gPendingAttachmentCompletions = [NSMutableArray new];
              }
              [gPendingAttachmentCompletions addObject:[completionHandler copy]];
              return;
            }
          }

          completionHandler(nil);
        });
    method_setImplementation(method, stubImp);
  });
}

static void HarnessBeginCapturingAttachments(void) {
  HarnessInstallAttachmentStub();
  @synchronized(gHarnessStateLock) {
    gCaptureAttachmentDownloads = YES;
    if (gPendingAttachmentCompletions == nil) {
      gPendingAttachmentCompletions = [NSMutableArray new];
    }
    [gPendingAttachmentCompletions removeAllObjects];
  }
}

static void HarnessEndCapturingAttachments(void) {
  @synchronized(gHarnessStateLock) {
    gCaptureAttachmentDownloads = NO;
    [gPendingAttachmentCompletions removeAllObjects];
  }
}

static HarnessAttachmentCompletion HarnessPendingAttachmentCompletionAtIndex(NSUInteger index) {
  @synchronized(gHarnessStateLock) {
    if (gPendingAttachmentCompletions == nil || [gPendingAttachmentCompletions count] <= index) {
      return nil;
    }

    return [gPendingAttachmentCompletions[index] copy];
  }
}

static NSUInteger HarnessPendingAttachmentCompletionCount(void) {
  @synchronized(gHarnessStateLock) {
    return [gPendingAttachmentCompletions count];
  }
}

static void TestMissingNotifeeOptionsDeliversOriginalContentOnce(void) {
  NSString *testName = @"testMissingNotifeeOptionsDeliversOriginalContentOnce";
  NSInteger failuresBefore = gFailures;
  HarnessResult *result = HarnessInvoke(nil, NO);

  HarnessAssertDeliveredOnce(result, testName);
  HarnessAssertOriginalFallback(result, testName);
  HarnessFinishTest(testName, failuresBefore);
}

static void TestLegacyDictionaryNotifeeOptionsDeliversMutatedContent(void) {
  NSString *testName = @"testLegacyDictionaryNotifeeOptionsDeliversMutatedContent";
  NSInteger failuresBefore = gFailures;
  NSDictionary *payload = @{@"title" : @"Legacy title", @"body" : @"Legacy body"};
  HarnessResult *result = HarnessInvoke(payload, YES);

  HarnessAssertDeliveredOnce(result, testName);
  HarnessAssert(result.deliveredContent != result.originalContent, testName,
                @"valid dictionary payload should rebuild notification content");
  HarnessAssert([result.deliveredContent.title isEqualToString:@"Legacy title"], testName,
                @"legacy dictionary title was not delivered");
  HarnessAssert([result.deliveredContent.body isEqualToString:@"Legacy body"], testName,
                @"legacy dictionary body was not delivered");
  HarnessAssertBuiltNotification(result, testName, @"Legacy title", @"Legacy body",
                                 kHarnessRequestIdentifier);
  HarnessFinishTest(testName, failuresBefore);
}

static void TestJsonStringDictionaryNotifeeOptionsDeliversMutatedContent(void) {
  NSString *testName = @"testJsonStringDictionaryNotifeeOptionsDeliversMutatedContent";
  NSInteger failuresBefore = gFailures;
  NSString *payload = @"{\"title\":\"JSON title\",\"body\":\"JSON body\"}";
  HarnessResult *result = HarnessInvoke(payload, YES);

  HarnessAssertDeliveredOnce(result, testName);
  HarnessAssert(result.deliveredContent != result.originalContent, testName,
                @"valid JSON string payload should rebuild notification content");
  HarnessAssert([result.deliveredContent.title isEqualToString:@"JSON title"], testName,
                @"JSON string title was not delivered");
  HarnessAssert([result.deliveredContent.body isEqualToString:@"JSON body"], testName,
                @"JSON string body was not delivered");
  HarnessAssertBuiltNotification(result, testName, @"JSON title", @"JSON body",
                                 kHarnessRequestIdentifier);
  HarnessFinishTest(testName, failuresBefore);
}

static void TestInvalidJsonStringFallsBackToOriginalContent(void) {
  NSString *testName = @"testInvalidJsonStringFallsBackToOriginalContent";
  NSInteger failuresBefore = gFailures;
  HarnessResult *result = HarnessInvoke(@"{broken", YES);

  HarnessAssertDeliveredOnce(result, testName);
  HarnessAssertOriginalFallback(result, testName);
  HarnessFinishTest(testName, failuresBefore);
}

static void TestJsonStringArrayFallsBackToOriginalContent(void) {
  NSString *testName = @"testJsonStringArrayFallsBackToOriginalContent";
  NSInteger failuresBefore = gFailures;
  HarnessResult *result = HarnessInvoke(@"[]", YES);

  HarnessAssertDeliveredOnce(result, testName);
  HarnessAssertOriginalFallback(result, testName);
  HarnessFinishTest(testName, failuresBefore);
}

static void TestUnexpectedNotifeeOptionsTypesFallBackToOriginalContent(void) {
  NSString *testName = @"testUnexpectedNotifeeOptionsTypesFallBackToOriginalContent";
  NSInteger failuresBefore = gFailures;
  NSArray *payloads = @[ @42, @[ @"array" ], [NSNull null] ];

  for (id payload in payloads) {
    HarnessResult *result = HarnessInvoke(payload, YES);
    HarnessAssertDeliveredOnce(result, testName);
    HarnessAssertOriginalFallback(result, testName);
  }

  HarnessFinishTest(testName, failuresBefore);
}

static void TestSequentialRequestsRemainIndependent(void) {
  NSString *testName = @"testSequentialRequestsRemainIndependent";
  NSInteger failuresBefore = gFailures;

  HarnessResult *resultA = HarnessInvokeWithRequestIdentifier(
      HarnessPayload(@"Request A title", @"Request A body"), YES, @"request-a");
  HarnessResult *resultB = HarnessInvokeWithRequestIdentifier(
      HarnessPayload(@"Request B title", @"Request B body"), YES, @"request-b");

  HarnessAssertDeliveredOnce(resultA, testName);
  HarnessAssertDeliveredOnce(resultB, testName);
  HarnessAssert([resultA.deliveredContent.title isEqualToString:@"Request A title"], testName,
                @"request A title changed after request B");
  HarnessAssert([resultA.deliveredContent.body isEqualToString:@"Request A body"], testName,
                @"request A body changed after request B");
  HarnessAssert([resultB.deliveredContent.title isEqualToString:@"Request B title"], testName,
                @"request B title was not delivered");
  HarnessAssert([resultB.deliveredContent.body isEqualToString:@"Request B body"], testName,
                @"request B body was not delivered");
  HarnessAssert(![resultA.deliveredContent.title isEqualToString:resultB.deliveredContent.title],
                testName, @"request A and B delivered the same title");
  HarnessAssertBuiltNotification(resultA, testName, @"Request A title", @"Request A body",
                                 @"request-a");
  HarnessAssertBuiltNotification(resultB, testName, @"Request B title", @"Request B body",
                                 @"request-b");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestAttachmentCompletionIsOneShotPerRequest(void) {
  NSString *testName = @"testAttachmentCompletionIsOneShotPerRequest";
  NSInteger failuresBefore = gFailures;

  HarnessBeginCapturingAttachments();
  HarnessResult *resultA = HarnessInvokeWithRequestIdentifier(
      HarnessAttachmentPayload(@"One-shot A title", @"One-shot A body", @"one-shot-a"), YES,
      @"one-shot-a");

  HarnessAssert(resultA.exception == nil, testName, @"request A threw an Objective-C exception");
  HarnessAssert(resultA.handlerCallCount == 0, testName,
                @"request A delivered before attachment completion");
  HarnessAssert(HarnessPendingAttachmentCompletionCount() == 1, testName,
                @"request A did not leave exactly one pending attachment completion");

  HarnessAttachmentCompletion completionA = HarnessPendingAttachmentCompletionAtIndex(0);
  if (completionA != nil) {
    completionA(nil);
    completionA(nil);
  }
  HarnessEndCapturingAttachments();

  HarnessAssert(resultA.handlerCallCount == 1, testName,
                @"request A contentHandler was not one-shot");
  HarnessAssert([resultA.deliveredContent.title isEqualToString:@"One-shot A title"], testName,
                @"request A delivered the wrong title");

  HarnessResult *resultB = HarnessInvokeWithRequestIdentifier(
      HarnessPayload(@"One-shot B title", @"One-shot B body"), YES, @"one-shot-b");
  HarnessAssertDeliveredOnce(resultB, testName);
  HarnessAssert([resultB.deliveredContent.title isEqualToString:@"One-shot B title"], testName,
                @"request B was blocked by request A one-shot state");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestLateAttachmentCompletionUsesOriginalRequestContext(void) {
  NSString *testName = @"testLateAttachmentCompletionUsesOriginalRequestContext";
  NSInteger failuresBefore = gFailures;

  HarnessBeginCapturingAttachments();
  HarnessResult *resultA = HarnessInvokeWithRequestIdentifier(
      HarnessAttachmentPayload(@"Late A title", @"Late A body", @"late-a"), YES, @"late-a");
  HarnessAttachmentCompletion completionA = HarnessPendingAttachmentCompletionAtIndex(0);

  HarnessResult *resultB = HarnessInvokeWithRequestIdentifier(
      HarnessPayload(@"Late B title", @"Late B body"), YES, @"late-b");

  HarnessAssert(resultA.exception == nil, testName, @"request A threw an Objective-C exception");
  HarnessAssert(resultA.handlerCallCount == 0, testName,
                @"request A delivered before its attachment completion");
  HarnessAssertDeliveredOnce(resultB, testName);
  HarnessAssert([resultB.deliveredContent.title isEqualToString:@"Late B title"], testName,
                @"request B did not deliver its own content before request A completion");

  if (completionA != nil) {
    completionA(nil);
  }
  HarnessEndCapturingAttachments();

  HarnessAssert(resultA.handlerCallCount == 1, testName,
                @"late request A completion did not deliver request A once");
  HarnessAssert(resultB.handlerCallCount == 1, testName,
                @"late request A completion changed request B delivery count");
  HarnessAssert([resultA.deliveredContent.title isEqualToString:@"Late A title"], testName,
                @"late request A completion delivered request B title");
  HarnessAssert([resultB.deliveredContent.title isEqualToString:@"Late B title"], testName,
                @"request B title changed after late request A completion");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestAttachmentStartsBeforeCommunicationAndAttachmentFirstCompletion(void) {
  NSString *testName = @"testAttachmentStartsBeforeCommunicationAndAttachmentFirstCompletion";
  NSInteger failuresBefore = gFailures;

  HarnessResetOrchestrationState();
  HarnessBeginCapturingAttachments();
  HarnessBlockCommunicationGeneration();

  HarnessResult *result = HarnessStartInvocationWithRequestIdentifier(
      HarnessCommunicationPayload(@"Attachment first", @"Body", @"attachment-first"), YES,
      @"attachment-first", YES);

  HarnessAssert(HarnessWaitForCommunicationStart(1.0), testName,
                @"communication generation did not start");
  NSArray<NSString *> *events = HarnessOrchestrationEvents();
  HarnessAssert([events count] >= 2, testName, @"orchestration did not record both branches");
  if ([events count] >= 2) {
    HarnessAssert([events[0] isEqualToString:@"attachment-start"], testName,
                  @"attachment did not start first");
    HarnessAssert([events[1] isEqualToString:@"communication-start"], testName,
                  @"communication did not start after attachment");
  }
  HarnessAssert(HarnessPendingAttachmentCompletionCount() == 1, testName,
                @"attachment completion was not captured");

  NSObject *fakeAttachment = HarnessFakeAttachment();
  HarnessAttachmentCompletion attachmentCompletion = HarnessPendingAttachmentCompletionAtIndex(0);
  if (attachmentCompletion != nil) {
    attachmentCompletion((UNNotificationAttachment *)fakeAttachment);
  }
  HarnessAssert(HarnessHandlerCallCount(result) == 0, testName,
                @"attachment completion delivered before communication completion");

  HarnessReleaseCommunicationGeneration();
  HarnessAssert(HarnessWaitForSemaphore(result.invocationFinishedSemaphore, 1.0), testName,
                @"communication invocation did not finish");
  HarnessAssert(HarnessWaitForSemaphore(result.handlerCalledSemaphore, 1.0), testName,
                @"coordinated notification was not delivered");

  UNNotificationContent *deliveredContent = HarnessDeliveredContent(result);
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"coordinated notification was not delivered once");
  HarnessAssert([deliveredContent.title isEqualToString:@"Attachment first [provider]"], testName,
                @"provider-updated content was not delivered");
  HarnessAssert([deliveredContent.attachments count] == 1, testName,
                @"completed attachment was not applied");
  if ([deliveredContent.attachments count] == 1) {
    HarnessAssert(deliveredContent.attachments[0] == (id)fakeAttachment, testName,
                  @"delivered attachment was not the pending attachment");
  }

  HarnessEndCapturingAttachments();
  HarnessResetOrchestrationState();
  HarnessFinishTest(testName, failuresBefore);
}

static void TestCommunicationFirstCompletionUsesLatestContent(void) {
  NSString *testName = @"testCommunicationFirstCompletionUsesLatestContent";
  NSInteger failuresBefore = gFailures;

  HarnessResetOrchestrationState();
  HarnessBeginCapturingAttachments();
  HarnessResult *result = HarnessInvokeWithRequestIdentifier(
      HarnessCommunicationPayload(@"Communication first", @"Body", @"communication-first"), YES,
      @"communication-first");

  HarnessAssert(result.exception == nil, testName, @"communication invocation threw an exception");
  HarnessAssert(HarnessHandlerCallCount(result) == 0, testName,
                @"communication completion delivered before attachment completion");
  HarnessAssert(HarnessPendingAttachmentCompletionCount() == 1, testName,
                @"attachment completion was not captured");

  UNNotificationContent *providerInput = nil;
  NSInteger donationCount = 0;
  @synchronized(gHarnessStateLock) {
    providerInput = gLastProviderInputContent;
    donationCount = gDonationCallCount;
  }
  HarnessAssert(providerInput != nil, testName, @"content provider was not invoked");
  HarnessAssert(providerInput != result.builtContent, testName,
                @"content provider did not operate on a copy");
  HarnessAssert(donationCount == 1, testName, @"successful communication was not donated once");

  NSObject *firstAttachment = HarnessFakeAttachment();
  NSObject *lateAttachment = HarnessFakeAttachment();
  HarnessAttachmentCompletion attachmentCompletion = HarnessPendingAttachmentCompletionAtIndex(0);
  if (attachmentCompletion != nil) {
    attachmentCompletion((UNNotificationAttachment *)firstAttachment);
  }
  HarnessAssert(HarnessWaitForSemaphore(result.handlerCalledSemaphore, 1.0), testName,
                @"notification was not delivered after both branches completed");

  UNNotificationContent *deliveredContent = HarnessDeliveredContent(result);
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"notification was not delivered exactly once");
  HarnessAssert([deliveredContent.title isEqualToString:@"Communication first [provider]"],
                testName, @"attachment was not applied to the latest provider content");
  HarnessAssert([deliveredContent.attachments count] == 1, testName,
                @"latest provider content did not receive the attachment");

  if (attachmentCompletion != nil) {
    attachmentCompletion((UNNotificationAttachment *)lateAttachment);
  }
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"duplicate attachment completion delivered twice");
  if ([deliveredContent.attachments count] == 1) {
    HarnessAssert(deliveredContent.attachments[0] == (id)firstAttachment, testName,
                  @"late attachment completion mutated delivered content");
  }

  HarnessEndCapturingAttachments();
  HarnessResetOrchestrationState();
  HarnessFinishTest(testName, failuresBefore);
}

static void TestProviderFailurePreservesAttachmentFallback(void) {
  NSString *testName = @"testProviderFailurePreservesAttachmentFallback";
  NSInteger failuresBefore = gFailures;

  HarnessResetOrchestrationState();
  HarnessBeginCapturingAttachments();
  @synchronized(gHarnessStateLock) {
    gProviderShouldFail = YES;
  }

  HarnessResult *result = HarnessInvokeWithRequestIdentifier(
      HarnessCommunicationPayload(@"Provider failure", @"Body", @"provider-failure"), YES,
      @"provider-failure");
  HarnessAssert(result.exception == nil, testName, @"provider failure escaped as an exception");
  HarnessAssert(HarnessHandlerCallCount(result) == 0, testName,
                @"provider failure delivered before attachment completion");

  NSObject *fakeAttachment = HarnessFakeAttachment();
  HarnessAttachmentCompletion attachmentCompletion = HarnessPendingAttachmentCompletionAtIndex(0);
  if (attachmentCompletion != nil) {
    attachmentCompletion((UNNotificationAttachment *)fakeAttachment);
  }
  HarnessAssert(HarnessWaitForSemaphore(result.handlerCalledSemaphore, 1.0), testName,
                @"provider failure fallback was not delivered");

  UNNotificationContent *deliveredContent = HarnessDeliveredContent(result);
  NSInteger donationCount = 0;
  @synchronized(gHarnessStateLock) {
    donationCount = gDonationCallCount;
  }
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"provider failure fallback was not one-shot");
  HarnessAssert([deliveredContent.title isEqualToString:@"Provider failure"], testName,
                @"provider failure changed fallback content");
  HarnessAssert([deliveredContent.attachments count] == 1, testName,
                @"provider failure dropped a successful attachment");
  HarnessAssert(donationCount == 0, testName, @"failed provider path donated an interaction");

  HarnessEndCapturingAttachments();
  HarnessResetOrchestrationState();
  HarnessFinishTest(testName, failuresBefore);
}

static void TestCommunicationCompletionBeforeDeadlineIsAccepted(void) {
  NSString *testName = @"testCommunicationCompletionBeforeDeadlineIsAccepted";
  NSInteger failuresBefore = gFailures;

  HarnessResetOrchestrationState();
  dispatch_time_t requestStart = dispatch_time(DISPATCH_TIME_NOW, 0);
  HarnessBeginControlledOrchestration(requestStart);
  HarnessBlockProviderCompletion();

  HarnessResult *result = HarnessStartInvocationWithRequestIdentifier(
      HarnessCommunicationPayload(@"Before deadline", @"Body", nil), YES, @"before-deadline", YES);
  HarnessAssert(HarnessWaitForProviderStart(1.0), testName, @"provider did not start");
  HarnessAssert(HarnessPendingFinalizerCount() == 1, testName,
                @"request did not schedule exactly one finalizer");

  dispatch_time_t finalDeadline = HarnessPendingFinalizerDeadlineAtIndex(0);
  dispatch_time_t mediaCutoff = 0;
  @synchronized(gHarnessStateLock) {
    mediaCutoff = gLastCommunicationMediaCutoff;
  }
  HarnessAssert(finalDeadline == dispatch_time(requestStart, 25 * NSEC_PER_SEC), testName,
                @"final deadline was not derived as T0 + 25 seconds");
  HarnessAssert(mediaCutoff == dispatch_time(finalDeadline, -(int64_t)(5 * NSEC_PER_SEC)), testName,
                @"communication media cutoff was not derived as D - 5 seconds");

  HarnessSetControlledTime(dispatch_time(finalDeadline, -(int64_t)NSEC_PER_SEC));
  HarnessReleaseProviderCompletion();
  HarnessAssert(HarnessWaitForSemaphore(result.invocationFinishedSemaphore, 1.0), testName,
                @"pre-deadline provider invocation did not finish");
  HarnessAssert(HarnessWaitForSemaphore(result.handlerCalledSemaphore, 1.0), testName,
                @"pre-deadline completion did not deliver");

  UNNotificationContent *deliveredContent = HarnessDeliveredContent(result);
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"pre-deadline completion did not deliver exactly once");
  HarnessAssert([deliveredContent.title isEqualToString:@"Before deadline [provider]"], testName,
                @"pre-deadline provider content was rejected");
  HarnessAssert(HarnessDonationCallCount() == 1, testName,
                @"accepted communication did not preserve donation semantics");

  HarnessResetOrchestrationState();
  HarnessFinishTest(testName, failuresBefore);
}

static void TestPostDeadlineCompletionBeforeFinalizerIsRejected(void) {
  NSString *testName = @"testPostDeadlineCompletionBeforeFinalizerIsRejected";
  NSInteger failuresBefore = gFailures;

  HarnessResetOrchestrationState();
  HarnessBeginCapturingAttachments();
  HarnessBeginControlledOrchestration(dispatch_time(DISPATCH_TIME_NOW, 0));
  HarnessBlockProviderCompletion();

  HarnessResult *result = HarnessStartInvocationWithRequestIdentifier(
      HarnessCommunicationPayload(@"Deadline fallback", @"Body", @"deadline"), YES, @"deadline",
      YES);
  HarnessAssert(HarnessWaitForProviderStart(1.0), testName, @"provider did not start before D");
  HarnessAssert(HarnessPendingFinalizerCount() == 1, testName,
                @"request did not leave one scheduled finalizer");
  HarnessAssert(HarnessPendingAttachmentCompletionCount() == 1, testName,
                @"attachment completion was not captured");

  NSObject *acceptedAttachment = HarnessFakeAttachment();
  HarnessAttachmentCompletion attachmentCompletion = HarnessPendingAttachmentCompletionAtIndex(0);
  if (attachmentCompletion != nil) {
    attachmentCompletion((UNNotificationAttachment *)acceptedAttachment);
  }
  HarnessAssert(HarnessHandlerCallCount(result) == 0, testName,
                @"pre-deadline attachment delivered before communication completion");

  dispatch_time_t finalDeadline = HarnessPendingFinalizerDeadlineAtIndex(0);
  HarnessSetControlledTime(dispatch_time(finalDeadline, NSEC_PER_SEC));
  HarnessReleaseProviderCompletion();
  HarnessAssert(HarnessWaitForSemaphore(result.invocationFinishedSemaphore, 1.0), testName,
                @"post-deadline provider invocation did not finish");
  HarnessAssert(HarnessWaitForSemaphore(result.handlerCalledSemaphore, 1.0), testName,
                @"post-deadline completion did not converge on fallback delivery");

  UNNotificationContent *deliveredContent = HarnessDeliveredContent(result);
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"post-deadline completion did not produce one-shot delivery");
  HarnessAssert([deliveredContent.title isEqualToString:@"Deadline fallback"], testName,
                @"post-deadline provider content won before the captured finalizer ran");
  HarnessAssert([deliveredContent.attachments count] == 1, testName,
                @"deadline fallback lost the attachment accepted before D");
  if ([deliveredContent.attachments count] == 1) {
    HarnessAssert(deliveredContent.attachments[0] == (id)acceptedAttachment, testName,
                  @"deadline fallback did not use the best content accepted before D");
  }
  HarnessAssert(HarnessDonationCallCount() == 1, testName,
                @"rejected provider result changed donation order or semantics");

  HarnessFinalizer finalizer = HarnessPendingFinalizerAtIndex(0);
  if (finalizer != nil) {
    finalizer();
  }
  NSObject *lateAttachment = HarnessFakeAttachment();
  if (attachmentCompletion != nil) {
    attachmentCompletion((UNNotificationAttachment *)lateAttachment);
  }
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"captured finalizer or post-delivery completion delivered twice");
  HarnessAssert([deliveredContent.attachments count] == 1 &&
                    deliveredContent.attachments[0] == (id)acceptedAttachment,
                testName, @"post-delivery completion mutated delivered content");

  HarnessEndCapturingAttachments();
  HarnessResetOrchestrationState();
  HarnessFinishTest(testName, failuresBefore);
}

static void TestFinalizerDeliveryIsOneShot(void) {
  NSString *testName = @"testFinalizerDeliveryIsOneShot";
  NSInteger failuresBefore = gFailures;

  HarnessResetOrchestrationState();
  HarnessBeginCapturingAttachments();
  HarnessBeginControlledOrchestration(dispatch_time(DISPATCH_TIME_NOW, 0));
  HarnessBlockProviderCompletion();

  HarnessResult *result = HarnessStartInvocationWithRequestIdentifier(
      HarnessCommunicationPayload(@"Finalizer fallback", @"Body", @"finalizer"), YES, @"finalizer",
      YES);
  HarnessAssert(HarnessWaitForProviderStart(1.0), testName, @"provider did not start");
  HarnessAssert(HarnessPendingFinalizerCount() == 1, testName,
                @"request did not schedule one finalizer");

  dispatch_time_t finalDeadline = HarnessPendingFinalizerDeadlineAtIndex(0);
  HarnessSetControlledTime(finalDeadline);
  HarnessFinalizer finalizer = HarnessPendingFinalizerAtIndex(0);
  if (finalizer != nil) {
    finalizer();
  }
  HarnessAssert(HarnessWaitForSemaphore(result.handlerCalledSemaphore, 1.0), testName,
                @"finalizer did not deliver at D");
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"finalizer did not deliver exactly once");
  HarnessAssert([HarnessDeliveredContent(result).title isEqualToString:@"Finalizer fallback"],
                testName, @"finalizer did not deliver base fallback content");

  HarnessReleaseProviderCompletion();
  HarnessAssert(HarnessWaitForSemaphore(result.invocationFinishedSemaphore, 1.0), testName,
                @"provider did not complete after finalizer delivery");
  HarnessAttachmentCompletion attachmentCompletion = HarnessPendingAttachmentCompletionAtIndex(0);
  if (attachmentCompletion != nil) {
    attachmentCompletion((UNNotificationAttachment *)HarnessFakeAttachment());
  }
  if (finalizer != nil) {
    finalizer();
  }
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"completion after delivery or repeated finalizer delivered twice");
  HarnessAssert(HarnessDonationCallCount() == 1, testName,
                @"late provider completion did not preserve donation semantics");

  HarnessEndCapturingAttachments();
  HarnessResetOrchestrationState();
  HarnessFinishTest(testName, failuresBefore);
}

static void TestProviderDoesNotStartWhenAvatarWorkReturnsAtDeadline(void) {
  NSString *testName = @"testProviderDoesNotStartWhenAvatarWorkReturnsAtDeadline";
  NSInteger failuresBefore = gFailures;

  HarnessResetOrchestrationState();
  HarnessBeginControlledOrchestration(dispatch_time(DISPATCH_TIME_NOW, 0));
  HarnessBlockCommunicationGeneration();

  HarnessResult *result = HarnessStartInvocationWithRequestIdentifier(
      HarnessCommunicationPayload(@"Avatar cutoff fallback", @"Body", nil), YES, @"avatar-cutoff",
      YES);
  HarnessAssert(HarnessWaitForCommunicationStart(1.0), testName,
                @"avatar/intent generation did not start");
  HarnessAssert(HarnessPendingFinalizerCount() == 1, testName,
                @"request did not schedule one finalizer");

  dispatch_time_t finalDeadline = HarnessPendingFinalizerDeadlineAtIndex(0);
  HarnessSetControlledTime(finalDeadline);
  HarnessReleaseCommunicationGeneration();
  HarnessAssert(HarnessWaitForSemaphore(result.invocationFinishedSemaphore, 1.0), testName,
                @"avatar/intent generation did not return");
  HarnessAssert(HarnessWaitForSemaphore(result.handlerCalledSemaphore, 1.0), testName,
                @"avatar work returning at D did not deliver fallback");

  HarnessAssert(HarnessProviderCallCount() == 0, testName,
                @"provider started after avatar work consumed the final deadline");
  HarnessAssert(HarnessDonationCallCount() == 0, testName,
                @"provider-skipped path unexpectedly donated an interaction");
  HarnessAssert([HarnessDeliveredContent(result).title isEqualToString:@"Avatar cutoff fallback"],
                testName, @"provider-skipped path did not deliver base fallback content");
  HarnessAssert(HarnessHandlerCallCount(result) == 1, testName,
                @"provider-skipped fallback was not one-shot");

  HarnessResetOrchestrationState();
  HarnessFinishTest(testName, failuresBefore);
}

static void TestOverlappingCommunicationRequestsRemainIsolated(void) {
  NSString *testName = @"testOverlappingCommunicationRequestsRemainIsolated";
  NSInteger failuresBefore = gFailures;

  HarnessResetOrchestrationState();
  HarnessBeginCapturingAttachments();

  HarnessResult *resultA = HarnessInvokeWithRequestIdentifier(
      HarnessCommunicationPayload(@"Overlap A", @"Body A", @"overlap-a"), YES, @"overlap-a");
  HarnessResult *resultB = HarnessInvokeWithRequestIdentifier(
      HarnessCommunicationPayload(@"Overlap B", @"Body B", @"overlap-b"), YES, @"overlap-b");

  HarnessAssert(HarnessHandlerCallCount(resultA) == 0, testName,
                @"request A delivered before its attachment completed");
  HarnessAssert(HarnessHandlerCallCount(resultB) == 0, testName,
                @"request B delivered before its attachment completed");
  HarnessAssert(HarnessPendingAttachmentCompletionCount() == 2, testName,
                @"overlapping requests did not retain independent attachment "
                @"completions");

  NSObject *attachmentA = HarnessFakeAttachment();
  NSObject *attachmentB = HarnessFakeAttachment();
  HarnessAttachmentCompletion completionA = HarnessPendingAttachmentCompletionAtIndex(0);
  HarnessAttachmentCompletion completionB = HarnessPendingAttachmentCompletionAtIndex(1);

  if (completionB != nil) {
    completionB((UNNotificationAttachment *)attachmentB);
  }
  HarnessAssert(HarnessWaitForSemaphore(resultB.handlerCalledSemaphore, 1.0), testName,
                @"request B did not complete independently");
  HarnessAssert(HarnessHandlerCallCount(resultA) == 0, testName,
                @"request B completion delivered request A");

  if (completionA != nil) {
    completionA((UNNotificationAttachment *)attachmentA);
  }
  HarnessAssert(HarnessWaitForSemaphore(resultA.handlerCalledSemaphore, 1.0), testName,
                @"request A did not complete independently");

  UNNotificationContent *deliveredA = HarnessDeliveredContent(resultA);
  UNNotificationContent *deliveredB = HarnessDeliveredContent(resultB);
  HarnessAssert(HarnessHandlerCallCount(resultA) == 1 && HarnessHandlerCallCount(resultB) == 1,
                testName, @"overlapping requests were not each delivered exactly once");
  HarnessAssert([deliveredA.title isEqualToString:@"Overlap A [provider]"] &&
                    [deliveredB.title isEqualToString:@"Overlap B [provider]"],
                testName, @"overlapping requests exchanged provider-updated content");
  HarnessAssert(
      [deliveredA.attachments count] == 1 && deliveredA.attachments[0] == (id)attachmentA &&
          [deliveredB.attachments count] == 1 && deliveredB.attachments[0] == (id)attachmentB,
      testName, @"overlapping requests exchanged attachment state");

  if (completionA != nil) {
    completionA((UNNotificationAttachment *)attachmentB);
  }
  if (completionB != nil) {
    completionB((UNNotificationAttachment *)attachmentA);
  }
  HarnessAssert(HarnessHandlerCallCount(resultA) == 1 && HarnessHandlerCallCount(resultB) == 1,
                testName, @"late overlapping completions bypassed one-shot delivery");

  HarnessEndCapturingAttachments();
  HarnessResetOrchestrationState();
  HarnessFinishTest(testName, failuresBefore);
}

int main(void) {
  @autoreleasepool {
    gHarnessStateLock = [[NSObject alloc] init];
    gOrchestrationEvents = [NSMutableArray new];
    gPendingFinalizers = [NSMutableArray new];
    gPendingFinalizerDeadlines = [NSMutableArray new];
    HarnessInstallPrivateOrchestrationSeams();
    HarnessInstallNotificationFrameworkStubs();
    TestMissingNotifeeOptionsDeliversOriginalContentOnce();
    TestLegacyDictionaryNotifeeOptionsDeliversMutatedContent();
    TestJsonStringDictionaryNotifeeOptionsDeliversMutatedContent();
    TestInvalidJsonStringFallsBackToOriginalContent();
    TestJsonStringArrayFallsBackToOriginalContent();
    TestUnexpectedNotifeeOptionsTypesFallBackToOriginalContent();
    TestSequentialRequestsRemainIndependent();
    TestAttachmentCompletionIsOneShotPerRequest();
    TestLateAttachmentCompletionUsesOriginalRequestContext();
    TestAttachmentStartsBeforeCommunicationAndAttachmentFirstCompletion();
    TestCommunicationFirstCompletionUsesLatestContent();
    TestProviderFailurePreservesAttachmentFallback();
    TestCommunicationCompletionBeforeDeadlineIsAccepted();
    TestPostDeadlineCompletionBeforeFinalizerIsRejected();
    TestFinalizerDeliveryIsOneShot();
    TestProviderDoesNotStartWhenAvatarWorkReturnsAtDeadline();
    TestOverlappingCommunicationRequestsRemainIsolated();
  }

  if (gFailures > 0) {
    fprintf(stderr, "%ld failure(s)\n", (long)gFailures);
    return 1;
  }

  fprintf(stdout, "PASS NotifeeCoreExtensionHelper payload harness\n");
  return 0;
}
