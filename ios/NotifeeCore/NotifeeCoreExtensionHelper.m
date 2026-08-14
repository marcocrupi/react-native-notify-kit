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

#import "NotifeeCoreExtensionHelper.h"
#import "Intents/Intents.h"
#import "NotifeeCore.h"
#import "NotifeeCoreUtil.h"

static NSString *const kNoExtension = @"";
static NSString *const kImagePathPrefix = @"image/";
static NSTimeInterval const kNotifeeExtensionOrchestrationTimeoutInterval = 25.0;
static NSTimeInterval const kNotifeeExtensionFinalizationReserveInterval = 5.0;

@interface NotifeeCoreUtil (NotifeeCoreExtensionHelper)
+ (INSendMessageIntent *)generateSenderIntentForCommunicationNotification:
                             (NSDictionary *)communicationInfo
                                                                 deadline:(dispatch_time_t)deadline;
@end

@interface NotifeeCoreExtensionHelper ()
- (NSMutableDictionary *)parseNotifeeOptions:(id)payload;
- (NSTimeInterval)orchestrationTimeoutInterval;
- (dispatch_time_t)orchestrationCurrentTime;
- (void)scheduleOrchestrationFinalizerAtDeadline:(dispatch_time_t)deadline
                                           block:(dispatch_block_t)block;
- (void)loadAttachment:(NSDictionary *)attachmentDict
     completionHandler:(void (^)(UNNotificationAttachment *))completionHandler;
@end

@interface NotifeeCoreExtensionRequestContext : NSObject
@property(nonatomic, strong) NotifeeCoreExtensionHelper *helper;
@property(nonatomic, copy) void (^contentHandler)(UNNotificationContent *content);
@property(nonatomic, strong) UNMutableNotificationContent *modifiedContent;
@property(nonatomic, assign) BOOL notificationDelivered;
@property(nonatomic, assign) BOOL orchestrationExpired;
@property(nonatomic, assign) BOOL attachmentCompleted;
@property(nonatomic, assign) BOOL communicationCompleted;
@property(nonatomic, strong, nullable) UNNotificationAttachment *pendingAttachment;
@property(nonatomic, assign) dispatch_time_t orchestrationDeadline;
@property(nonatomic, assign) dispatch_time_t mediaCutoff;

- (instancetype)initWithHelper:(NotifeeCoreExtensionHelper *)helper
                       content:(UNMutableNotificationContent *)content
                contentHandler:(void (^)(UNNotificationContent *content))contentHandler;
- (void)populateNotificationContentWithRequest:(UNNotificationRequest *_Nullable)request;
- (NSDictionary *)attachmentDictionaryFromOptions:(NSMutableDictionary *)options;
- (void)startOrchestrationWithOptions:(NSMutableDictionary *)options;
- (void)processCommunicationData:(NSMutableDictionary *)options;
- (void)completeAttachment:(UNNotificationAttachment *_Nullable)attachment;
- (void)completeCommunicationWithContent:
    (UNMutableNotificationContent *_Nullable)communicationContent;
- (BOOL)markExpiredIfDeadlineReachedLocked;
- (void)expireAndDeliverNotification;
- (void)deliverNotificationIfReady;
- (void)deliverNotification;
@end

@implementation NotifeeCoreExtensionRequestContext

- (instancetype)initWithHelper:(NotifeeCoreExtensionHelper *)helper
                       content:(UNMutableNotificationContent *)content
                contentHandler:(void (^)(UNNotificationContent *content))contentHandler {
  self = [super init];
  if (self != nil) {
    self.helper = helper;
    self.contentHandler = [contentHandler copy];
    self.modifiedContent = content;
    self.notificationDelivered = NO;
    self.orchestrationExpired = NO;
    self.attachmentCompleted = NO;
    self.communicationCompleted = NO;
    NSTimeInterval timeoutInterval = [helper orchestrationTimeoutInterval];
    self.orchestrationDeadline =
        dispatch_time([helper orchestrationCurrentTime],
                      (int64_t)(MAX(timeoutInterval, 0.0) * (NSTimeInterval)NSEC_PER_SEC));
    self.mediaCutoff = dispatch_time(
        self.orchestrationDeadline,
        -(int64_t)(kNotifeeExtensionFinalizationReserveInterval * (NSTimeInterval)NSEC_PER_SEC));
  }

  return self;
}

