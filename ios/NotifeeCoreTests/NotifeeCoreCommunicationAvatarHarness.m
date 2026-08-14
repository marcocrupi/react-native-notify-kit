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
 */

#import <Foundation/Foundation.h>
#import <Intents/Intents.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>
#import "NotifeeCore+NSURLSession.h"
#import "NotifeeCoreUtil.h"

@interface NotifeeCoreUtil (CommunicationAvatarHarness)

+ (nullable NSURL *)getURLFromString:(nullable NSString *)urlString;
+ (INSendMessageIntent *)generateSenderIntentForCommunicationNotification:
                             (NSDictionary *)communicationInfo
                                                                 deadline:(dispatch_time_t)deadline;
+ (dispatch_time_t)communicationAvatarCurrentTime;

@end

static NSInteger gFailures = 0;
static NSObject *gStateLock = nil;
static NSData *gPNGData = nil;
static NSMutableArray<NSString *> *gDownloadURLs = nil;
static NSMutableArray<NSString *> *gDownloadPaths = nil;
static NSMutableArray<NSNumber *> *gDownloadMainThreadFlags = nil;
static NSMutableArray<NSURL *> *gImageURLs = nil;
static NSMutableArray<NSDictionary *> *gImageObservations = nil;
static NSInteger gActiveDownloads = 0;
static NSInteger gMaximumActiveDownloads = 0;
static NSInteger gCompletedDownloads = 0;
static dispatch_semaphore_t gOverlapGate = nil;
static NSInteger gOverlapArrivals = 0;
static dispatch_semaphore_t gLateGroupFinished = nil;
static BOOL gUseControlledClock = NO;
static dispatch_time_t gControlledInitialNow = 0;
static dispatch_time_t gControlledWorkerStartNow = 0;
static dispatch_time_t gControlledCompletionNow = 0;
static NSUInteger gControlledClockReads = 0;

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

static NSArray<NSString *> *HarnessDownloadURLs(void) {
  @synchronized(gStateLock) {
    return [gDownloadURLs copy];
  }
}

static NSArray<NSString *> *HarnessDownloadPaths(void) {
  @synchronized(gStateLock) {
    return [gDownloadPaths copy];
  }
}

static NSArray<NSNumber *> *HarnessDownloadMainThreadFlags(void) {
  @synchronized(gStateLock) {
    return [gDownloadMainThreadFlags copy];
  }
}

static NSArray<NSURL *> *HarnessImageURLs(void) {
  @synchronized(gStateLock) {
    return [gImageURLs copy];
  }
}

static NSArray<NSDictionary *> *HarnessImageObservations(void) {
  @synchronized(gStateLock) {
    return [gImageObservations copy];
  }
}

static NSInteger HarnessMaximumActiveDownloads(void) {
  @synchronized(gStateLock) {
    return gMaximumActiveDownloads;
  }
}

static NSInteger HarnessCompletedDownloads(void) {
  @synchronized(gStateLock) {
    return gCompletedDownloads;
  }
}

static NSUInteger HarnessDownloadCountForURL(NSString *urlString) {
  NSUInteger count = 0;
  for (NSString *downloadURL in HarnessDownloadURLs()) {
    if ([downloadURL isEqualToString:urlString]) {
      count += 1;
    }
  }
  return count;
}

static void HarnessRemoveDownloadFiles(NSArray<NSString *> *paths) {
  NSFileManager *fileManager = [NSFileManager defaultManager];
  for (NSString *path in paths) {
    [fileManager removeItemAtPath:path error:nil];
    [fileManager removeItemAtPath:[path stringByAppendingString:@".png"] error:nil];
  }
}

static void HarnessResetState(void) {
  NSArray<NSString *> *paths = HarnessDownloadPaths();
  HarnessRemoveDownloadFiles(paths);

  @synchronized(gStateLock) {
    gDownloadURLs = [NSMutableArray new];
    gDownloadPaths = [NSMutableArray new];
    gDownloadMainThreadFlags = [NSMutableArray new];
    gImageURLs = [NSMutableArray new];
    gImageObservations = [NSMutableArray new];
    gActiveDownloads = 0;
    gMaximumActiveDownloads = 0;
    gCompletedDownloads = 0;
    gOverlapArrivals = 0;
    gOverlapGate = dispatch_semaphore_create(0);
    gLateGroupFinished = dispatch_semaphore_create(0);
    gUseControlledClock = NO;
    gControlledInitialNow = 0;
    gControlledWorkerStartNow = 0;
    gControlledCompletionNow = 0;
    gControlledClockReads = 0;
  }
}

