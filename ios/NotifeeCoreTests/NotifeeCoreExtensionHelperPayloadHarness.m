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
#import "NotifeeCore.h"
#import "NotifeeCoreExtensionHelper.h"
#import "NotifeeCoreUtil.h"

static NSString *const kHarnessOriginalTitle = @"Original title";
static NSString *const kHarnessOriginalBody = @"Original body";
static NSString *const kHarnessRequestIdentifier = @"harness-request-id";

static NSInteger gFailures = 0;
static NSDictionary *gLastBuiltNotification = nil;

@interface NotifeeCoreExtensionHelper (PayloadHarness)
- (void)deliverNotification;
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
@end

@implementation HarnessResult
@end

static HarnessResult *HarnessInvoke(id options, BOOL includeOptionsKey) {
  gLastBuiltNotification = nil;

  NSDictionary *userInfo = includeOptionsKey ? HarnessUserInfoWithOptions(options) : @{};
  UNMutableNotificationContent *content = HarnessContentWithUserInfo(userInfo);
  UNNotificationRequest *request =
      [UNNotificationRequest requestWithIdentifier:kHarnessRequestIdentifier
                                           content:content
                                           trigger:nil];

  __block NSInteger handlerCallCount = 0;
  __block UNNotificationContent *deliveredContent = nil;
  __block NSException *exception = nil;

  NotifeeCoreExtensionHelper *helper = [NotifeeCoreExtensionHelper instance];
  helper.contentHandler = nil;
  helper.modifiedContent = nil;

  @try {
    [helper populateNotificationContent:request
                            withContent:content
                     withContentHandler:^(UNNotificationContent *contentFromHandler) {
                       handlerCallCount += 1;
                       deliveredContent = contentFromHandler;
                     }];
    [helper deliverNotification];
  } @catch (NSException *caughtException) {
    exception = caughtException;
  }

  HarnessResult *result = [[HarnessResult alloc] init];
  result.handlerCallCount = handlerCallCount;
  result.deliveredContent = deliveredContent;
  result.exception = exception;
  result.originalContent = content;
  return result;
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
  HarnessAssert(gLastBuiltNotification == nil, testName,
                @"malformed payload unexpectedly reached content rebuild");
}

static void HarnessAssertBuiltNotification(NSString *testName, NSString *title, NSString *body) {
  HarnessAssert(gLastBuiltNotification != nil, testName,
                @"valid payload did not reach content rebuild");
  HarnessAssert([gLastBuiltNotification[@"remote"] isEqual:@YES], testName,
                @"valid payload did not mark notification as remote");
  HarnessAssert([gLastBuiltNotification[@"id"] isEqualToString:kHarnessRequestIdentifier], testName,
                @"valid payload did not default id from request");
  HarnessAssert([gLastBuiltNotification[@"title"] isEqualToString:title], testName,
                @"rebuilt title did not match payload");
  HarnessAssert([gLastBuiltNotification[@"body"] isEqualToString:body], testName,
                @"rebuilt body did not match payload");
  HarnessAssert([gLastBuiltNotification[@"data"] isKindOfClass:[NSDictionary class]], testName,
                @"valid payload did not default data to a dictionary");
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
  HarnessAssertBuiltNotification(testName, @"Legacy title", @"Legacy body");
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
  HarnessAssertBuiltNotification(testName, @"JSON title", @"JSON body");
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

int main(void) {
  @autoreleasepool {
    TestMissingNotifeeOptionsDeliversOriginalContentOnce();
    TestLegacyDictionaryNotifeeOptionsDeliversMutatedContent();
    TestJsonStringDictionaryNotifeeOptionsDeliversMutatedContent();
    TestInvalidJsonStringFallsBackToOriginalContent();
    TestJsonStringArrayFallsBackToOriginalContent();
    TestUnexpectedNotifeeOptionsTypesFallBackToOriginalContent();
  }

  if (gFailures > 0) {
    fprintf(stderr, "%ld failure(s)\n", (long)gFailures);
    return 1;
  }

  fprintf(stdout, "PASS NotifeeCoreExtensionHelper payload harness\n");
  return 0;
}