- (void)populateNotificationContentWithRequest:(UNNotificationRequest *_Nullable)request {
  id notifeeOptionsPayload = self.modifiedContent.userInfo[kPayloadOptionsName];
  if (!notifeeOptionsPayload) {
    [self deliverNotification];
    return;
  }

  // fcm: apns: { payload: {notifee_options: "{}" } }
  NSMutableDictionary *options = [self.helper parseNotifeeOptions:notifeeOptionsPayload];
  if (options == nil) {
    [self deliverNotification];
    return;
  }

  options[@"remote"] = @YES;

  // Convert options to Notification and set defaults
  if (options[@"data"] == nil) {
    options[@"data"] = [NSDictionary dictionary];
  }

  // Pass id to event handler
  if (request != nil && options[@"id"] == nil) {
    options[@"id"] = request.identifier;
  }

  if (options[@"title"] == nil && self.modifiedContent.title != nil) {
    options[@"title"] = self.modifiedContent.title;
  }

  if (options[@"body"] == nil) {
    options[@"body"] = self.modifiedContent.body;
  }

  self.modifiedContent = [NotifeeCore buildNotificationContent:options withTrigger:nil];
  [self startOrchestrationWithOptions:options];
}

- (NSDictionary *)attachmentDictionaryFromOptions:(NSMutableDictionary *)options {
  NSMutableDictionary *attachmentDict = [NSMutableDictionary new];

  if (options[@"ios"] != nil && options[@"ios"][@"attachments"] != nil &&
      [options[@"ios"][@"attachments"] isKindOfClass:[NSArray class]] &&
      [options[@"ios"][@"attachments"] count] != 0) {
    attachmentDict = options[@"ios"][@"attachments"][0];
  }

  // Check if image url is in payload and parse it if attachmentDict is empty
  NSString *currentImageURL = options[kPayloadOptionsImageURLName];
  if ([attachmentDict count] == 0 && ![currentImageURL isEqual:[NSNull null]] &&
      currentImageURL.length > 1) {
    // make into an attachment dict
    attachmentDict[@"url"] = currentImageURL;
  }

  return attachmentDict;
}

- (void)startOrchestrationWithOptions:(NSMutableDictionary *)options {
  NSDictionary *attachmentDict = [self attachmentDictionaryFromOptions:options];
  BOOL hasAttachment = [attachmentDict count] != 0;
  BOOL hasCommunication = options[@"ios"] != nil && options[@"ios"][@"communicationInfo"] != nil;
  dispatch_time_t finalDeadline = 0;

  @synchronized(self) {
    self.attachmentCompleted = !hasAttachment;
    self.communicationCompleted = !hasCommunication;
    finalDeadline = self.orchestrationDeadline;
  }

  if (!hasAttachment && !hasCommunication) {
    [self deliverNotification];
    return;
  }

  __weak __typeof(self) weakSelf = self;
  [self.helper scheduleOrchestrationFinalizerAtDeadline:finalDeadline
                                                  block:^{
                                                    [weakSelf expireAndDeliverNotification];
                                                  }];

  // Start the attachment first so its existing network timeout overlaps avatar
  // materialization.
  if (hasAttachment) {
    [self.helper loadAttachment:attachmentDict
              completionHandler:^(UNNotificationAttachment *attachment) {
                [self completeAttachment:attachment];
              }];
  }

  if (hasCommunication) {
    [self processCommunicationData:options];
  }
}

