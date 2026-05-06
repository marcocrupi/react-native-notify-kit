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
#import "NotifeeCore+NSURLSession.h"

@interface NotifeeCoreNSURLSession (LocalAttachmentDownloaderHarness)

+ (NSURLSessionConfiguration *)attachmentDownloadSessionConfiguration;
+ (nullable NSString *)fileExtensionFromSuggestedFilename:(nullable NSString *)suggestedFilename;

@end

static NSInteger gFailures = 0;

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

static void HarnessTestSuggestedFilenameWithExtension(void) {
  NSString *testName = @"suggestedFilenameWithExtension";
  NSInteger failuresBefore = gFailures;

  NSString *fileExtension =
      [NotifeeCoreNSURLSession fileExtensionFromSuggestedFilename:@"notifee-image.jpg"];

  HarnessAssert([fileExtension isEqualToString:@".jpg"], testName,
                @"expected .jpg extension for suggested filename");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessTestSuggestedFilenameWithoutExtension(void) {
  NSString *testName = @"suggestedFilenameWithoutExtension";
  NSInteger failuresBefore = gFailures;

  NSString *fileExtension =
      [NotifeeCoreNSURLSession fileExtensionFromSuggestedFilename:@"notifee-image"];

  HarnessAssert(fileExtension == nil, testName,
                @"expected nil when suggested filename has no extension");
  HarnessAssert(![fileExtension isEqualToString:@"."], testName,
                @"must not create a dot-only extension");

  HarnessFinishTest(testName, failuresBefore);
}

static void HarnessTestAttachmentDownloadTimeouts(void) {
  NSString *testName = @"attachmentDownloadTimeouts";
  NSInteger failuresBefore = gFailures;

  NSURLSessionConfiguration *configuration =
      [NotifeeCoreNSURLSession attachmentDownloadSessionConfiguration];

  HarnessAssert(configuration.timeoutIntervalForRequest == 25.0, testName,
                @"expected request timeout to be 25 seconds");
  HarnessAssert(configuration.timeoutIntervalForResource == 25.0, testName,
                @"expected resource timeout to be 25 seconds");

  HarnessFinishTest(testName, failuresBefore);
}

int main(void) {
  @autoreleasepool {
    HarnessTestSuggestedFilenameWithExtension();
    HarnessTestSuggestedFilenameWithoutExtension();
    HarnessTestAttachmentDownloadTimeouts();
  }

  if (gFailures > 0) {
    fprintf(stderr, "%ld local attachment downloader harness failure(s)\n", (long)gFailures);
    return 1;
  }

  fprintf(stdout, "All local attachment downloader harness tests passed\n");
  return 0;
}
