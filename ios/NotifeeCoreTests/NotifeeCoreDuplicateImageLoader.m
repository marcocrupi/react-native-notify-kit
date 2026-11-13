#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <dlfcn.h>
#import <objc/runtime.h>

@protocol HarnessPeer <UNUserNotificationCenterDelegate>
@property(nonatomic, weak) id<UNUserNotificationCenterDelegate> originalDelegate;
@property(nonatomic) BOOL shouldHandleRemoteNotifications;
- (void)observe;
@end
@interface ImageHarnessCenter : NSObject
@property(nonatomic, weak) id<UNUserNotificationCenterDelegate> delegate;
@end
@implementation ImageHarnessCenter
@end
@interface ImageHarnessNotification : NSObject
@property(nonatomic, strong) UNNotificationRequest *request;
@end
@implementation ImageHarnessNotification
@end
@interface ImageHarnessResponse : NSObject
@property(nonatomic, strong) id notification;
@property(nonatomic, copy) NSString *actionIdentifier;
@end
@implementation ImageHarnessResponse
@end

@interface ImageHarnessProxy : NSObject <UNUserNotificationCenterDelegate>
@property(nonatomic, weak) id<UNUserNotificationCenterDelegate> next;
@end
@implementation ImageHarnessProxy
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))done {
  [self.next userNotificationCenter:center
            willPresentNotification:notification
              withCompletionHandler:done];
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))done {
  [self.next userNotificationCenter:center
      didReceiveNotificationResponse:response
               withCompletionHandler:done];
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    openSettingsForNotification:(UNNotification *)notification {
  [self.next userNotificationCenter:center openSettingsForNotification:notification];
}
@end

static int failures = 0;
static void Check(BOOL condition, const char *message) {
  printf("[duplicate-image] %s %s\n", condition ? "PASS" : "FAIL", message);
  if (!condition) failures++;
}
static void Bound(Class cls, SEL sel, BOOL hasCompletion) {
  Method method = class_getInstanceMethod(cls, sel);
  IMP original = method_getImplementation(method);
  __block int depth = 0;
  id block;
  if (hasCompletion) {
    block = ^(id obj, id center, id event, id done) {
      if (depth >= 8)
        @throw [NSException exceptionWithName:@"BoundedCycle"
                                       reason:@"cross-image recursion"
                                     userInfo:nil];
      depth++;
      @try {
        ((void (*)(id, SEL, id, id, id))original)(obj, sel, center, event, done);
      } @finally {
        depth--;
      }
    };
  } else {
    block = ^(id obj, id center, id event) {
      if (depth >= 8)
        @throw [NSException exceptionWithName:@"BoundedCycle"
                                       reason:@"cross-image recursion"
                                     userInfo:nil];
      depth++;
      @try {
        ((void (*)(id, SEL, id, id))original)(obj, sel, center, event);
      } @finally {
        depth--;
      }
    };
  }
  method_setImplementation(method, imp_implementationWithBlock(block));
}
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc != 3) return 2;
    void *first = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    void *second = dlopen(argv[2], RTLD_NOW | RTLD_LOCAL);
    if (!first || !second) {
      fprintf(stderr, "%s\n", dlerror());
      return 2;
    }
    void *(*getA)(void) = dlsym(first, "NotifeeHarnessSingleton");
    void *(*getB)(void) = dlsym(second, "NotifeeHarnessSingleton");
    void *(*classA)(void) = dlsym(first, "NotifeeHarnessClass");
    void *(*classB)(void) = dlsym(second, "NotifeeHarnessClass");
    if (!getA || !getB || !classA || !classB) return 2;
    id<HarnessPeer> a = (__bridge id)getA(), b = (__bridge id)getB();
    Class isa = object_getClass(a), isb = object_getClass(b);
    printf("[duplicate-image] Class refs %p %p; ISA %p %p; singletons %p %p\n", classA(), classB(),
           isa, isb, (__bridge void *)a, (__bridge void *)b);
    Check(a != b && isa != isb && classA() != classB(),
          "distinct singletons, Class and ISA across binary images");
    Check(![(id)b isKindOfClass:isa], "local isKindOfClass cannot detect foreign peer");
    ImageHarnessCenter *stub = [ImageHarnessCenter new];
    Method current =
        class_getClassMethod(UNUserNotificationCenter.class, @selector(currentNotificationCenter));
    method_setImplementation(current, imp_implementationWithBlock(^id(id obj) {
                               return stub;
                             }));
    UNUserNotificationCenter *center = (id)stub;
    [a observe];
    [b observe];
    [a observe];
    Check(!(a.originalDelegate == b && b.originalDelegate == a),
          "A.observe B.observe A.observe prevents adoption cycle");
    NSArray *selectors = @[
      @"userNotificationCenter:willPresentNotification:withCompletionHandler:",
      @"userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:",
      @"userNotificationCenter:openSettingsForNotification:"
    ];
    for (NSString *name in selectors) {
      Bound(isa, NSSelectorFromString(name), [name containsString:@"withCompletionHandler:"]);
      Bound(isb, NSSelectorFromString(name), [name containsString:@"withCompletionHandler:"]);
    }
    ImageHarnessNotification *notification = [ImageHarnessNotification new];
    notification.request =
        [UNNotificationRequest requestWithIdentifier:@"same-id"
                                             content:[UNMutableNotificationContent new]
                                             trigger:nil];
    ImageHarnessResponse *response = [ImageHarnessResponse new];
    response.notification = notification;
    response.actionIdentifier = UNNotificationDefaultActionIdentifier;
    for (NSString *topology in @[ @"trusted", @"opaque" ]) {
      for (NSNumber *flag in @[ @NO, @YES ]) {
        a.shouldHandleRemoteNotifications = flag.boolValue;
        b.shouldHandleRemoteNotifications = flag.boolValue;
        ImageHarnessProxy *proxyA = [ImageHarnessProxy new], *proxyB = [ImageHarnessProxy new];
        proxyA.next = b;
        proxyB.next = a;
        // Corrupt retained state after adoption, including opaque SDKs between images.
        a.originalDelegate = [topology isEqualToString:@"trusted"] ? b : proxyA;
        b.originalDelegate = [topology isEqualToString:@"trusted"] ? a : proxyB;
        for (NSInteger selector = 0; selector < 3; selector++) {
          __block int count = 0;
          BOOL bounded = YES;
          @try {
            if (selector == 0)
              [a userNotificationCenter:center
                  willPresentNotification:(id)notification
                    withCompletionHandler:^(UNNotificationPresentationOptions value) {
                      count++;
                    }];
            if (selector == 1)
              [a userNotificationCenter:center
                  didReceiveNotificationResponse:(id)response
                           withCompletionHandler:^{
                             count++;
                           }];
            if (selector == 2)
              [a userNotificationCenter:center openSettingsForNotification:(id)notification];
          } @catch (NSException *e) {
            if (![e.name isEqualToString:@"BoundedCycle"]) @throw;
            bounded = NO;
          }
          NSString *label = [NSString
              stringWithFormat:@"%@ flag%@ selector%ld: bounded, completion once where applicable",
                               topology, flag, (long)selector];
          Check(bounded && (selector == 2 || count == 1), label.UTF8String);
        }
      }
    }
  }
  return failures ? 1 : 0;
}
