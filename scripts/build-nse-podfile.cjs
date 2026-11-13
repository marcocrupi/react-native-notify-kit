#!/usr/bin/env node
'use strict';

// The historical plugin build is checked in without a compiler command. Compile
// the NSE Podfile modules from TypeScript so this fix has no hand-edited JS twin.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const prettier = require('prettier');
const root = path.resolve(__dirname, '../packages/react-native/plugin');

async function main() {
  for (const name of [
    'shared/nse/notifeeExtensionFlag',
    'shared/nse/patchPodfile',
    'ios/withNotifyKitIosNsePodfile',
  ]) {
    const source = path.join(root, 'src', `${name}.ts`);
    const target = path.join(root, 'build', `${name}.js`);
    const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: source,
      reportDiagnostics: true,
    });
    if (compiled.diagnostics?.length)
      throw new Error(
        ts.formatDiagnosticsWithColorAndContext(compiled.diagnostics, {
          getCurrentDirectory: () => root,
          getCanonicalFileName: f => f,
          getNewLine: () => '\n',
        }),
      );
    const formatted = await prettier.format(compiled.outputText, {
      ...(await prettier.resolveConfig(source)),
      parser: 'babel',
    });
    if (process.argv.includes('--check')) {
      if (fs.readFileSync(target, 'utf8') !== formatted)
        throw new Error(`Stale generated module: ${target}`);
    } else {
      fs.writeFileSync(target, formatted);
    }
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
