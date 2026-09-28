const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  inspectSignedApp,
  shellWords,
  expandResponseFiles,
  cleanupWorkspace,
  inspectCompiledRNFirebase,
} = require('../lib/ios-fcm-artifact');

test('signed entitlements, not plist or build labels, determine environment', async () => {
  const tmp = fs.mkdtempSync('/tmp/ios-fcm-entitlement-test-');
  fs.writeFileSync(path.join(tmp, 'Fixture'), 'binary');
  try {
    const execute = (command, args, options) => {
      if (command === 'codesign' && args.includes('--verify')) return '';
      if (command === 'codesign') return '<signed entitlement fixture>';
      if (args.includes(path.join(tmp, 'Info.plist')))
        return JSON.stringify({
          CFBundleExecutable: 'Fixture',
          CFBundleIdentifier: 'fixture',
          'aps-environment': 'production',
        });
      assert.equal(options.input, '<signed entitlement fixture>');
      return JSON.stringify({ 'aps-environment': 'development' });
    };
    assert.equal((await inspectSignedApp(tmp, { execute })).apsEnvironment, 'development');
    await assert.rejects(
      () =>
        inspectSignedApp(tmp, {
          execute: () => {
            throw new Error('unreadable signature');
          },
        }),
      error => error.code === 'SIGNED_ENTITLEMENT_UNREADABLE',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('actual preprocessing: defined DEBUG=0 is sandbox, absence and final -UDEBUG are Prod', async () => {
  const root = fs.mkdtempSync('/tmp/ios-fcm-compiler-test-');
  const source = path.join(root, 'RNFBMessaging+AppDelegate.m');
  fs.writeFileSync(
    source,
    `@implementation RNFBMessagingAppDelegate
- (void)application:(UIApplication *)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken {
#ifdef DEBUG
[[FIRMessaging messaging] setAPNSToken:deviceToken type:FIRMessagingAPNSTokenTypeSandbox];
#else
[[FIRMessaging messaging] setAPNSToken:deviceToken type:FIRMessagingAPNSTokenTypeProd];
#endif
}
@end\n`,
  );
  try {
    for (const [flags, expected] of [
      ['-DDEBUG=0', 'sandbox'],
      ['', 'production'],
      ['-DDEBUG=1 -UDEBUG', 'production'],
    ]) {
      const result = await inspectCompiledRNFirebase({
        workspace: root,
        buildLog: `/usr/bin/clang -x objective-c ${flags} -c ${source} -o ${root}/unused.o`,
      });
      assert.equal(result.automaticEnvironment, expected);
      assert.ok(!fs.existsSync(path.join(root, 'unused.o')));
    }
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
test('compiler response files preserve DEBUG=0 as a defined macro', () => {
  const args = expandResponseFiles(
    shellWords('/clang @"/tmp/common args.resp" -c "/tmp/source name.m"'),
    () => '-DDEBUG=0 -DOTHER=1',
  );
  assert.deepEqual(args, ['/clang', '-DDEBUG=0', '-DOTHER=1', '-c', '/tmp/source name.m']);
});
test('cleanup removes only its marked workspace and refuses foreign paths', () => {
  const root = fs.mkdtempSync('/tmp/ios-fcm-cleanup-test-');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, '.qualification-owner'), 'owned');
  assert.throws(
    () => cleanupWorkspace(workspace, 'foreign'),
    error => error.code === 'QUALIFICATION_CLEANUP_REFUSED',
  );
  assert.ok(fs.existsSync(workspace));
  cleanupWorkspace(workspace, 'owned');
  assert.ok(!fs.existsSync(workspace));
  fs.rmSync(root, { recursive: true });
});
