import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  renderNotificationServiceSwift,
  renderNseEntitlementsPlist,
  renderNseInfoPlist,
} from '../shared/nse/initNseCore';

const enabledOptions = {
  enabled: true,
  targetName: 'NotifyKitNSE',
  bundleSuffix: '.NotifyKitNSE',
};

const TARGET = 'NotifyKitNSE';
const OLD_VERSIONS = { marketingVersion: '1.0.0', currentProjectVersion: '1' };
const NEW_VERSIONS = { marketingVersion: '2.0.0', currentProjectVersion: '2' };
const ROOT_DICT_END = '</dict>\n</plist>\n';

// Mirrors React Native's NewArchitectureHelper.set_RCTNewArchEnabled_in_info_plist
// serialization: a tab-indented top-level entry appended before the root </dict>.
function rnEntry(value: 'true' | 'false' = 'true'): string {
  return `\t<key>RCTNewArchEnabled</key>\n\t<${value}/>\n`;
}

function insertBeforeRootDictEnd(plist: string, insertion: string): string {
  if (!plist.endsWith(ROOT_DICT_END)) {
    throw new Error('fixture does not end with the root dict terminator');
  }
  return plist.slice(0, -ROOT_DICT_END.length) + insertion + ROOT_DICT_END;
}

function generatedPlist(versions = OLD_VERSIONS, targetName = TARGET): string {
  return renderNseInfoPlist({ targetName, ...versions });
}

function withRnEntry(plist: string, value: 'true' | 'false' = 'true'): string {
  return insertBeforeRootDictEnd(plist, rnEntry(value));
}

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0 || source.indexOf(search, index + search.length) >= 0) {
    throw new Error(`fixture search text must occur exactly once: ${JSON.stringify(search)}`);
  }
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

type NseFilesModule = {
  writeNotifyKitIosNseFiles: (
    platformProjectRoot: string,
    targetName: string,
    versionOptions?: { marketingVersion: string; currentProjectVersion: string },
  ) => void;
};

const IMPLEMENTATIONS: Array<[string, () => NseFilesModule]> = [
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ['source', () => require('../ios/withNotifyKitIosNseFiles') as NseFilesModule],
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ['build', () => require('../../build/ios/withNotifyKitIosNseFiles') as NseFilesModule],
];

const pure = generatedPlist();
const pureWithTrue = withRnEntry(pure, 'true');