- (void)processCommunicationData:(NSMutableDictionary *)options {
  if (@available(iOS 15.0, *)) {
    NSMutableDictionary *communicationInfo = [options[@"ios"][@"communicationInfo"] mutableCopy];
    communicationInfo[@"body"] = options[@"body"];

    UNMutableNotificationContent *contentForProvider = nil;
    dispatch_time_t mediaCutoff = 0;
    BOOL shouldDeliverExpiredContent = NO;
    @synchronized(self) {
      if (!self.notificationDelivered && ![self markExpiredIfDeadlineReachedLocked] &&
          self.modifiedContent != nil) {
        contentForProvider = [self.modifiedContent mutableCopy];
        mediaCutoff = self.mediaCutoff;
      } else if (!self.notificationDelivered && self.orchestrationExpired) {
        shouldDeliverExpiredContent = YES;
      }
    }

    if (contentForProvider == nil) {
      if (shouldDeliverExpiredContent) {
        [self deliverNotification];
      }
      return;
    }

    INSendMessageIntent *intent = [NotifeeCoreUtil
        generateSenderIntentForCommunicationNotification:options[@"ios"][@"communicationInfo"]
                                                deadline:mediaCutoff];

    BOOL providerMayStart = NO;
    shouldDeliverExpiredContent = NO;
    @synchronized(self) {
      providerMayStart = !self.notificationDelivered && ![self markExpiredIfDeadlineReachedLocked];
      shouldDeliverExpiredContent = !self.notificationDelivered && self.orchestrationExpired;
    }

    if (!providerMayStart) {
      if (shouldDeliverExpiredContent) {
        [self deliverNotification];
      }
      return;
    }

    // Use the intent to initialize the interaction.
    INInteraction *interaction = [[INInteraction alloc] initWithIntent:intent response:nil];
    interaction.direction = INInteractionDirectionIncoming;

    NSError *error = nil;
    UNNotificationContent *updatedContent =
        [contentForProvider contentByUpdatingWithProvider:intent error:&error];
    if (error) {
      NSLog(@"NotifeeCoreExtensionHelper: Could not update notification "
            @"content: %@",
            error);
      [self completeCommunicationWithContent:nil];
      return;
    }

    NSLog(@"NotifeeCoreExtensionHelper: Processing communication notification");
    [self completeCommunicationWithContent:[updatedContent mutableCopy]];

    [interaction donateInteractionWithCompletion:^(NSError *error) {
      if (error)
        NSLog(@"NotifeeCoreExtensionHelper: Could not donate interaction for "
              @"communication "
              @"notification: %@",
              error);
    }];
  } else {
    // Skip, Communication notifications not supported on iOS 15
    [self completeCommunicationWithContent:nil];
  }
}

- (void)completeAttachment:(UNNotificationAttachment *_Nullable)attachment {
  @synchronized(self) {
    if (self.notificationDelivered) {
      return;
    }

    if ([self markExpiredIfDeadlineReachedLocked]) {
      // The finalizer may still be waiting for its queue. Converge immediately
      // on the same request-local delivery path without publishing this late
      // result.
    } else if (self.attachmentCompleted) {
      return;
    } else {
      self.pendingAttachment = attachment;
      self.attachmentCompleted = YES;
    }
  }

  [self deliverNotificationIfReady];
}

- (void)completeCommunicationWithContent:
    (UNMutableNotificationContent *_Nullable)communicationContent {
  @synchronized(self) {
    if (self.notificationDelivered) {
      return;
    }

    if ([self markExpiredIfDeadlineReachedLocked]) {
      // A provider completion at or after D is not allowed to win merely
      // because the scheduled finalizer has not executed yet.
    } else if (self.communicationCompleted) {
      return;
    } else {
      if (communicationContent != nil) {
        self.modifiedContent = communicationContent;
      }
      self.communicationCompleted = YES;
    }
  }

  [self deliverNotificationIfReady];
}