static void HarnessUseControlledClock(dispatch_time_t initialNow, dispatch_time_t workerStartNow,
                                      dispatch_time_t completionNow) {
  @synchronized(gStateLock) {
    gControlledInitialNow = initialNow;
    gControlledWorkerStartNow = workerStartNow;
    gControlledCompletionNow = completionNow;
    gControlledClockReads = 0;
    gUseControlledClock = YES;
  }
}

static NSMutableDictionary *HarnessCommunicationInfo(NSString *senderAvatar,
                                                     NSString *groupAvatar) {
  NSMutableDictionary *sender = [@{@"id" : @"sender-id", @"displayName" : @"Sender"} mutableCopy];
  if (senderAvatar != nil) {
    sender[@"avatar"] = senderAvatar;
  }

  NSMutableDictionary *communicationInfo =
      [@{@"sender" : sender, @"body" : @"Message body", @"conversationId" : @"conversation-id"}
          mutableCopy];
  if (groupAvatar != nil) {
    communicationInfo[@"groupName"] = @"Group";
    communicationInfo[@"groupAvatar"] = groupAvatar;
  }
  return communicationInfo;
}

static NSURL *HarnessCreatePNG(NSString *fileName) {
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:fileName];
  NSError *error = nil;
  if (![gPNGData writeToFile:path options:NSDataWritingAtomic error:&error]) {
    return nil;
  }
  return [NSURL fileURLWithPath:path];
}

static void HarnessInstallDownloadStub(void) {
  Method method = class_getClassMethod([NotifeeCoreNSURLSession class],
                                       @selector(downloadItemAtURL:toFile:error:));
  if (method == NULL) {
    HarnessFail(@"downloadStub", @"downloadItemAtURL:toFile:error: was not found");
    return;
  }

  IMP stubImplementation = imp_implementationWithBlock(^NSString *(
      id classObject, NSURL *url, NSString *localPath, NSError **error) {
    (void)classObject;
    NSString *urlString = url.absoluteString;
    BOOL overlapDownload = [urlString containsString:@"overlap-"];
    BOOL lateGroupDownload = [urlString containsString:@"late-group"];
    dispatch_semaphore_t overlapGate = nil;
    dispatch_semaphore_t lateGroupFinished = nil;

    @synchronized(gStateLock) {
      [gDownloadURLs addObject:urlString];
      [gDownloadPaths addObject:localPath];
      [gDownloadMainThreadFlags addObject:@([NSThread isMainThread])];
      gActiveDownloads += 1;
      gMaximumActiveDownloads = MAX(gMaximumActiveDownloads, gActiveDownloads);
      overlapGate = gOverlapGate;
      lateGroupFinished = gLateGroupFinished;

      if (overlapDownload) {
        gOverlapArrivals += 1;
        if (gOverlapArrivals == 2) {
          dispatch_semaphore_signal(overlapGate);
          dispatch_semaphore_signal(overlapGate);
        }
      }
    }

    if (overlapDownload) {
      dispatch_semaphore_wait(overlapGate,
                              dispatch_time(DISPATCH_TIME_NOW, (int64_t)(NSEC_PER_SEC)));
    } else if (lateGroupDownload) {
      [NSThread sleepForTimeInterval:0.15];
    }

    NSError *writeError = nil;
    BOOL wroteFile = [gPNGData writeToFile:localPath options:NSDataWritingAtomic error:&writeError];
    if (error != NULL) {
      *error = writeError;
    }

    @synchronized(gStateLock) {
      gActiveDownloads -= 1;
      gCompletedDownloads += 1;
    }

    if (lateGroupDownload) {
      dispatch_semaphore_signal(lateGroupFinished);
    }

    return wroteFile ? @"avatar.png" : nil;
  });
  method_setImplementation(method, stubImplementation);
}

static void HarnessInstallCommunicationAvatarClockStub(void) {
  Method method =
      class_getClassMethod([NotifeeCoreUtil class], @selector(communicationAvatarCurrentTime));
  if (method == NULL) {
    HarnessFail(@"clockStub", @"communicationAvatarCurrentTime was not found");
    return;
  }

  IMP stubImplementation = imp_implementationWithBlock(^dispatch_time_t(id classObject) {
    (void)classObject;
    @synchronized(gStateLock) {
      if (gUseControlledClock) {
        dispatch_time_t now = gControlledCompletionNow;
        if (gControlledClockReads == 0) {
          now = gControlledInitialNow;
        } else if (gControlledClockReads == 1) {
          now = gControlledWorkerStartNow;
        }
        gControlledClockReads += 1;
        return now;
      }
    }
    return dispatch_time(DISPATCH_TIME_NOW, 0);
  });
  method_setImplementation(method, stubImplementation);
}

