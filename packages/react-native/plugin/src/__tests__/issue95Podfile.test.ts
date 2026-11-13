/** @jest-environment node */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  patchPodfile,
  patchPodfileForNotifyKitNse as cli,
} from '../../../../cli/src/lib/patchPodfile';
import { patchPodfileForNotifyKitNse as expo } from '../shared/nse/patchPodfile';

const header = '#!/usr/bin/env ruby\n# encoding: UTF-8\n# frozen_string_literal: true\n\n';
const host = "target 'Host' do\n  use_react_native!\nend\n";
const ruby = `
def target(*); yield; end
def use_frameworks!(*); end
def inherit!(*); end
def pod(*); end
def post_install(*); end
def use_react_native!(*); raise 'flag missing at autolinking' unless $NotifeeExtension == true; end
`;

for (const [name, patch] of [
  ['Expo', expo],
  ['CLI', cli],
] as const) {
  describe(`issue95 ${name}`, () => {
    for (const useFrameworks of [false, 'static', 'dynamic'] as const) {
      for (const existing of [false, true]) {
        it(`${useFrameworks}, existing=${existing}: effective before autolinking and idempotent`, () => {
          const base =
            header +
            host.replace(
              '  use_react_native!',
              useFrameworks
                ? `  use_frameworks! :linkage => :${useFrameworks}\n  use_react_native!`
                : '  use_react_native!',
            ) +
            (existing
              ? "target 'CustomNSE' do\n  pod 'RNNotifeeCore', :path => '../../kit'\nend\n"
              : '');
          const options = {
            targetName: 'CustomNSE',
            packagePathFromIos: '../../kit',
            placement: 'topLevel' as const,
            useFrameworks,
          };
          const first = patch(base, options);
          expect(first.contents.startsWith(header)).toBe(true);
          execFileSync('ruby', ['-e', ruby + first.contents]);
          expect(patch(first.contents, options)).toEqual({
            contents: first.contents,
            didChange: false,
          });
          expect(first.contents.match(/target 'CustomNSE' do/g)).toHaveLength(1);
        });
      }
    }

    it('preserves an existing effective literal true and unrelated configuration', () => {
      const base =
        header + '$NotifeeExtension = true # consumer choice\n$OtherFlag = false\n' + host;
      const first = patch(base, { targetName: 'NSE' });
      expect(first.contents.startsWith(base.slice(0, base.indexOf("target 'Host'")))).toBe(true);
      expect(first.contents.match(/\$NotifeeExtension = true/g)).toHaveLength(1);
    });

    it('ignores line and Ruby block comments containing assignments', () => {
      const base =
        header + '# $NotifeeExtension = false\n=begin\n$NotifeeExtension = false\n=end\n' + host;
      const result = patch(base, { targetName: 'NSE' });
      execFileSync('ruby', ['-e', ruby + result.contents]);
      expect(result.contents).toContain(base.slice(header.length, base.indexOf("target 'Host'")));
    });

    for (const assignment of [
      '$NotifeeExtension = false',
      "send('use_native_modules!')\n$NotifeeExtension = true",
      "public_send('use_native_modules!')\n$NotifeeExtension = true",
      'method(:use_native_modules!).call\n$NotifeeExtension = true',
      'custom_pod_setup\n$NotifeeExtension = true',
      'probe_autolinking.enabled = true\n$NotifeeExtension = true',
      "probe_autolinking['enabled'] = true\n$NotifeeExtension = true",
      "eval('$NotifeeExtension = false')",
      "instance_eval('$NotifeeExtension = false')",
      'false && \\\n$NotifeeExtension = true',
      'false and\n$NotifeeExtension = true',
      'something; if false\n$NotifeeExtension = true\nend',
      'puts /#/; $NotifeeExtension = false',
      'puts %q(#); $NotifeeExtension = false',
      "puts '#'; $NotifeeExtension = false",
      'config = { value: true }\n$NotifeeExtension = true if config[:value]',
      '$NotifeeExtension = true\n$NotifeeExtension = false',
      '$NotifeeExtension = true if ENV["NSE"]',
      'if ENV["NSE"]\n  $NotifeeExtension = true\nend',
      '$NotifeeExtension ||= true',
      '$NotifeeExtension = ENV["NSE"]',
      'configure { $NotifeeExtension = true }',
      'def configure\n  $NotifeeExtension = true\nend',
      '$NotifeeExtension = true; $NotifeeExtension = false',
      "target 'Host' do\n  $NotifeeExtension = true\nend",
    ]) {
      it(`rejects ambiguous/conflicting Ruby: ${assignment}`, () => {
        expect(() => patch(header + assignment + '\n' + host, { targetName: 'NSE' })).toThrow(
          /\$NotifeeExtension.*line|line.*\$NotifeeExtension/,
        );
      });
    }

    it.each([
      'text = %Q(\n$NotifeeExtension = true\n)',
      'text = "multiline\n$NotifeeExtension = true\n"',
      'text = <<~RUBY\n$NotifeeExtension = true\nRUBY',
    ])('does not mistake literal text for an effective flag: %s', literal => {
      const result = patch(header + literal + '\n' + host, { targetName: 'NSE' });
      execFileSync('ruby', ['-e', ruby + result.contents]);
      expect(result.contents).toContain(literal);
    });

    it('respects true after a simple Ruby prelude', () => {
      const original = "require 'json'\nplatform :ios, '15.1'\n$NotifeeExtension = true\n";
      expect(patch(original + host, { targetName: 'NSE' }).contents.startsWith(original)).toBe(
        true,
      );
    });

    it('rejects a late assignment rather than hiding podspec evaluation order', () => {
      expect(() => patch(host + '$NotifeeExtension = true\n', { targetName: 'NSE' })).toThrow(
        /\$NotifeeExtension/,
      );
    });
  });
}

it('CLI conflict does not partially write the Podfile, including dry run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue95-podfile-'));
  const file = path.join(dir, 'Podfile');
  const original = '$NotifeeExtension = false\n' + host;
  try {
    fs.writeFileSync(file, original);
    for (const dryRun of [true, false]) {
      expect(() => patchPodfile(file, 'NSE', dryRun)).toThrow(/\$NotifeeExtension/);
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
    }
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

it('keeps flag preflight source identical across packaging boundaries', () => {
  const cliSource = fs.readFileSync(
    path.resolve(__dirname, '../../../../cli/src/lib/notifeeExtensionFlag.ts'),
    'utf8',
  );
  const expoSource = fs.readFileSync(
    path.resolve(__dirname, '../shared/nse/notifeeExtensionFlag.ts'),
    'utf8',
  );
  expect(expoSource).toBe(cliSource);
});

it('generated Expo modules execute the same preflight and are reproducible', () => {
  execFileSync(process.execPath, [
    path.resolve(__dirname, '../../../../../scripts/build-nse-podfile.cjs'),
    '--check',
  ]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const built = require('../../build/shared/nse/patchPodfile');
  expect(built.patchPodfileForNotifyKitNse(host, { targetName: 'NSE' })).toEqual(
    expo(host, { targetName: 'NSE' }),
  );
  expect(() =>
    built.patchPodfileForNotifyKitNse('$NotifeeExtension = false\n' + host, { targetName: 'NSE' }),
  ).toThrow(/\$NotifeeExtension/);
});
