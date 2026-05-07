const DEFAULT_PACKAGE_PATH_FROM_IOS = '../node_modules/react-native-notify-kit';
const RNFB_INFO_PLIST_INPUT_PATH = '$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)';
const RNFB_POST_INSTALL_MARKER =
  'NotifyKitNSE: avoid an Xcode build cycle between the embedded app extension';

export interface NotifyKitNsePodfilePatchOptions {
  targetName: string;
  packagePathFromIos?: string;
}

export interface NotifyKitNsePodfilePatchResult {
  contents: string;
  didChange: boolean;
}

export function patchPodfileForNotifyKitNse(
  podfileText: string,
  options: NotifyKitNsePodfilePatchOptions,
): NotifyKitNsePodfilePatchResult {
  let patched = podfileText;
  let changed = false;
  const packagePathFromIos = options.packagePathFromIos ?? DEFAULT_PACKAGE_PATH_FROM_IOS;

  if (!hasUncommentedTarget(patched, options.targetName)) {
    const withNseTarget = insertNseTarget(patched, options.targetName, packagePathFromIos);
    if (withNseTarget === null) {
      return { contents: patched, didChange: changed };
    }
    patched = withNseTarget;
    changed = true;
  }

  const withRnfbPatch = ensureRnfbPostInstallPatch(patched);
  if (withRnfbPatch !== patched) {
    patched = withRnfbPatch;
    changed = true;
  }

  return { contents: patched, didChange: changed };
}

function insertNseTarget(
  content: string,
  targetName: string,
  packagePathFromIos: string,
): string | null {
  let block = `\n  target '${targetName}' do\n`;
  block += `    inherit! :search_paths\n`;
  block += `    pod 'RNNotifeeCore', :path => '${packagePathFromIos}'\n`;
  block += `  end\n`;

  const targetMatch = content.match(/^target\s+['"][^'"]+['"]\s+do/m);
  if (!targetMatch || targetMatch.index === undefined) {
    return content + '\n' + block;
  }

  const insertIndex = findMatchingRubyBlockEnd(content, targetMatch.index);

  if (insertIndex === -1) {
    throw new Error(
      "Could not locate main app target's closing 'end' in Podfile. NSE insertion aborted. " +
        'Your Podfile may use abstract_target, unusual formatting, or nested blocks - ' +
        'add the NSE target manually per the legacy guide.',
    );
  }

  return content.slice(0, insertIndex) + block + content.slice(insertIndex);
}

function ensureRnfbPostInstallPatch(content: string): string {
  if (content.includes(RNFB_POST_INSTALL_MARKER)) {
    return content;
  }

  const postInstall = findPostInstallBlock(content);
  if (postInstall) {
    const snippet =
      '\n' + buildRnfbPostInstallSnippet(postInstall.bodyIndent, postInstall.paramName);
    return content.slice(0, postInstall.endIndex) + snippet + content.slice(postInstall.endIndex);
  }

  const separator = content.trim().length === 0 || content.endsWith('\n') ? '\n' : '\n\n';
  return (
    content +
    separator +
    'post_install do |installer|\n' +
    buildRnfbPostInstallSnippet('  ', 'installer') +
    'end\n'
  );
}

function buildRnfbPostInstallSnippet(indent: string, installerParamName: string): string {
  return [
    `${indent}# ${RNFB_POST_INSTALL_MARKER}`,
    `${indent}# and React Native Firebase's Info.plist processing phase.`,
    `${indent}rnfb_info_plist_input_path = '${RNFB_INFO_PLIST_INPUT_PATH}'`,
    `${indent}rnfb_phase_names = [`,
    `${indent}  '[RNFB] Core Configuration',`,
    `${indent}  '[CP-User] [RNFB] Core Configuration',`,
    `${indent}]`,
    '',
    `${indent}${installerParamName}.aggregate_targets.each do |aggregate_target|`,
    `${indent}  aggregate_target.target_definition.script_phases.each do |script_phase|`,
    `${indent}    next unless rnfb_phase_names.include?(script_phase[:name])`,
    `${indent}    next unless script_phase[:input_files]`,
    '',
    `${indent}    script_phase[:input_files].delete(rnfb_info_plist_input_path)`,
    `${indent}  end`,
    '',
    `${indent}  user_project = aggregate_target.user_project`,
    `${indent}  next unless user_project`,
    '',
    `${indent}  rnfb_input_path_removed = false`,
    '',
    `${indent}  user_project.targets.each do |target|`,
    `${indent}    target.shell_script_build_phases.each do |phase|`,
    `${indent}      next unless rnfb_phase_names.include?(phase.name)`,
    `${indent}      next unless phase.input_paths`,
    '',
    `${indent}      if phase.input_paths.delete(rnfb_info_plist_input_path)`,
    `${indent}        rnfb_input_path_removed = true`,
    `${indent}      end`,
    `${indent}    end`,
    `${indent}  end`,
    '',
    `${indent}  user_project.save if rnfb_input_path_removed`,
    `${indent}end`,
    '',
  ].join('\n');
}

function findPostInstallBlock(
  content: string,
): { bodyIndent: string; endIndex: number; paramName: string } | null {
  const postInstallPattern = /^([ \t]*)post_install\s+do\s+\|([^|]+)\|\s*(?:#.*)?$/gm;
  let match: RegExpExecArray | null;

  while ((match = postInstallPattern.exec(content)) !== null) {
    const endIndex = findMatchingRubyBlockEnd(content, match.index);
    if (endIndex !== -1) {
      return {
        bodyIndent: `${match[1]}  `,
        endIndex,
        paramName: match[2].trim(),
      };
    }
  }

  return null;
}

function findMatchingRubyBlockEnd(content: string, startIndex: number): number {
  const afterStart = content.slice(startIndex);
  const lines = afterStart.split('\n');
  let depth = 0;
  let charIndex = startIndex;

  for (const line of lines) {
    const trimmed = stripRubyLineComment(line).trim();

    depth += countRubyBlockOpeners(trimmed);

    if (trimmed === 'end') {
      depth--;
      if (depth === 0) {
        return charIndex;
      }
    }

    charIndex += line.length + 1;
  }

  return -1;
}

function countRubyBlockOpeners(line: string): number {
  if (line.length === 0) {
    return 0;
  }

  const startsWithKeywordBlock = /^(if|unless|case|begin|while|until|for|def|class|module)\b/.test(
    line,
  );
  if (startsWithKeywordBlock) {
    return 1;
  }

  if (/\bdo\b(\s*\|[^|]*\|)?\s*$/.test(line)) {
    return 1;
  }

  return 0;
}

function stripRubyLineComment(line: string): string {
  return line.replace(/#.*$/, '');
}

function hasUncommentedTarget(content: string, targetName: string): boolean {
  const pattern = new RegExp(`target\\s+['"]${escapeRegex(targetName)}['"]`);
  for (const line of content.split('\n')) {
    const stripped = line.replace(/#.*$/, '');
    if (pattern.test(stripped)) {
      return true;
    }
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