static void HarnessInstallINImageStub(void) {
  Method method = class_getClassMethod([INImage class], @selector(imageWithURL:));
  if (method == NULL) {
    HarnessFail(@"imageStub", @"INImage imageWithURL: was not found");
    return;
  }

  IMP stubImplementation = imp_implementationWithBlock(^INImage *(id classObject, NSURL *url) {
    (void)classObject;
    NSFileManager *fileManager = [NSFileManager defaultManager];
    BOOL isDirectory = NO;
    BOOL exists = url.isFileURL && [fileManager fileExistsAtPath:url.path isDirectory:&isDirectory];
    BOOL readable = url.isFileURL && [fileManager isReadableFileAtPath:url.path];
    NSData *data = url.isFileURL ? [NSData dataWithContentsOfURL:url] : nil;
    NSDictionary *observation = @{
      @"isFileURL" : @(url.isFileURL),
      @"exists" : @(exists),
      @"isDirectory" : @(isDirectory),
      @"readable" : @(readable),
      @"nonempty" : @([data length] > 0),
      @"matchesFixture" : @([data isEqualToData:gPNGData]),
    };
    @synchronized(gStateLock) {
      [gImageURLs addObject:url];
      [gImageObservations addObject:observation];
    }
    return [INImage imageWithImageData:gPNGData];
  });
  method_setImplementation(method, stubImplementation);
}

static void HarnessAssertImageIsReadableFixture(NSUInteger index, NSString *testName) {
  NSArray<NSDictionary *> *observations = HarnessImageObservations();
  if ([observations count] <= index) {
    HarnessFail(testName, @"INImage observation was not recorded");
    return;
  }

  NSDictionary *observation = observations[index];
  HarnessAssert([observation[@"isFileURL"] boolValue], testName, @"INImage URL was not a file URL");
  HarnessAssert([observation[@"exists"] boolValue], testName,
                @"INImage file did not exist when materialized");
  HarnessAssert(![observation[@"isDirectory"] boolValue], testName,
                @"INImage file URL pointed to a directory");
  HarnessAssert([observation[@"readable"] boolValue], testName,
                @"INImage file was not readable when materialized");
  HarnessAssert([observation[@"nonempty"] boolValue], testName,
                @"INImage file was empty when materialized");
  HarnessAssert([observation[@"matchesFixture"] boolValue], testName,
                @"INImage file contents did not match the downloaded fixture");
}

static void TestFileURLPreservesURLSemantics(void) {
  NSString *testName = @"fileURLPreservesURLSemantics";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *fileName =
      [NSString stringWithFormat:@"notifee avatar 100%% %@.png", [NSUUID UUID].UUIDString];
  NSURL *sourceURL = HarnessCreatePNG(fileName);
  NSURL *resolvedURL = [NotifeeCoreUtil getURLFromString:sourceURL.absoluteString];
  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(
                                                           sourceURL.absoluteString, nil)];
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();

  HarnessAssert(sourceURL != nil, testName, @"could not create the file URL fixture");
  HarnessAssert(resolvedURL != nil, testName, @"valid file URL resolved to nil");
  HarnessAssert(resolvedURL.isFileURL, testName,
                @"valid file URL was not recognized as a file URL");
  HarnessAssert([resolvedURL isEqual:sourceURL], testName,
                @"resolver rebuilt or decoded the supplied file URL");
  HarnessAssert([resolvedURL.absoluteString isEqualToString:sourceURL.absoluteString], testName,
                @"file URL percent encoding changed");
  HarnessAssert([sourceURL.absoluteString containsString:@"%20"] &&
                    [sourceURL.absoluteString containsString:@"%25"],
                testName, @"fixture did not exercise spaces and percent encoding");
  HarnessAssert(intent.sender.image != nil, testName,
                @"file URL did not reach the sender INPerson image");
  HarnessAssert([imageURLs count] == 1 && [imageURLs[0] isEqual:sourceURL], testName,
                @"sender INImage did not receive the original file URL");
  HarnessAssert([HarnessDownloadURLs() count] == 0, testName,
                @"file URL unexpectedly entered the remote downloader");

  [[NSFileManager defaultManager] removeItemAtURL:sourceURL error:nil];
  HarnessFinishTest(testName, failuresBefore);
}

