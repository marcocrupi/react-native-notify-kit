import * as fs from 'fs';

/**
 * Patches the Podfile to add the NSE target with RNNotifeeCore pod.
 * Idempotent: if the target already exists, returns false.
 */
export function patchPodfile(podfilePath: string, targetName: string, dryRun: boolean): boolean {
  const content = fs.readFileSync(podfilePath, 'utf-8');

  // Idempotency check
  const targetRegex = new RegExp(`target\\s+['"]${escapeRegex(targetName)}['"]`);
  if (targetRegex.test(content)) {
    return false; // Already present
  }

  const block = buildNseTargetBlock(targetName, content);
  const patched = insertBeforePostInstall(content, block);

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
  const targetRegex = new RegExp(`target\\s+['"]${escapeRegex(targetName)}['"]`);
  if (targetRegex.test(content)) {
    return null; // Already present
  }
  const block = buildNseTargetBlock(targetName, content);
  return insertBeforePostInstall(content, block);
}

function buildNseTargetBlock(targetName: string, podfileContent: string): string {
  const hasUseFrameworks = /^\s*use_frameworks!/m.test(podfileContent);

  let block = `\ntarget '${targetName}' do\n`;
  if (hasUseFrameworks) {
    block += `  use_frameworks! :linkage => :static if $RNFirebaseAsStaticFramework\n`;
  }
  block += `  pod 'RNNotifeeCore', :path => '../node_modules/react-native-notify-kit'\n`;
  block += `end\n`;

  return block;
}

function insertBeforePostInstall(content: string, block: string): string {
  // Find the top-level post_install block (not nested inside a target)
  // Strategy: look for `post_install do |installer|` that's NOT indented (top-level)
  const postInstallMatch = content.match(/^post_install\s+do\s+\|/m);

  if (postInstallMatch && postInstallMatch.index !== undefined) {
    return (
      content.slice(0, postInstallMatch.index) +
      block +
      '\n' +
      content.slice(postInstallMatch.index)
    );
  }

  // No post_install found — append at end
  return content + '\n' + block;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