- (BOOL)markExpiredIfDeadlineReachedLocked {
  if (!self.orchestrationExpired && self.orchestrationDeadline != DISPATCH_TIME_FOREVER &&
      [self.helper orchestrationCurrentTime] >= self.orchestrationDeadline) {
    self.orchestrationExpired = YES;
  }

  return self.orchestrationExpired;
}

- (void)expireAndDeliverNotification {
  @synchronized(self) {
    if (self.notificationDelivered) {
      return;
    }
    self.orchestrationExpired = YES;
  }

  [self deliverNotification];
}

- (void)deliverNotificationIfReady {
  BOOL readyToDeliver = NO;
  @synchronized(self) {
    readyToDeliver =
        !self.notificationDelivered && ([self markExpiredIfDeadlineReachedLocked] ||
                                        (self.attachmentCompleted && self.communicationCompleted));
  }

  if (readyToDeliver) {
    [self deliverNotification];
  }
}

- (void)deliverNotification {
  void (^contentHandler)(UNNotificationContent *) = nil;
  UNNotificationContent *modifiedContent = nil;

  @synchronized(self) {
    if (self.notificationDelivered || self.contentHandler == nil) {
      return;
    }

    [self markExpiredIfDeadlineReachedLocked];

    if (self.pendingAttachment != nil && self.modifiedContent != nil) {
      self.modifiedContent.attachments = @[ self.pendingAttachment ];
    }

    contentHandler = [self.contentHandler copy];
    modifiedContent = self.modifiedContent;
    self.notificationDelivered = YES;
    self.contentHandler = nil;
    self.modifiedContent = nil;
    self.pendingAttachment = nil;
  }

  if (contentHandler != nil && modifiedContent != nil) {
    contentHandler(modifiedContent);
  }
}

@end

@implementation NotifeeCoreExtensionHelper
+ (NotifeeCoreExtensionHelper *)instance {
  static dispatch_once_t once;
  static NotifeeCoreExtensionHelper *instance;
  dispatch_once(&once, ^{
    instance = [[self alloc] init];
  });

  return instance;
}

- (NSTimeInterval)orchestrationTimeoutInterval {
  return kNotifeeExtensionOrchestrationTimeoutInterval;
}

- (dispatch_time_t)orchestrationCurrentTime {
  return dispatch_time(DISPATCH_TIME_NOW, 0);
}

- (void)scheduleOrchestrationFinalizerAtDeadline:(dispatch_time_t)deadline
                                           block:(dispatch_block_t)block {
  dispatch_after(deadline, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), block);
}

- (NSMutableDictionary *)parseNotifeeOptions:(id)payload {
  if ([payload isKindOfClass:[NSDictionary class]]) {
    return [payload mutableCopy];
  }

  if ([payload isKindOfClass:[NSString class]]) {
    NSData *optionsData = [payload dataUsingEncoding:NSUTF8StringEncoding];
    if (optionsData == nil) {
      NSLog(@"NotifeeCoreExtensionHelper: Could not decode notifee_options "
            @"string as UTF-8");
      return nil;
    }

    NSError *error = nil;
    id jsonObject = [NSJSONSerialization JSONObjectWithData:optionsData
                                                    options:NSJSONReadingFragmentsAllowed
                                                      error:&error];

    if (error != nil) {
      NSLog(@"NotifeeCoreExtensionHelper: Could not parse notifee_options "
            @"JSON: %@",
            error);
      return nil;
    }

    if (![jsonObject isKindOfClass:[NSDictionary class]]) {
      NSLog(@"NotifeeCoreExtensionHelper: Ignoring notifee_options JSON "
            @"because it is not a "
            @"dictionary: %@",
            NSStringFromClass([jsonObject class]));
      return nil;
    }

    return [jsonObject mutableCopy];
  }

  NSLog(@"NotifeeCoreExtensionHelper: Ignoring notifee_options because it is "
        @"not a dictionary "
        @"or JSON string: %@",
        NSStringFromClass([payload class]));
  return nil;
}