static void TestAbsolutePathRemainsSupported(void) {
  NSString *testName = @"absolutePathRemainsSupported";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *fileName =
      [NSString stringWithFormat:@"notifee absolute %@.png", [NSUUID UUID].UUIDString];
  NSURL *sourceURL = HarnessCreatePNG(fileName);
  NSURL *resolvedURL = [NotifeeCoreUtil getURLFromString:sourceURL.path];
  INSendMessageIntent *intent =
      [NotifeeCoreUtil generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(
                                                                            sourceURL.path, nil)];
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();

  HarnessAssert(resolvedURL.isFileURL, testName, @"absolute path did not resolve as a file URL");
  HarnessAssert([resolvedURL.path isEqualToString:sourceURL.path], testName,
                @"absolute path changed during resolution");
  HarnessAssert(intent.sender.image != nil, testName,
                @"absolute path did not reach the sender INPerson image");
  HarnessAssert([imageURLs count] == 1 && [imageURLs[0] isEqual:sourceURL], testName,
                @"sender INImage did not receive the absolute path as a file URL");
  HarnessAssert([HarnessDownloadURLs() count] == 0, testName,
                @"absolute path unexpectedly entered the remote downloader");

  [[NSFileManager defaultManager] removeItemAtURL:sourceURL error:nil];
  HarnessFinishTest(testName, failuresBefore);
}

static void TestBundleResourceRemainsSupported(void) {
  NSString *testName = @"bundleResourceRemainsSupported";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *resourceName = @"NotifeeCoreCommunicationAvatarFixture.png";
  NSString *resourcePath =
      [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:resourceName];
  NSError *writeError = nil;
  BOOL wroteResource = [gPNGData writeToFile:resourcePath
                                     options:NSDataWritingAtomic
                                       error:&writeError];
  NSURL *resolvedURL = [NotifeeCoreUtil getURLFromString:resourceName];
  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(resourceName, nil)];
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();

  HarnessAssert(wroteResource, testName, @"could not create the bundle resource fixture");
  HarnessAssert(writeError == nil, testName, @"bundle resource fixture write returned an error");
  HarnessAssert(resolvedURL != nil, testName, @"bundle resource name resolved to nil");
  HarnessAssert([resolvedURL.path isEqualToString:resourcePath], testName,
                @"bundle resource resolved to an unexpected path");
  HarnessAssert(intent.sender.image != nil, testName,
                @"bundle resource did not reach the sender INPerson image");
  HarnessAssert([imageURLs count] == 1 && [imageURLs[0] isEqual:resolvedURL], testName,
                @"sender INImage did not receive the resolved bundle file URL");
  HarnessAssert([HarnessDownloadURLs() count] == 0, testName,
                @"bundle resource unexpectedly entered the remote downloader");

  [[NSFileManager defaultManager] removeItemAtPath:resourcePath error:nil];
  HarnessFinishTest(testName, failuresBefore);
}

