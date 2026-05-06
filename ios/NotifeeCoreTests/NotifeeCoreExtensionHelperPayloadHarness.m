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

static NSInteger gFailures = 0;
static NSDictionary *gLastBuiltNotification = nil;
static BOOL gCaptureAttachmentDownloads = NO;
static NSMutableArray *gPendingAttachmentCompletions = nil;

@interface NotifeeCoreExtensionHelper (PayloadHarness)
- (void)loadAttachment:(NSDictionary *)attachmentDict
     completionHandler:(void (^)(UNNotificationAttachment *))completionHandler;
@end

@implementation NotifeeCore

+ (UNMutableNotificationContent *)buildNotificationContent:(NSDictionary *)notification
                                               withTrigger:(NSDictionary *)trigger {
  gLastBuiltNotification = [notification copy];

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

  return content;
}

@end

@implementation NotifeeCoreUtil

+ (INSendMessageIntent *)generateSenderIntentForCommunicationNotification:
    (NSMutableDictionary *)options {
  return nil;
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
@end

@implementation HarnessResult
@end

static HarnessResult *HarnessInvokeWithRequestIdentifier(id options, BOOL includeOptionsKey,
                                                         NSString *requestIdentifier) {
  gLastBuiltNotification = nil;

  NSDictionary *userInfo = includeOptionsKey ? HarnessUserInfoWithOptions(options) : @{};
  UNMutableNotificationContent *content = HarnessContentWithUserInfo(userInfo);
  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:requestIdentifier
                                                                        content:content
                                                                        trigger:nil];

  HarnessResult *result = [[HarnessResult alloc] init];
  result.originalContent = content;

  NotifeeCoreExtensionHelper *helper = [NotifeeCoreExtensionHelper instance];

  @try {
    [helper populateNotificationContent:request
                            withContent:content
                     withContentHandler:^(UNNotificationContent *contentFromHandler) {
                       result.handlerCallCount += 1;
                       result.deliveredContent = contentFromHandler;
                     }];
  } @catch (NSException *caughtException) {
    result.exception = caughtException;
  }

  result.builtNotification = gLastBuiltNotification;
  return result;
}

static HarnessResult *HarnessInvoke(id options, BOOL includeOptionsKey) {
  return HarnessInvokeWithRequestIdentifier(options, includeOptionsKey, kHarnessRequestIdentifier);
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

          if (gCaptureAttachmentDownloads) {
            if (gPendingAttachmentCompletions == nil) {
              gPendingAttachmentCompletions = [NSMutableArray new];
            }
            [gPendingAttachmentCompletions addObject:[completionHandler copy]];
            return;
          }

          completionHandler(nil);
        });
    method_setImplementation(method, stubImp);
  });
}

static void HarnessBeginCapturingAttachments(void) {
  HarnessInstallAttachmentStub();
  gCaptureAttachmentDownloads = YES;
  if (gPendingAttachmentCompletions == nil) {
    gPendingAttachmentCompletions = [NSMutableArray new];
  }
  [gPendingAttachmentCompletions removeAllObjects];
}

static void HarnessEndCapturingAttachments(void) {
  gCaptureAttachmentDownloads = NO;
  [gPendingAttachmentCompletions removeAllObjects];
}

static HarnessAttachmentCompletion HarnessPendingAttachmentCompletionAtIndex(NSUInteger index) {
  if (gPendingAttachmentCompletions == nil || [gPendingAttachmentCompletions count] <= index) {
    return nil;
  }

  return [gPendingAttachmentCompletions[index] copy];
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
  HarnessAssert([gPendingAttachmentCompletions count] == 1, testName,
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

int main(void) {
  @autoreleasepool {
    TestMissingNotifeeOptionsDeliversOriginalContentOnce();
    TestLegacyDictionaryNotifeeOptionsDeliversMutatedContent();
    TestJsonStringDictionaryNotifeeOptionsDeliversMutatedContent();
    TestInvalidJsonStringFallsBackToOriginalContent();
    TestJsonStringArrayFallsBackToOriginalContent();
    TestUnexpectedNotifeeOptionsTypesFallBackToOriginalContent();
    TestSequentialRequestsRemainIndependent();
    TestAttachmentCompletionIsOneShotPerRequest();
    TestLateAttachmentCompletionUsesOriginalRequestContext();
  }

  if (gFailures > 0) {
    fprintf(stderr, "%ld failure(s)\n", (long)gFailures);
    return 1;
  }

  fprintf(stdout, "PASS NotifeeCoreExtensionHelper payload harness\n");
  return 0;
}