// Every input below must be rejected byte-for-byte unchanged.
const REJECTED_INFO_PLISTS: Array<[string, string]> = [
  [
    'unknown key before the RN entry',
    insertBeforeRootDictEnd(pure, '\t<key>Foo</key>\n\t<string>x</string>\n' + rnEntry()),
  ],
  [
    'unknown key after the RN entry',
    insertBeforeRootDictEnd(pure, rnEntry() + '\t<key>Foo</key>\n\t<string>x</string>\n'),
  ],
  [
    'unknown key without the RN entry',
    insertBeforeRootDictEnd(pure, '\t<key>Foo</key>\n\t<true/>\n'),
  ],
  ['duplicated RN entry', insertBeforeRootDictEnd(pure, rnEntry() + rnEntry())],
  [
    'duplicated RN entry with conflicting values',
    insertBeforeRootDictEnd(pure, rnEntry('true') + rnEntry('false')),
  ],
  [
    'RN entry before NSExtension',
    replaceOnce(pure, '\t<key>NSExtension</key>\n', rnEntry() + '\t<key>NSExtension</key>\n'),
  ],
  [
    'RN entry at the top of the root dict',
    replaceOnce(
      pure,
      '<dict>\n\t<key>CFBundleDisplayName',
      `<dict>\n${rnEntry()}\t<key>CFBundleDisplayName`,
    ),
  ],
  [
    'RN entry nested in NSExtension with canonical indentation',
    replaceOnce(pure, '\t</dict>\n</dict>\n', rnEntry() + '\t</dict>\n</dict>\n'),
  ],
  [
    'RN entry nested in NSExtension with nested indentation',
    replaceOnce(
      pure,
      '\t</dict>\n</dict>\n',
      '\t\t<key>RCTNewArchEnabled</key>\n\t\t<true/>\n\t</dict>\n</dict>\n',
    ),
  ],
  [
    'RN entry after the root dict',
    pure.replace('</dict>\n</plist>\n', '</dict>\n' + rnEntry() + '</plist>\n'),
  ],
  [
    'string value',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key>\n\t<string>true</string>\n'),
  ],
  [
    'integer value',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key>\n\t<integer>1</integer>\n'),
  ],
  [
    'expanded boolean element',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key>\n\t<true></true>\n'),
  ],
  [
    'non-plist boolean element',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key>\n\t<YES/>\n'),
  ],
  ['missing value', insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key>\n')],
  ['value without key', insertBeforeRootDictEnd(pure, '\t<true/>\n')],
  ['lowercase key', insertBeforeRootDictEnd(pure, '\t<key>rctNewArchEnabled</key>\n\t<true/>\n')],
  ['uppercase key', insertBeforeRootDictEnd(pure, '\t<key>RCTNEWARCHENABLED</key>\n\t<true/>\n')],
  [
    'key with trailing space',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled </key>\n\t<true/>\n'),
  ],
  [
    'space indentation',
    insertBeforeRootDictEnd(pure, '  <key>RCTNewArchEnabled</key>\n  <true/>\n'),
  ],
  [
    'self-closing tag with a space',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key>\n\t<true />\n'),
  ],
  ['entry on one line', insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key><true/>\n')],
  [
    'entry without final newline',
    pure.replace(ROOT_DICT_END, '\t<key>RCTNewArchEnabled</key>\n\t<true/></dict>\n</plist>\n'),
  ],
  ['blank line before the entry', insertBeforeRootDictEnd(pure, '\n' + rnEntry())],
  ['blank line after the entry', insertBeforeRootDictEnd(pure, rnEntry() + '\n')],
  [
    'trailing whitespace in the entry',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key> \n\t<true/>\n'),
  ],
  ['comment before the entry', insertBeforeRootDictEnd(pure, '\t<!-- consumer -->\n' + rnEntry())],
  [
    'comment inside the entry',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key>\n\t<!-- x -->\n\t<true/>\n'),
  ],
  ['comment instead of the entry', insertBeforeRootDictEnd(pure, '\t<!-- RCTNewArchEnabled -->\n')],
  ['CDATA after the entry', insertBeforeRootDictEnd(pure, rnEntry() + '<![CDATA[x]]>\n')],
  ['content after </plist>', pureWithTrue + '\n'],
  ['comment after </plist>', pureWithTrue + '<!-- trailing -->\n'],
  ['missing final newline', pureWithTrue.slice(0, -1)],
  ['UTF-8 BOM', '\uFEFF' + pureWithTrue],
  ['UTF-8 BOM without the RN entry', '\uFEFF' + pure],
  ['CRLF line endings', pureWithTrue.replace(/\n/g, '\r\n')],
  ['CRLF line endings without the RN entry', pure.replace(/\n/g, '\r\n')],
  [
    'CRLF only in the RN entry',
    insertBeforeRootDictEnd(pure, '\t<key>RCTNewArchEnabled</key>\r\n\t<true/>\r\n'),
  ],
  [
    'modified NSExtensionPrincipalClass',
    replaceOnce(
      pureWithTrue,
      '$(PRODUCT_MODULE_NAME).NotificationService',
      'Consumer.NotificationService',
    ),
  ],
  [
    'modified NSExtensionPointIdentifier',
    replaceOnce(
      pureWithTrue,
      'com.apple.usernotifications.service',
      'com.apple.widgetkit-extension',
    ),
  ],
  [
    'modified CFBundleIdentifier',
    replaceOnce(pureWithTrue, '$(PRODUCT_BUNDLE_IDENTIFIER)', 'com.consumer.nse'),
  ],
  [
    'missing CFBundleExecutable',
    replaceOnce(
      pureWithTrue,
      '\t<key>CFBundleExecutable</key>\n\t<string>$(EXECUTABLE_NAME)</string>\n',
      '',
    ),
  ],
  [
    'missing CFBundleExecutable without the RN entry',
    replaceOnce(
      pure,
      '\t<key>CFBundleExecutable</key>\n\t<string>$(EXECUTABLE_NAME)</string>\n',
      '',
    ),
  ],
  ['incorrect target name', withRnEntry(generatedPlist(OLD_VERSIONS, 'OtherNSE'))],
  [
    'marketing version XML injection',
    withRnEntry(
      generatedPlist({
        marketingVersion: '1.0.0</string>\n\t<key>Evil</key>\n\t<string>x',
        currentProjectVersion: '1',
      }),
    ),
  ],
  [
    'build number XML injection',
    withRnEntry(
      generatedPlist({
        marketingVersion: '1.0.0',
        currentProjectVersion: '1</string>\n\t<key>Evil</key>\n\t<string>x',
      }),
    ),
  ],
  ['truncated plist', pureWithTrue.slice(0, pureWithTrue.length - 20)],
  [
    'truncated before the RN value',
    pure.replace(ROOT_DICT_END, '\t<key>RCTNewArchEnabled</key>\n'),
  ],
  ['empty file', ''],
  ['RN entry only', rnEntry()],
  ['binary plist', 'bplist00Ñ\u0001\u0002_\u0010\u0011RCTNewArchEnabled\t\b\u000b'],
];

describe.each(IMPLEMENTATIONS)(
  'NotifyKit NSE Info.plist React Native tooling entry (%s implementation)',
  (_implementationName, loadImplementation) => {
    let tempIosRoots: string[] = [];

    beforeEach(() => {
      jest.resetModules();
      tempIosRoots = [];
    });

    afterEach(() => {
      for (const tempIosRoot of tempIosRoots) {
        fs.rmSync(tempIosRoot, { force: true, recursive: true });
      }
    });

    function seedInfoPlist(contents: string): { root: string; infoPlistPath: string } {
      const root = makeTempIosRoot();
      tempIosRoots.push(root);
      writeOtherGeneratedFiles(root);
      const infoPlistPath = path.join(root, TARGET, 'Info.plist');
      fs.writeFileSync(infoPlistPath, contents, 'utf8');
      return { root, infoPlistPath };
    }

    function writeOtherGeneratedFiles(root: string): void {
      fs.mkdirSync(path.join(root, TARGET), { recursive: true });
      fs.writeFileSync(
        path.join(root, TARGET, 'NotificationService.swift'),
        renderNotificationServiceSwift(),
        'utf8',
      );
      fs.writeFileSync(
        path.join(root, TARGET, `${TARGET}.entitlements`),
        renderNseEntitlementsPlist(),
        'utf8',
      );
    }

    // A read-only file makes any write attempt fail loudly, proving a no-op.
    function runWithoutWriting(root: string, infoPlistPath: string, versions = OLD_VERSIONS): void {
      fs.chmodSync(infoPlistPath, 0o444);
      try {
        loadImplementation().writeNotifyKitIosNseFiles(root, TARGET, versions);
      } finally {
        fs.chmodSync(infoPlistPath, 0o644);
      }
    }

    it.each(['true', 'false'] as const)(
      'keeps a plist with the canonical RN %s entry byte-identical when versions match',
      value => {
        const contents = withRnEntry(generatedPlist(OLD_VERSIONS), value);
        const { root, infoPlistPath } = seedInfoPlist(contents);

        expect(() => runWithoutWriting(root, infoPlistPath)).not.toThrow();
        expect(fs.readFileSync(infoPlistPath, 'utf8')).toBe(contents);
      },
    );

    it('keeps the pure generated plist byte-identical when versions match', () => {
      const contents = generatedPlist(OLD_VERSIONS);
      const { root, infoPlistPath } = seedInfoPlist(contents);

      expect(() => runWithoutWriting(root, infoPlistPath)).not.toThrow();
      expect(fs.readFileSync(infoPlistPath, 'utf8')).toBe(contents);
    });

    it.each(['true', 'false'] as const)(
      'updates only the version fields and preserves the canonical RN %s entry byte-for-byte',
      value => {
        const { root, infoPlistPath } = seedInfoPlist(
          withRnEntry(generatedPlist(OLD_VERSIONS), value),
        );

        loadImplementation().writeNotifyKitIosNseFiles(root, TARGET, NEW_VERSIONS);

        expect(fs.readFileSync(infoPlistPath, 'utf8')).toBe(
          withRnEntry(generatedPlist(NEW_VERSIONS), value),
        );
      },
    );

    it('updates the pure generated plist versions without adding the RN entry', () => {
      const { root, infoPlistPath } = seedInfoPlist(generatedPlist(OLD_VERSIONS));

      loadImplementation().writeNotifyKitIosNseFiles(root, TARGET, NEW_VERSIONS);

      expect(fs.readFileSync(infoPlistPath, 'utf8')).toBe(generatedPlist(NEW_VERSIONS));
    });

    it('preserves version values that previously contained escaped or special characters', () => {
      const oldVersions = { marketingVersion: '1.0.0 &amp; beta', currentProjectVersion: '' };
      const { root, infoPlistPath } = seedInfoPlist(withRnEntry(generatedPlist(oldVersions)));

      loadImplementation().writeNotifyKitIosNseFiles(root, TARGET, NEW_VERSIONS);

      expect(fs.readFileSync(infoPlistPath, 'utf8')).toBe(
        withRnEntry(generatedPlist(NEW_VERSIONS)),
      );
    });

    it('converges after repeated runs and does not rewrite the stable plist', () => {
      const { root, infoPlistPath } = seedInfoPlist(withRnEntry(generatedPlist(OLD_VERSIONS)));

      loadImplementation().writeNotifyKitIosNseFiles(root, TARGET, NEW_VERSIONS);
      const once = fs.readFileSync(infoPlistPath, 'utf8');
      expect(() => runWithoutWriting(root, infoPlistPath, NEW_VERSIONS)).not.toThrow();
      expect(() => runWithoutWriting(root, infoPlistPath, NEW_VERSIONS)).not.toThrow();

      expect(fs.readFileSync(infoPlistPath, 'utf8')).toBe(once);
      expect(once).toBe(withRnEntry(generatedPlist(NEW_VERSIONS)));
    });

    it('generates a clean plist without the RN entry and converges on the next run', () => {
      const root = makeTempIosRoot();
      tempIosRoots.push(root);
      const infoPlistPath = path.join(root, TARGET, 'Info.plist');

      loadImplementation().writeNotifyKitIosNseFiles(root, TARGET, OLD_VERSIONS);

      expect(fs.readFileSync(infoPlistPath, 'utf8')).toBe(generatedPlist(OLD_VERSIONS));
      expect(() => runWithoutWriting(root, infoPlistPath)).not.toThrow();
    });

    describe.each(REJECTED_INFO_PLISTS)('rejects %s', (_caseName, contents) => {
      it.each([
        ['matching versions', OLD_VERSIONS],
        ['changed versions', NEW_VERSIONS],
      ])('with %s, without altering bytes', (_versionsName, versions) => {
        const { root, infoPlistPath } = seedInfoPlist(contents);
        const before = fs.readFileSync(infoPlistPath);

        expect(() =>
          loadImplementation().writeNotifyKitIosNseFiles(root, TARGET, versions),
        ).toThrow(
          `[react-native-notify-kit] Refusing to overwrite existing ${infoPlistPath}. ` +
            'Delete it or make it match the generated NotifyKit NSE template.',
        );
        expect(fs.readFileSync(infoPlistPath).equals(before)).toBe(true);
      });
    });
  },
);

describe('NotifyKit NSE Info.plist source/build parity', () => {
  const PARITY_INPUTS: Array<[string, string]> = [
    ['pure generated', pure],
    ['canonical RN true', pureWithTrue],
    ['canonical RN false', withRnEntry(pure, 'false')],
    ['new versions with RN true', withRnEntry(generatedPlist(NEW_VERSIONS))],
    ...REJECTED_INFO_PLISTS,
  ];

  function outcome(
    load: () => NseFilesModule,
    contents: string,
    versions: typeof OLD_VERSIONS,
  ): { error: string | null; bytes: string } {
    const root = makeTempIosRoot();
    try {
      const infoPlistPath = path.join(root, TARGET, 'Info.plist');
      fs.mkdirSync(path.dirname(infoPlistPath), { recursive: true });
      fs.writeFileSync(infoPlistPath, contents, 'utf8');
      let error: string | null = null;
      try {
        load().writeNotifyKitIosNseFiles(root, TARGET, versions);
      } catch (caught) {
        error = (caught as Error).message.replace(root, '<root>');
      }
      return { error, bytes: fs.readFileSync(infoPlistPath, 'utf8') };
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  }

  it.each(PARITY_INPUTS)('source and build produce identical results for %s', (_name, contents) => {
    const [[, loadSource], [, loadBuild]] = IMPLEMENTATIONS;
    for (const versions of [OLD_VERSIONS, NEW_VERSIONS]) {
      expect(outcome(loadBuild, contents, versions)).toEqual(
        outcome(loadSource, contents, versions),
      );
    }
  });
});

function makeTempIosRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'notifykit-nse-files-'));
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

describe('NotifyKit Expo NSE file generation mod', () => {
  let tempIosRoots: string[] = [];

  beforeEach(() => {
    jest.resetModules();
    tempIosRoots = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const tempIosRoot of tempIosRoots) {
      fs.rmSync(tempIosRoot, { force: true, recursive: true });
    }
  });

  it('leaves config unchanged and does not register withDangerousMod when NSE is disabled', async () => {
    const withDangerousMod = jest.fn();
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });

    const { withNotifyKitIosNseFiles } = await import('../ios/withNotifyKitIosNseFiles');
    const config = {};

    expect(
      withNotifyKitIosNseFiles(config, {
        ...enabledOptions,
        enabled: false,
      }),
    ).toBe(config);
    expect(withDangerousMod).not.toHaveBeenCalled();
  });

  it('generates the three NSE files from the shared renderers when enabled', async () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const withDangerousMod = jest.fn((config, [platform, action]) => {
      expect(platform).toBe('ios');
      return action({
        ...config,
        modRequest: {
          platformProjectRoot: tempIosRoot,
        },
      });
    });
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });

    const { withNotifyKitIosNseFiles } = await import('../ios/withNotifyKitIosNseFiles');
    const config = withNotifyKitIosNseFiles({}, enabledOptions);

    expect(withDangerousMod).toHaveBeenCalledTimes(1);
    expect(config.modRequest.platformProjectRoot).toBe(tempIosRoot);
    expect(readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'NotificationService.swift'))).toBe(
      renderNotificationServiceSwift(),
    );
    expect(readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'Info.plist'))).toBe(
      renderNseInfoPlist({ targetName: 'NotifyKitNSE' }),
    );
    expect(readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'NotifyKitNSE.entitlements'))).toBe(
      renderNseEntitlementsPlist(),
    );
  });

  it('passes Expo iOS version metadata to the generated NSE Info.plist', async () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const withDangerousMod = jest.fn((config, [, action]) =>
      action({
        ...config,
        modRequest: {
          platformProjectRoot: tempIosRoot,
        },
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });

    const { withNotifyKitIosNseFiles } = await import('../ios/withNotifyKitIosNseFiles');
    withNotifyKitIosNseFiles(
      {
        version: '8.0.0',
        ios: {
          buildNumber: '800',
        },
      },
      enabledOptions,
    );
    const plist = readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'Info.plist'));

    expect(plist).toContain('<key>CFBundleShortVersionString</key>\n\t<string>8.0.0</string>');
    expect(plist).toContain('<key>CFBundleVersion</key>\n\t<string>800</string>');
  });

  it('uses the configured targetName in paths and plist content', async () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const withDangerousMod = jest.fn((config, [, action]) =>
      action({
        ...config,
        modRequest: {
          platformProjectRoot: tempIosRoot,
        },
      }),
    );
    jest.doMock('expo/config-plugins', () => ({ withDangerousMod }), { virtual: true });

    const { withNotifyKitIosNseFiles } = await import('../ios/withNotifyKitIosNseFiles');
    withNotifyKitIosNseFiles(
      {},
      {
        ...enabledOptions,
        targetName: 'CustomNotifyKitNSE',
      },
    );

    expect(fs.existsSync(path.join(tempIosRoot, 'CustomNotifyKitNSE'))).toBe(true);
    expect(
      readFile(path.join(tempIosRoot, 'CustomNotifyKitNSE', 'CustomNotifyKitNSE.entitlements')),
    ).toBe(renderNseEntitlementsPlist());
    expect(readFile(path.join(tempIosRoot, 'CustomNotifyKitNSE', 'Info.plist'))).toContain(
      '<string>CustomNotifyKitNSE</string>',
    );
    expect(fs.existsSync(path.join(tempIosRoot, 'NotifyKitNSE'))).toBe(false);
  });

  it('treats existing identical files as a no-op', async () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const { writeNotifyKitIosNseFiles } = await import('../ios/withNotifyKitIosNseFiles');

    writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE');
    const notificationServicePath = path.join(
      tempIosRoot,
      'NotifyKitNSE',
      'NotificationService.swift',
    );
    const initialContents = readFile(notificationServicePath);

    expect(() => writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE')).not.toThrow();
    expect(readFile(notificationServicePath)).toBe(initialContents);
  });

  it('updates an existing generated Info.plist when version metadata changes', async () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const { writeNotifyKitIosNseFiles } = await import('../ios/withNotifyKitIosNseFiles');

    writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE', {
      marketingVersion: '1.0.0',
      currentProjectVersion: '100',
    });

    expect(() =>
      writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE', {
        marketingVersion: '8.0.0',
        currentProjectVersion: '800',
      }),
    ).not.toThrow();

    const plist = readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'Info.plist'));
    expect(plist).toContain('<key>CFBundleShortVersionString</key>\n\t<string>8.0.0</string>');
    expect(plist).toContain('<key>CFBundleVersion</key>\n\t<string>800</string>');
  });

  it('throws instead of overwriting an existing different file', async () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const targetDir = path.join(tempIosRoot, 'NotifyKitNSE');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'NotificationService.swift'), '// custom file\n', 'utf8');

    const { writeNotifyKitIosNseFiles } = await import('../ios/withNotifyKitIosNseFiles');

    expect(() => writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE')).toThrow(
      /Refusing to overwrite existing .*NotificationService\.swift/,
    );
  });

  it('generates a clean Info.plist without the React Native tooling entry', async () => {
    const tempIosRoot = makeTempIosRoot();
    tempIosRoots.push(tempIosRoot);
    const { writeNotifyKitIosNseFiles } = await import('../ios/withNotifyKitIosNseFiles');

    writeNotifyKitIosNseFiles(tempIosRoot, 'NotifyKitNSE', OLD_VERSIONS);

    const plist = readFile(path.join(tempIosRoot, 'NotifyKitNSE', 'Info.plist'));
    expect(plist).toBe(renderNseInfoPlist({ targetName: TARGET, ...OLD_VERSIONS }));
    expect(plist).not.toContain('RCTNewArchEnabled');
  });

  it('does not import from the CLI implementation', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../ios/withNotifyKitIosNseFiles.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/packages\/cli|\.\.\/\.\.\/\.\.\/cli|react-native-notify-kit\/cli/);
  });
});
