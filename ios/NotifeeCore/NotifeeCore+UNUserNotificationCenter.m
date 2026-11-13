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

#import "NotifeeCore+UNUserNotificationCenter.h"

#import <objc/runtime.h>

#import "NotifeeCore.h"
#import "NotifeeCoreDelegateHolder.h"
#import "NotifeeCoreUtil.h"

typedef void (^NotifeeCorePresentationCompletionHandler)(UNNotificationPresentationOptions options);
typedef void (^NotifeeCoreVoidCompletionHandler)(void);

@interface NotifeeCore (RollingTimestampTopUp)
+ (void)topUpRollingTimestampTriggersWithCompletion:(void (^)(NSError *error))completion;
@end

@interface NotifeeCoreUNUserNotificationCenter ()
- (void)rechainUserNotificationCenterDelegate;
@end

static NotifeeCorePresentationCompletionHandler NotifeeCoreOneShotPresentationCompletionHandler(
    NotifeeCorePresentationCompletionHandler completionHandler) {
  NSObject *completionLock = [NSObject new];
  __block BOOL completionCalled = NO;

  NotifeeCorePresentationCompletionHandler oneShotCompletionHandler =
      ^(UNNotificationPresentationOptions options) {
        BOOL shouldCallCompletion = NO;
        @synchronized(completionLock) {
          if (!completionCalled) {
            completionCalled = YES;
            shouldCallCompletion = YES;
          }
        }

        if (shouldCallCompletion && completionHandler != nil) {
          completionHandler(options);
        }
      };

  return [oneShotCompletionHandler copy];
}

static NotifeeCoreVoidCompletionHandler NotifeeCoreOneShotVoidCompletionHandler(
    NotifeeCoreVoidCompletionHandler completionHandler) {
  NSObject *completionLock = [NSObject new];
  __block BOOL completionCalled = NO;

  NotifeeCoreVoidCompletionHandler oneShotCompletionHandler = ^{
    BOOL shouldCallCompletion = NO;
    @synchronized(completionLock) {
      if (!completionCalled) {
        completionCalled = YES;
        shouldCallCompletion = YES;
      }
    }

    if (shouldCallCompletion && completionHandler != nil) {
      completionHandler();
    }
  };

  return [oneShotCompletionHandler copy];
}

// Class/ISA pointers differ when two images contain this implementation. Use
// runtime names, then message the trusted peer's accessor; never read its ivars.
static BOOL NotifeeCoreIsDelegatePeer(id delegate) {
  for (Class cls = object_getClass(delegate); cls != Nil; cls = class_getSuperclass(cls)) {
    if (strcmp(class_getName(cls), "NotifeeCoreUNUserNotificationCenter") == 0) return YES;
  }
  return NO;
}

@protocol NotifeeCoreDelegateChain <NSObject>
- (id<UNUserNotificationCenterDelegate>)originalDelegate;
@end

static BOOL NotifeeCoreDelegateChainIsUnsafe(id owner, id candidate) {
  NSMutableArray *visited = [NSMutableArray new];
  id cursor = candidate;
  for (NSUInteger hops = 0; cursor != nil; hops++) {
    if (cursor == owner || [visited indexOfObjectIdenticalTo:cursor] != NSNotFound) return YES;
    if (!NotifeeCoreIsDelegatePeer(cursor)) return NO;  // Opaque SDK: contain only on reentry.
    if (hops >= 32) return YES;                         // Bounded, fail closed.
    [visited addObject:cursor];
    cursor = [(id<NotifeeCoreDelegateChain>)cursor originalDelegate];
  }
  return NO;
}