- (void)populateNotificationContent:(UNNotificationRequest *_Nullable)request
                        withContent:(UNMutableNotificationContent *)content
                 withContentHandler:(void (^)(UNNotificationContent *_Nonnull))contentHandler {
  NotifeeCoreExtensionRequestContext *context =
      [[NotifeeCoreExtensionRequestContext alloc] initWithHelper:self
                                                         content:content
                                                  contentHandler:contentHandler];
  [context populateNotificationContentWithRequest:request];
}

- (NSString *)fileExtensionForResponse:(NSURLResponse *)response {
  NSString *suggestedPathExtension = [response.suggestedFilename pathExtension];
  if (suggestedPathExtension.length > 0) {
    return [NSString stringWithFormat:@".%@", suggestedPathExtension];
  }
  if ([response.MIMEType containsString:kImagePathPrefix]) {
    return [response.MIMEType stringByReplacingOccurrencesOfString:kImagePathPrefix
                                                        withString:@"."];
  }
  return kNoExtension;
}

- (void)loadAttachment:(NSDictionary *)attachmentDict
     completionHandler:(void (^)(UNNotificationAttachment *))completionHandler {
  @try {
    __block UNNotificationAttachment *attachment = nil;
    NSString *attachmentIdentifier = attachmentDict[@"id"];
    NSURL *attachmentURL = [NSURL URLWithString:attachmentDict[@"url"]];

    // NSE has a ~30-second budget before iOS calls
    // serviceExtensionTimeWillExpire and kills the process. Cap the download at
    // 25 seconds to leave a 5-second margin for graceful fallback via the
    // extension's expiration handler.
    NSURLSessionConfiguration *config = [NSURLSessionConfiguration defaultSessionConfiguration];
    config.timeoutIntervalForRequest = 25.0;
    config.timeoutIntervalForResource = 25.0;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:config];
    [[session downloadTaskWithURL:attachmentURL
                completionHandler:^(NSURL *temporaryFileLocation, NSURLResponse *response,
                                    NSError *error) {
                  if (error != nil) {
                    NSLog(@"NotifeeCoreExtensionHelper: An exception occurred while "
                          @"attempting to download "
                          @"image with URL %@: "
                          @"%@",
                          attachmentURL, error);
                    completionHandler(attachment);
                    return;
                  }

                  NSFileManager *fileManager = [NSFileManager defaultManager];
                  NSString *fileExtension = [self fileExtensionForResponse:response];
                  NSURL *localURL =
                      [NSURL fileURLWithPath:[temporaryFileLocation.path
                                                 stringByAppendingString:fileExtension]];
                  [fileManager moveItemAtURL:temporaryFileLocation toURL:localURL error:&error];
                  if (error) {
                    NSLog(@"NotifeeCoreExtensionHelper: Failed to move the image "
                          @"file to local location: "
                          @"%@, error %@",
                          localURL, error);
                    completionHandler(attachment);
                    return;
                  }

                  attachment = [UNNotificationAttachment
                      attachmentWithIdentifier:attachmentIdentifier
                                           URL:localURL
                                       options:[NotifeeCoreUtil
                                                   attachmentOptionsFromDictionary:attachmentDict]
                                         error:&error];
                  if (error) {
                    NSLog(@"NotifeeCoreExtensionHelper: Failed to create attachment "
                          @"with URL: %@, error %@",
                          localURL, error);
                    completionHandler(attachment);
                    return;
                  }
                  completionHandler(attachment);
                }] resume];
  } @catch (NSException *exception) {
    NSLog(@"NotifeeCoreExtensionHelper: Failed to create attachment: %@, error "
          @"%@",
          attachmentDict, exception.reason);
    completionHandler(nil);
  }
}

@end