static void TestInvalidInputsFallBackSafely(void) {
  NSString *testName = @"invalidInputsFallBackSafely";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSURL *missingFileURL = [NSURL
      fileURLWithPath:[NSTemporaryDirectory()
                          stringByAppendingPathComponent:[NSString
                                                             stringWithFormat:@"missing-%@.png",
                                                                              [NSUUID UUID]
                                                                                  .UUIDString]]];
  NSString *missingBundleResource =
      [NSString stringWithFormat:@"missing-resource-%@.png", [NSUUID UUID].UUIDString];

  HarnessAssert([NotifeeCoreUtil getURLFromString:nil] == nil, testName,
                @"nil input did not resolve to nil");
  HarnessAssert([NotifeeCoreUtil getURLFromString:@""] == nil, testName,
                @"empty input did not resolve to nil");
  HarnessAssert([NotifeeCoreUtil getURLFromString:(id)[NSNull null]] == nil, testName,
                @"non-string input did not resolve to nil");
  HarnessAssert([NotifeeCoreUtil getURLFromString:missingBundleResource] == nil, testName,
                @"invalid bundle input did not resolve to nil");

  NSURL *resolvedMissingFile = [NotifeeCoreUtil getURLFromString:missingFileURL.absoluteString];
  HarnessAssert(resolvedMissingFile.isFileURL, testName,
                @"missing file URL was not handled safely as a file URL");

  @try {
    INSendMessageIntent *intent = [NotifeeCoreUtil
        generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(
                                                             missingBundleResource, nil)];
    HarnessAssert(intent != nil, testName, @"invalid avatar prevented intent creation");
    HarnessAssert(intent.sender.image == nil, testName,
                  @"invalid avatar did not fall back to a missing sender image");
  } @catch (NSException *exception) {
    HarnessFail(testName,
                [NSString stringWithFormat:@"invalid avatar raised an exception: %@", exception]);
  }

  HarnessAssert([HarnessImageURLs() count] == 0, testName, @"invalid avatar was passed to INImage");
  HarnessAssert([HarnessDownloadURLs() count] == 0, testName,
                @"invalid avatar unexpectedly entered the remote downloader");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestHTTPAndHTTPSRemainRemote(void) {
  NSString *testName = @"httpAndHTTPSRemainRemote";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *httpURL = @"http://example.invalid/avatar.png";
  NSString *httpsURL = @"https://example.invalid/avatar.png";
  NSURL *resolvedHTTPURL = [NotifeeCoreUtil getURLFromString:httpURL];
  NSURL *resolvedHTTPSURL = [NotifeeCoreUtil getURLFromString:httpsURL];

  HarnessAssert(resolvedHTTPURL.isFileURL, testName,
                @"HTTP input did not use the existing remote materialization path");
  HarnessAssert(resolvedHTTPSURL.isFileURL, testName,
                @"HTTPS input did not use the existing remote materialization path");
  HarnessAssert(HarnessDownloadCountForURL(httpURL) == 1, testName,
                @"HTTP input was not downloaded exactly once");
  HarnessAssert(HarnessDownloadCountForURL(httpsURL) == 1, testName,
                @"HTTPS input was not downloaded exactly once");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestHTTPSSenderContractRemainsFileBacked(void) {
  NSString *testName = @"httpsSenderContractRemainsFileBacked";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *senderURL = @"https://example.invalid/sender.png";
  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(senderURL, nil)];
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();

  HarnessAssert(intent != nil, testName, @"sender HTTPS did not create an intent");
  HarnessAssert(HarnessDownloadCountForURL(senderURL) == 1, testName,
                @"sender HTTPS did not use exactly one existing core download");
  HarnessAssert([HarnessDownloadMainThreadFlags() count] == 1 &&
                    [HarnessDownloadMainThreadFlags()[0] boolValue],
                testName, @"nominal sender HTTPS no longer used its synchronous path");
  HarnessAssert([imageURLs count] == 1 && imageURLs[0].isFileURL, testName,
                @"sender HTTPS was not passed to INImage as a local file URL");
  HarnessAssertImageIsReadableFixture(0, testName);
  HarnessAssert(intent.sender.image != nil, testName, @"sender HTTPS did not set INPerson.image");
  HarnessAssert(intent.sender.customIdentifier == nil, testName,
                @"sender customIdentifier changed");
  HarnessAssert([intent imageForParameterNamed:@"sender"] == nil, testName,
                @"sender image was also set as an intent parameter");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestHTTPSGroupAvatarIsMaterializedLocally(void) {
  NSString *testName = @"httpsGroupAvatarIsMaterializedLocally";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *groupURL = @"https://example.invalid/group.png";
  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(nil, groupURL)
                                              deadline:DISPATCH_TIME_FOREVER];
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();

  HarnessAssert(intent != nil, testName, @"group HTTPS did not create an intent");
  HarnessAssert(HarnessDownloadCountForURL(groupURL) == 1, testName,
                @"group HTTPS did not use the core downloader exactly once");
  HarnessAssert([imageURLs count] == 1 && imageURLs[0].isFileURL, testName,
                @"group HTTPS was passed to INImage without local materialization");
  HarnessAssertImageIsReadableFixture(0, testName);
  HarnessAssert([intent imageForParameterNamed:@"speakableGroupName"] != nil, testName,
                @"group image was not associated with speakableGroupName");
  HarnessAssert([intent imageForParameterNamed:@"sender"] == nil, testName,
                @"group flow added an image to the sender parameter");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestIdenticalRemoteAvatarsReuseOneDownload(void) {
  NSString *testName = @"identicalRemoteAvatarsReuseOneDownload";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *sharedURL = @"https://example.invalid/shared-avatar.png";
  INSendMessageIntent *intent =
      [NotifeeCoreUtil generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(
                                                                            sharedURL, sharedURL)
                                                               deadline:DISPATCH_TIME_FOREVER];
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();

  HarnessAssert(HarnessDownloadCountForURL(sharedURL) == 1, testName,
                @"identical sender/group URLs were downloaded more than once");
  HarnessAssert(HarnessMaximumActiveDownloads() == 1, testName,
                @"identical sender/group URLs unexpectedly required two active downloads");
  HarnessAssert([imageURLs count] == 2 && [imageURLs[0] isEqual:imageURLs[1]], testName,
                @"identical sender/group URLs did not reuse the same local file URL");
  HarnessAssert(intent.sender.image != nil, testName, @"shared URL did not set sender image");
  HarnessAssert([intent imageForParameterNamed:@"speakableGroupName"] != nil, testName,
                @"shared URL did not set group image");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestIdenticalBoundedRemoteAvatarsReuseOneDownload(void) {
  NSString *testName = @"identicalBoundedRemoteAvatarsReuseOneDownload";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *sharedURL = @"https://example.invalid/bounded-shared-avatar.png";
  dispatch_time_t mediaCutoff = dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC);
  HarnessUseControlledClock(mediaCutoff - 1, mediaCutoff - 1, mediaCutoff - 1);
  INSendMessageIntent *intent =
      [NotifeeCoreUtil generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(
                                                                            sharedURL, sharedURL)
                                                               deadline:mediaCutoff];
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();

  HarnessAssert(HarnessDownloadCountForURL(sharedURL) == 1, testName,
                @"identical bounded sender/group URLs were downloaded more than once");
  HarnessAssert(HarnessMaximumActiveDownloads() == 1, testName,
                @"identical bounded sender/group URLs required two active downloads");
  HarnessAssert([imageURLs count] == 2 && [imageURLs[0] isEqual:imageURLs[1]], testName,
                @"identical bounded sender/group URLs did not reuse one local file");
  HarnessAssert(intent.sender.image != nil, testName,
                @"identical bounded URL did not set sender image");
  HarnessAssert([intent imageForParameterNamed:@"speakableGroupName"] != nil, testName,
                @"identical bounded URL did not set group image");
  HarnessAssertImageIsReadableFixture(0, testName);
  HarnessAssertImageIsReadableFixture(1, testName);
  HarnessFinishTest(testName, failuresBefore);
}

static void TestDistinctRemoteAvatarsOverlapWithDistinctFiles(void) {
  NSString *testName = @"distinctRemoteAvatarsOverlapWithDistinctFiles";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *senderURL = @"https://example.invalid/overlap-sender.png";
  NSString *groupURL = @"https://example.invalid/overlap-group.png";
  dispatch_time_t deadline = dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC);
  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(senderURL, groupURL)
                                              deadline:deadline];
  NSArray<NSString *> *downloadPaths = HarnessDownloadPaths();
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();

  HarnessAssert(intent != nil, testName, @"distinct remote avatars did not create an intent");
  HarnessAssert(HarnessDownloadCountForURL(senderURL) == 1, testName,
                @"distinct sender URL was not downloaded exactly once");
  HarnessAssert(HarnessDownloadCountForURL(groupURL) == 1, testName,
                @"distinct group URL was not downloaded exactly once");
  HarnessAssert(HarnessMaximumActiveDownloads() == 2, testName,
                @"distinct sender/group downloads did not overlap");
  HarnessAssert([downloadPaths count] == 2 && [[NSSet setWithArray:downloadPaths] count] == 2,
                testName, @"distinct downloads wrote to the same cache destination");
  HarnessAssert([imageURLs count] == 2 && imageURLs[0].isFileURL && imageURLs[1].isFileURL,
                testName, @"distinct remote avatars were not both materialized as local files");
  HarnessAssert(![imageURLs[0] isEqual:imageURLs[1]], testName,
                @"distinct remote avatars unexpectedly shared one local file");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestFiniteRemoteAvatarCompletionCutoff(BOOL senderAvatar, NSInteger completionOffset,
                                                   BOOL expectedAccepted, NSString *testName) {
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *role = senderAvatar ? @"sender" : @"group";
  NSString *remoteURL = [NSString
      stringWithFormat:@"https://example.invalid/cutoff-%@-%ld.png", role, (long)completionOffset];
  dispatch_time_t mediaCutoff = dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC);
  dispatch_time_t completionTime = mediaCutoff;
  if (completionOffset < 0) {
    completionTime -= (dispatch_time_t)(-completionOffset);
  } else {
    completionTime += (dispatch_time_t)completionOffset;
  }
  HarnessUseControlledClock(mediaCutoff - 1, mediaCutoff - 1, completionTime);

  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(
                                                           senderAvatar ? remoteURL : nil,
                                                           senderAvatar ? nil : remoteURL)
                                              deadline:mediaCutoff];
  BOOL imageAccepted = senderAvatar ? intent.sender.image != nil
                                    : [intent imageForParameterNamed:@"speakableGroupName"] != nil;
  NSArray<NSURL *> *imageURLs = HarnessImageURLs();
  NSArray<NSString *> *downloadPaths = HarnessDownloadPaths();

  HarnessAssert(intent != nil, testName, @"bounded remote avatar did not create an intent");
  HarnessAssert(HarnessDownloadCountForURL(remoteURL) == 1, testName,
                @"bounded remote avatar was not downloaded exactly once");
  HarnessAssert(HarnessCompletedDownloads() == 1, testName,
                @"bounded remote download had not completed before intent construction returned");
  HarnessAssert([HarnessDownloadMainThreadFlags() count] == 1 &&
                    ![HarnessDownloadMainThreadFlags()[0] boolValue],
                testName, @"bounded remote avatar did not use its deadline worker");
  HarnessAssert([downloadPaths count] == 1 &&
                    [[NSFileManager defaultManager]
                        fileExistsAtPath:[downloadPaths[0] stringByAppendingString:@".png"]],
                testName, @"bounded remote download did not materialize its fixture");
  HarnessAssert(imageAccepted == expectedAccepted, testName,
                expectedAccepted ? @"pre-cutoff remote completion was rejected"
                                 : @"at/post-cutoff remote completion was accepted");
  HarnessAssert([imageURLs count] == (expectedAccepted ? 1u : 0u), testName,
                @"INImage invocation did not match cutoff acceptance");
  if (expectedAccepted) {
    HarnessAssertImageIsReadableFixture(0, testName);
  }

  HarnessFinishTest(testName, failuresBefore);
}