// Foundation containers and a versioned string key share the synchronous call
// context across binary images, without relying on a per-image registry/Class.
// Identity includes selector, center and event, so nested distinct notifications
// and later deliveries of the same object are independent. No state survives an
// unwind; ordinary asynchronous downstream completions remain unrestricted.
static void NotifeeCoreForward(id owner, id downstream, id center, id event, SEL selector,
                               void (^invoke)(void), void (^fallback)(void)) {
  NSString *key = @"app.notifee.UNUserNotificationCenter.forwarding.v1";
  NSMutableDictionary *threadState = [NSThread currentThread].threadDictionary;
  NSMutableArray *frames = threadState[key];
  for (NSMutableDictionary *active in frames) {
    if (active[@"owner"] == owner && active[@"center"] == (center ?: [NSNull null]) &&
        active[@"event"] == (event ?: [NSNull null]) &&
        [active[@"selector"] isEqualToString:NSStringFromSelector(selector)]) {
      active[@"cycle"] = @YES;
      // The outer invocation completes after the SDK returns, allowing an SDK
      // to supply its own options before or after the recursive call unwinds.
      return;
    }
  }
  if (NotifeeCoreDelegateChainIsUnsafe(owner, downstream)) {
    fallback();
    return;
  }
  if (frames == nil) {
    frames = [NSMutableArray new];
    threadState[key] = frames;
  }
  NSMutableDictionary *frame = [@{
    @"owner" : owner,
    @"center" : center ?: [NSNull null],
    @"event" : event ?: [NSNull null],
    @"selector" : NSStringFromSelector(selector),
    @"cycle" : @NO
  } mutableCopy];
  [frames addObject:frame];
  @try {
    invoke();
    // Only a proven synchronous cycle triggers fallback. The caller passes a
    // one-shot block, preserving any options already supplied by the downstream.
    if ([frame[@"cycle"] boolValue]) fallback();
  } @finally {
    [frames removeObjectIdenticalTo:frame];
    if (frames.count == 0) [threadState removeObjectForKey:key];
  }
}

static UNNotificationPresentationOptions NotifeeCoreDefaultPresentationOptions(void) {
  return UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound |
         UNNotificationPresentationOptionList | UNNotificationPresentationOptionBadge;
}

@implementation NotifeeCoreUNUserNotificationCenter

+ (instancetype)instance {
  static dispatch_once_t once;
  __strong static NotifeeCoreUNUserNotificationCenter *sharedInstance;
  dispatch_once(&once, ^{
    sharedInstance = [[NotifeeCoreUNUserNotificationCenter alloc] init];
    sharedInstance.initialNotification = nil;
    sharedInstance.initialNotificationGathered = false;
    sharedInstance.initialNotificationBlock = nil;
    sharedInstance.shouldHandleRemoteNotifications = YES;
  });
  return sharedInstance;
}

- (void)observe {
  [self rechainUserNotificationCenterDelegate];
}

- (void)rechainUserNotificationCenterDelegate {
  @synchronized(self) {
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    id<UNUserNotificationCenterDelegate> currentDelegate = center.delegate;
    if (currentDelegate == self) return;

    // Leave an installed peer in charge. Replacing it loses its healthy leaf
    // and permits independent singletons to adopt each other on activation.
    // Preserve our existing downstream when a candidate is demonstrably unsafe.
    if (NotifeeCoreIsDelegatePeer(currentDelegate) ||
        NotifeeCoreDelegateChainIsUnsafe(self, currentDelegate))
      return;

    self.originalDelegate = currentDelegate;
    center.delegate = self;
  }
}

- (void)markInitialNotificationGathered {
  _initialNotificationGathered = YES;
}

- (nullable NSDictionary *)getInitialNotification {
  if (_initialNotificationGathered && _initialNotificationBlock != nil) {
    // copying initial notification
    if (_initialNotification != nil && _notificationOpenedAppID != nil) {
      NSDictionary *initialNotificationCopy = [_initialNotification copy];
      _initialNotification = nil;
      _initialNotificationBlock(nil, initialNotificationCopy);
    } else {
      _initialNotificationBlock(nil, nil);
    }

    _initialNotificationBlock = nil;
  }

  return nil;
}

- (BOOL)isRollingTimestampNotificationRequest:(UNNotificationRequest *)request {
  if ([NotifeeCoreUtil isRollingInternalNotificationId:request.identifier]) {
    return YES;
  }

  NSDictionary *trigger = request.content.userInfo[kNotifeeUserInfoTrigger];
  return [NotifeeCoreUtil isRollingTimestampTrigger:trigger];
}

