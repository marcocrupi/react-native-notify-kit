// Reuse only harness stand-ins; the delegate implementation is compiled into each image.
#define main NotifeeUnusedHarnessMain
#include "NotifeeCoreDelegateChainingHarness.m"
#undef main

void *NotifeeHarnessSingleton(void) {
  return (__bridge void *)[NotifeeCoreUNUserNotificationCenter instance];
}
void *NotifeeHarnessClass(void) {
  return (__bridge void *)[NotifeeCoreUNUserNotificationCenter class];
}
