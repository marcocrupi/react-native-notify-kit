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

#import "NotifeeCoreDelegateHolder.h"

@implementation NotifeeCoreDelegateHolder {
  struct {
    unsigned int didReceiveNotificationEvent : 1;
  } delegateRespondsTo;
}

@synthesize delegate;

+ (instancetype)instance {
  static dispatch_once_t once;
  __strong static NotifeeCoreDelegateHolder *sharedInstance;
  dispatch_once(&once, ^{
    sharedInstance = [[NotifeeCoreDelegateHolder alloc] init];
    sharedInstance.pendingEvents = [[NSMutableArray alloc] init];
  });
  return sharedInstance;
}

- (void)setDelegate:(id<NotifeeCoreDelegate>)aDelegate {
  if (delegate != aDelegate) {
    delegate = aDelegate;
    self->delegateRespondsTo.didReceiveNotificationEvent =
        (unsigned int)[delegate respondsToSelector:@selector(didReceiveNotifeeCoreEvent:)];
    if (self->delegateRespondsTo.didReceiveNotificationEvent) {
      NSArray *eventsToFlush;
      @synchronized(self) {
        eventsToFlush = [self->_pendingEvents copy];
        [self->_pendingEvents removeAllObjects];
      }
      for (NSDictionary *event in eventsToFlush) {
        [self->delegate didReceiveNotifeeCoreEvent:event];
      }
    }
  }
}

- (void)didReceiveNotifeeCoreEvent:(NSDictionary *)notificationEvent {
  if (self->delegateRespondsTo.didReceiveNotificationEvent) {
    id<NotifeeCoreDelegate> strongDelegate = self->delegate;
    if (strongDelegate != nil) {
      [strongDelegate didReceiveNotifeeCoreEvent:notificationEvent];
      return;
    }
  }
  id<NotifeeCoreDelegate> delegateToCall = nil;
  @synchronized(self) {
    // Re-check inside the lock: setDelegate: may have run between the
    // first check and acquiring the lock. If so, deliver directly to
    // avoid an orphan event sitting in _pendingEvents forever.
    if (self->delegateRespondsTo.didReceiveNotificationEvent) {
      delegateToCall = self->delegate;
    }
    // Buffer if the delegate is not set, or if the bitfield is stale
    // (delegateRespondsTo is true but the weak delegate ref has been
    // zeroed — e.g., during JS reload when NotifeeApiModule is deallocated).
    if (delegateToCall == nil) {
      [self->_pendingEvents addObject:notificationEvent];
    }
  }
  if (delegateToCall != nil) {
    [delegateToCall didReceiveNotifeeCoreEvent:notificationEvent];
  }
}

@end