- (void)topUpRollingTimestampTriggersForLifecycleEvent:(NSString *)eventName {
  [NotifeeCore topUpRollingTimestampTriggersWithCompletion:^(NSError *error) {
    if (error != nil) {
      NSLog(@"NotifeeCore: Failed to top up rolling timestamp triggers after %@: %@", eventName,
            error);
    }
  }];
}

#pragma mark - UNUserNotificationCenter Delegate Methods

// The method will be called on the delegate only if the application is in the
// foreground. If the the handler is not called in a timely manner then the
// notification will not be presented. The application can choose to have the
// notification presented as a sound, badge, alert and/or in the notification
// list. This decision should be based on whether the information in the
// notification is otherwise visible to the user.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:
             (void (^)(UNNotificationPresentationOptions options))completionHandler {
  id<UNUserNotificationCenterDelegate> downstream = self.originalDelegate;
  NSDictionary *notifeeNotification =
      notification.request.content.userInfo[kNotifeeUserInfoNotification];
  BOOL isRollingTimestampNotification =
      [self isRollingTimestampNotificationRequest:notification.request];

  // we only care about notifications created through notifee
  if (notifeeNotification != nil) {
    UNNotificationPresentationOptions presentationOptions = UNNotificationPresentationOptionNone;
    NSDictionary *foregroundPresentationOptions =
        notifeeNotification[@"ios"][@"foregroundPresentationOptions"];

    BOOL alert = [foregroundPresentationOptions[@"alert"] boolValue];
    BOOL badge = [foregroundPresentationOptions[@"badge"] boolValue];
    BOOL sound = [foregroundPresentationOptions[@"sound"] boolValue];
    BOOL banner = [foregroundPresentationOptions[@"banner"] boolValue];
    BOOL list = [foregroundPresentationOptions[@"list"] boolValue];

    if (badge) {
      presentationOptions |= UNNotificationPresentationOptionBadge;
    }

    if (sound) {
      presentationOptions |= UNNotificationPresentationOptionSound;
    }

    // if list or banner is true, ignore alert property
    if (banner || list) {
      if (banner) {
        presentationOptions |= UNNotificationPresentationOptionBanner;
      }

      if (list) {
        presentationOptions |= UNNotificationPresentationOptionList;
      }
    } else if (alert) {
      // TODO: remove alert once it has been fully removed from the notifee API
      presentationOptions |=
          UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList;
    }

    // Emit DELIVERED for every Notifee-owned notification presented in foreground.
    // Previously guarded by `notifeeTrigger != nil`, which suppressed the event for
    // displayNotification() calls — only trigger notifications got DELIVERED in foreground.
    // Android emits DELIVERED unconditionally; this aligns iOS behavior.
    [[NotifeeCoreDelegateHolder instance] didReceiveNotifeeCoreEvent:@{
      @"type" : @(NotifeeCoreEventTypeDelivered),
      @"detail" : @{
        @"notification" : notifeeNotification,
      }
    }];

    completionHandler(presentationOptions);
    if (isRollingTimestampNotification) {
      [self topUpRollingTimestampTriggersForLifecycleEvent:@"foreground delivery"];
    }

  } else if ([downstream respondsToSelector:_cmd]) {
    NotifeeCorePresentationCompletionHandler done =
        NotifeeCoreOneShotPresentationCompletionHandler(completionHandler);
    NotifeeCoreForward(
        self, downstream, center, notification, _cmd,
        ^{
          [downstream userNotificationCenter:center
                     willPresentNotification:notification
                       withCompletionHandler:done];
        },
        ^{
          done(NotifeeCoreDefaultPresentationOptions());
        });
  } else {
    completionHandler(NotifeeCoreDefaultPresentationOptions());
  }
}