static void TestBoundedSenderCompletionBeforeMediaCutoffIsAccepted(void) {
  TestFiniteRemoteAvatarCompletionCutoff(YES, -1, YES,
                                         @"boundedSenderCompletionBeforeMediaCutoffIsAccepted");
}

static void TestBoundedSenderCompletionAtMediaCutoffIsRejected(void) {
  TestFiniteRemoteAvatarCompletionCutoff(YES, 0, NO,
                                         @"boundedSenderCompletionAtMediaCutoffIsRejected");
}

static void TestBoundedSenderCompletionAfterMediaCutoffIsRejected(void) {
  TestFiniteRemoteAvatarCompletionCutoff(YES, 1, NO,
                                         @"boundedSenderCompletionAfterMediaCutoffIsRejected");
}

static void TestBoundedGroupCompletionBeforeMediaCutoffIsAccepted(void) {
  TestFiniteRemoteAvatarCompletionCutoff(NO, -1, YES,
                                         @"boundedGroupCompletionBeforeMediaCutoffIsAccepted");
}

static void TestBoundedGroupCompletionAtMediaCutoffIsRejected(void) {
  TestFiniteRemoteAvatarCompletionCutoff(NO, 0, NO,
                                         @"boundedGroupCompletionAtMediaCutoffIsRejected");
}

