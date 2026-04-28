import * as fs from 'fs';

const RNFB_INFO_PLIST_INPUT_PATH = '$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)';
const RNFB_POST_INSTALL_MARKER =
  'NotifyKitNSE: avoid an Xcode build cycle between the embedded app extension';

/**
 * Patches the Podfile to add the NSE target with RNNotifeeCore pod.
 * The NSE target is nested inside the main app target so CocoaPods can
 * detect the host→extension relationship. Uses `inherit! :search_paths`.
 * Also installs a post_install hook that keeps React Native Firebase's
 * generated Info.plist input path from recreating a host-extension build cycle.
 * Idempotent: returns false when no Podfile changes are needed.
 */
export function patchPodfile(podfilePath: string, targetName: string, dryRun: boolean): boolean {
  const content = fs.readFileSync(podfilePath, 'utf-8');

  const patched = getPatchedPodfile(content, targetName);
  if (patched === null) {
    return false; // Already patched
  }

  if (!dryRun) {
    fs.writeFileSync(podfilePath, patched, 'utf-8');
  }

  return true;
}

/**
 * Returns the patched Podfile content without writing to disk (for dry-run
 * preview or testing).
 */
export function getPatchedPodfile(content: string, targetName: string): string | null {
  let patched = content;
  let changed = false;

  // Idempotency check — skip commented lines (# prefix)
  if (!hasUncommentedTarget(patched, targetName)) {
    const withNseTarget = insertNseTarget(patched, targetName);
    if (withNseTarget === null) {
      return null;
    }
    patched = withNseTarget;
    changed = true;
  }

  const withRnfbPatch = ensureRnfbPostInstallPatch(patched);
  if (withRnfbPatch !== patched) {
    patched = withRnfbPatch;
    changed = true;
  }

  return changed ? patched : null;
}

/**
 * Inserts the NSE target block inside the main app target, just before
 * the target's closing `end`.
 *
 * CocoaPods host-target rule: an app-extension target (Notification Service
 * Extension here) must be declared nested inside its host app's target
 * block with `inherit! :search_paths`. A top-level `target 'NotifyKitNSE'`
 * block fails `pod install` with "Unable to find host target". We parse
 * block depth to locate the main app's target body and insert the NSE
 * sub-target there.
 * Discovered: F3 Round 3, Check 3 smoke-app integration (2026-04).
 */
function insertNseTarget(content: string, targetName: string): string | null {
  // Build the NSE block (indented since it's inside the parent target)
  let block = `\n  target '${targetName}' do\n`;
  block += `    inherit! :search_paths\n`;
  block += `    pod 'RNNotifeeCore', :path => '../node_modules/react-native-notify-kit'\n`;
  block += `  end\n`;

  // Find the main app target's closing `end`.
  // Strategy: find the first `target '...' do` and then its matching `end`.
  // We insert just before that `end`.
  const targetMatch = content.match(/^target\s+['"][^'"]+['"]\s+do/m);
  if (!targetMatch || targetMatch.index === undefined) {
    // No target found — append at top level (unusual Podfile)
    return content + '\n' + block;
  }

  const insertIndex = findMatchingRubyBlockEnd(content, targetMatch.index);

  if (insertIndex === -1) {
    // Could not find matching end — abort rather than silently producing invalid output
    throw new Error(
      "Could not locate main app target's closing 'end' in Podfile. NSE insertion aborted. " +
        'Your Podfile may use abstract_target, unusual formatting, or nested blocks — ' +
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

    charIndex += line.length + 1; // +1 for newline
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
    const stripped = line.replace(/#.*$/, ''); // Remove comments
    if (pattern.test(stripped)) {
      return true;
    }
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