// The method will be called when the user responded to the notification by
// opening the application, dismissing the notification or choosing a
// UNNotificationAction. The delegate must be set before the application returns
// from application:didFinishLaunchingWithOptions:.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  NSDictionary *notifeeNotification =
      response.notification.request.content.userInfo[kNotifeeUserInfoNotification];
  BOOL isRollingTimestampNotification =
      [self isRollingTimestampNotificationRequest:response.notification.request];

  _notificationOpenedAppID = notifeeNotification[@"id"];

  // External notifications prefer downstream handling in both flag states.
  if (notifeeNotification == nil) {
    id<UNUserNotificationCenterDelegate> downstream = self.originalDelegate;
    if ([downstream respondsToSelector:_cmd]) {
      NotifeeCoreVoidCompletionHandler done =
          NotifeeCoreOneShotVoidCompletionHandler(completionHandler);
      NotifeeCoreForward(
          self, downstream, center, response, _cmd,
          ^{
            [downstream userNotificationCenter:center
                didReceiveNotificationResponse:response
                         withCompletionHandler:done];
          },
          ^{
            done();
          });
      return;
    }
    if (!self.shouldHandleRemoteNotifications) {
      completionHandler();
      return;
    }
    notifeeNotification =
        [NotifeeCoreUtil parseUNNotificationRequest:response.notification.request];
  }

  if (notifeeNotification != nil) {
    if ([response.actionIdentifier isEqualToString:UNNotificationDismissActionIdentifier]) {
      // post DISMISSED event, only triggers if notification has a categoryId
      [[NotifeeCoreDelegateHolder instance] didReceiveNotifeeCoreEvent:@{
        @"type" : @(NotifeeCoreEventTypeDismissed),
        @"detail" : @{
          @"notification" : notifeeNotification,
        }
      }];
      completionHandler();
      if (isRollingTimestampNotification) {
        [self topUpRollingTimestampTriggersForLifecycleEvent:@"notification response"];
      }
      return;
    }

    NSNumber *eventType;
    NSMutableDictionary *event = [NSMutableDictionary dictionary];
    NSMutableDictionary *eventDetail = [NSMutableDictionary dictionary];
    NSMutableDictionary *eventDetailPressAction = [NSMutableDictionary dictionary];

    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
      eventType = @1;  // PRESS
      // event.detail.pressAction.id
      eventDetailPressAction[@"id"] = @"default";
    } else {
      eventType = @2;  // ACTION_PRESS
      // event.detail.pressAction.id
      eventDetailPressAction[@"id"] = response.actionIdentifier;
    }

    if ([response isKindOfClass:UNTextInputNotificationResponse.class]) {
      // event.detail.input
      eventDetail[@"input"] = [(UNTextInputNotificationResponse *)response userText];
    }

    // event.type
    event[@"type"] = eventType;

    // event.detail.notification
    eventDetail[@"notification"] = notifeeNotification;

    // event.detail.pressAction
    eventDetail[@"pressAction"] = eventDetailPressAction;

    // event.detail
    event[@"detail"] = eventDetail;

    // store notification for getInitialNotification
    _initialNotification = [eventDetail copy];

    [[NotifeeCoreDelegateHolder instance] didReceiveNotifeeCoreEvent:event];

    completionHandler();
    if (isRollingTimestampNotification) {
      [self topUpRollingTimestampTriggersForLifecycleEvent:@"notification response"];
    }
  } else {
    // Defensive: parseUNNotificationRequest: currently never returns nil,
    // but if it did, the completionHandler contract must still be honored.
    completionHandler();
  }
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    openSettingsForNotification:(nullable UNNotification *)notification {
  id<UNUserNotificationCenterDelegate> downstream = self.originalDelegate;
  if ([downstream respondsToSelector:_cmd]) {
    if (@available(iOS 12.0, macOS 10.14, macCatalyst 13.0, *)) {
      NotifeeCoreForward(self, downstream, center, notification, _cmd,
                         ^{
                           [downstream userNotificationCenter:center
                                  openSettingsForNotification:notification];
                         },
                         ^{
                         });
    }
  }
}

@end