static void TestBoundedGroupCompletionAfterMediaCutoffIsRejected(void) {
  TestFiniteRemoteAvatarCompletionCutoff(NO, 1, NO,
                                         @"boundedGroupCompletionAfterMediaCutoffIsRejected");
}

static void TestRemoteDownloadsDoNotStartAtMediaCutoff(void) {
  NSString *testName = @"remoteDownloadsDoNotStartAtMediaCutoff";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *senderURL = @"https://example.invalid/cutoff-skipped-sender.png";
  NSString *groupURL = @"https://example.invalid/cutoff-skipped-group.png";
  dispatch_time_t mediaCutoff = dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC);
  HarnessUseControlledClock(mediaCutoff, mediaCutoff, mediaCutoff);
  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(senderURL, groupURL)
                                              deadline:mediaCutoff];

  HarnessAssert(intent != nil, testName, @"expired media cutoff prevented intent creation");
  HarnessAssert([HarnessDownloadURLs() count] == 0, testName,
                @"remote worker started at the media cutoff");
  HarnessAssert(intent.sender.image == nil, testName,
                @"sender image was unexpectedly present when its worker was skipped");
  HarnessAssert([intent imageForParameterNamed:@"speakableGroupName"] == nil, testName,
                @"group image was unexpectedly present when its worker was skipped");
  HarnessAssert([HarnessImageURLs() count] == 0, testName,
                @"skipped remote avatars were passed to INImage");
  HarnessFinishTest(testName, failuresBefore);
}

