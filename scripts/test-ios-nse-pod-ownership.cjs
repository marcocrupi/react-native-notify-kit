#!/usr/bin/env node
'use strict';
// Isolated CocoaPods graph qualification; RN dependency installation is stubbed
// in the Ruby probe. This proves generated Podfile ownership, not an Expo build.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const expo = require('../packages/react-native/plugin/build/shared/nse/patchPodfile');
const cli = require('../packages/cli/dist/lib/patchPodfile');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notifee-issue95-pods-'));
const pkg = path.join(root, 'package');
fs.mkdirSync(pkg);
for (const entry of ['package.json', 'RNNotifee.podspec', 'RNNotifeeCore.podspec', 'ios']) {
  fs.cpSync(path.join(repo, 'packages/react-native', entry), path.join(pkg, entry), {
    recursive: true,
  });
}
const results = [];
console.log(`Evidence: ${root}`);
for (const placement of ['topLevel', 'nested']) {
  for (const linkage of ['dynamic', 'static', 'none']) {
    const framework = linkage === 'none' ? '' : `  use_frameworks! :linkage => :${linkage}\n`;
    const baseline = `# frozen_string_literal: true\nplatform :ios, '15.1'\ninstall! 'cocoapods', :deterministic_uuids => true\nproject 'Probe.xcodeproj'\ntarget 'Host' do\n${framework}  probe_autolinking\n  pod 'RNNotifee', :path => '../package'\n${placement === 'nested' ? "  target 'NotifyKitNSE' do\n    inherit! :search_paths\n    pod 'RNNotifeeCore', :path => '../package'\n  end\n" : ''}end\n${placement === 'topLevel' ? `target 'NotifyKitNSE' do\n${framework}  pod 'RNNotifeeCore', :path => '../package'\nend\n` : ''}`;
    const patcher = placement === 'topLevel' ? expo : cli;
    const options = {
      targetName: 'NotifyKitNSE',
      packagePathFromIos: '../package',
      placement,
      useFrameworks: linkage === 'none' ? false : linkage,
    };
    const patched = patcher.patchPodfileForNotifyKitNse(baseline, options);
    const repeated = patcher.patchPodfileForNotifyKitNse(patched.contents, options);
    if (repeated.didChange || repeated.contents !== patched.contents)
      throw new Error('non-idempotent Podfile');
    for (const [phase, text] of [
      ['before', baseline],
      ['after', patched.contents],
      ['repeat', repeated.contents],
    ]) {
      const name = `${placement}-${linkage}-${phase}`;
      const directory = path.join(root, name);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'Podfile'), text);
      const log = execFileSync(
        process.env.NOTIFEE_TEST_RUBY || 'ruby',
        [path.join(repo, 'ios/NotifeeCoreTests/NsePodOwnershipProbe.rb'), directory, phase],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      );
      fs.writeFileSync(path.join(directory, 'install.log'), log);
      const result = JSON.parse(fs.readFileSync(path.join(directory, 'ownership.json')));
      results.push({ name, ...result });
      console.log(
        `PASS ${name}: host core owners=${result.coreOwners.length}, helper owners=${result.helperOwners.length}`,
      );
    }
  }
}
fs.writeFileSync(path.join(root, 'matrix.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`PASS ${results.length} CocoaPods installations; graph evidence at ${root}`);
