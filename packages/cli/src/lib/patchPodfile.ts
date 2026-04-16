import * as fs from 'fs';

/**
 * Patches the Podfile to add the NSE target with RNNotifeeCore pod.
 * The NSE target is nested inside the main app target so CocoaPods can
 * detect the host→extension relationship. Uses `inherit! :search_paths`.
 * Idempotent: if the target already exists, returns false.
 */
export function patchPodfile(podfilePath: string, targetName: string, dryRun: boolean): boolean {
  const content = fs.readFileSync(podfilePath, 'utf-8');

  // Idempotency check — skip commented lines (# prefix)
  if (hasUncommentedTarget(content, targetName)) {
    return false; // Already present
  }

  const patched = insertNseTarget(content, targetName);
  if (patched === null) {
    return false; // Could not find insertion point
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
  if (hasUncommentedTarget(content, targetName)) {
    return null; // Already present
  }
  return insertNseTarget(content, targetName);
}

/**
 * Inserts the NSE target block inside the main app target, just before
 * the target's closing `end`. CocoaPods requires extension targets to be
 * nested inside their host target for proper dependency resolution.
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

  // Find the matching `end` for this target block.
  // Simple approach: find the last top-level `end` after the target declaration.
  // We look for `end` at the start of a line (possibly with leading whitespace)
  // that closes the main target block.
  const afterTarget = content.slice(targetMatch.index);
  let depth = 0;
  let insertIndex = -1;
  const lines = afterTarget.split('\n');
  let charIndex = targetMatch.index;

  for (const line of lines) {
    const trimmed = line.trim();
    // Count block openers: `do` at end of line (target ... do, post_install do |...|)
    if (/\bdo\b(\s*\|[^|]*\|)?\s*$/.test(trimmed) && !trimmed.startsWith('#')) {
      depth++;
    }
    // Count block closers
    if (trimmed === 'end') {
      depth--;
      if (depth === 0) {
        // This is the closing `end` of the main target — insert before it
        insertIndex = charIndex;
        break;
      }
    }
    charIndex += line.length + 1; // +1 for newline
  }

  if (insertIndex === -1) {
    // Could not find matching end — append at file end
    return content + '\n' + block;
  }

  return content.slice(0, insertIndex) + block + content.slice(insertIndex);
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
