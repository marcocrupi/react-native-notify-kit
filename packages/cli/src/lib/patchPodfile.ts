import * as fs from 'fs';

/**
 * Patches the Podfile to add the NSE target with RNNotifeeCore pod.
 * Idempotent: if the target already exists, returns false.
 */
export function patchPodfile(podfilePath: string, targetName: string, dryRun: boolean): boolean {
  const content = fs.readFileSync(podfilePath, 'utf-8');

  // Idempotency check — skip commented lines (# prefix)
  if (hasUncommentedTarget(content, targetName)) {
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
  if (hasUncommentedTarget(content, targetName)) {
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