static void TestLocalAvatarStillResolvesAtMediaCutoff(void) {
  NSString *testName = @"localAvatarStillResolvesAtMediaCutoff";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSURL *sourceURL = HarnessCreatePNG(
      [NSString stringWithFormat:@"notifee-cutoff-local-%@.png", [NSUUID UUID].UUIDString]);
  dispatch_time_t mediaCutoff = dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC);
  HarnessUseControlledClock(mediaCutoff, mediaCutoff, mediaCutoff);
  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(
                                                           sourceURL.absoluteString, nil)
                                              deadline:mediaCutoff];

  HarnessAssert(intent.sender.image != nil, testName,
                @"local sender avatar was incorrectly suppressed at the remote media cutoff");
  HarnessAssert([HarnessDownloadURLs() count] == 0, testName,
                @"local sender avatar unexpectedly used a remote worker");
  HarnessAssertImageIsReadableFixture(0, testName);
  [[NSFileManager defaultManager] removeItemAtURL:sourceURL error:nil];
  HarnessFinishTest(testName, failuresBefore);
}

static void TestLateGroupDownloadIsIgnoredAtDeadline(void) {
  NSString *testName = @"lateGroupDownloadIsIgnoredAtDeadline";
  NSInteger failuresBefore = gFailures;
  HarnessResetState();

  NSString *groupURL = @"https://example.invalid/late-group.png";
  dispatch_time_t deadline = dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_MSEC);
  NSTimeInterval startedAt = [NSProcessInfo processInfo].systemUptime;
  INSendMessageIntent *intent = [NotifeeCoreUtil
      generateSenderIntentForCommunicationNotification:HarnessCommunicationInfo(nil, groupURL)
                                              deadline:deadline];
  NSTimeInterval elapsed = [NSProcessInfo processInfo].systemUptime - startedAt;

  HarnessAssert(elapsed < 0.1, testName, @"group join ignored the supplied absolute deadline");
  HarnessAssert([intent imageForParameterNamed:@"speakableGroupName"] == nil, testName,
                @"late group result was applied to the intent");
  HarnessAssert([HarnessImageURLs() count] == 0, testName,
                @"late group URL was passed to INImage before completion");

  long waitResult = dispatch_semaphore_wait(
      gLateGroupFinished, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(NSEC_PER_SEC)));
  HarnessAssert(waitResult == 0, testName, @"late group stub did not finish");
  HarnessAssert([HarnessImageURLs() count] == 0, testName,
                @"late group completion mutated the already-created intent");
  HarnessAssert(HarnessDownloadCountForURL(groupURL) == 1, testName,
                @"late group URL was downloaded an unexpected number of times");
  HarnessFinishTest(testName, failuresBefore);
}

int main(void) {
  @autoreleasepool {
    gStateLock = [NSObject new];
    gPNGData = [[NSData alloc]
        initWithBase64EncodedString:@"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+"
                                    @"A8AAQUBAScY42YAAAAASUVORK5CYII="
                            options:0];
    HarnessResetState();
    HarnessInstallDownloadStub();
    HarnessInstallCommunicationAvatarClockStub();
    HarnessInstallINImageStub();

    TestFileURLPreservesURLSemantics();
    TestAbsolutePathRemainsSupported();
    TestBundleResourceRemainsSupported();
    TestInvalidInputsFallBackSafely();
    TestHTTPAndHTTPSRemainRemote();
    TestHTTPSSenderContractRemainsFileBacked();
    TestHTTPSGroupAvatarIsMaterializedLocally();
    TestIdenticalRemoteAvatarsReuseOneDownload();
    TestIdenticalBoundedRemoteAvatarsReuseOneDownload();
    TestDistinctRemoteAvatarsOverlapWithDistinctFiles();
    TestBoundedSenderCompletionBeforeMediaCutoffIsAccepted();
    TestBoundedSenderCompletionAtMediaCutoffIsRejected();
    TestBoundedSenderCompletionAfterMediaCutoffIsRejected();
    TestBoundedGroupCompletionBeforeMediaCutoffIsAccepted();
    TestBoundedGroupCompletionAtMediaCutoffIsRejected();
    TestBoundedGroupCompletionAfterMediaCutoffIsRejected();
    TestRemoteDownloadsDoNotStartAtMediaCutoff();
    TestLocalAvatarStillResolvesAtMediaCutoff();
    TestLateGroupDownloadIsIgnoredAtDeadline();

    HarnessRemoveDownloadFiles(HarnessDownloadPaths());
  }

  if (gFailures > 0) {
    fprintf(stderr, "%ld communication avatar harness failure(s)\n", (long)gFailures);
    return 1;
  }

  fprintf(stdout, "All communication avatar harness tests passed\n");
  return 0;
}
