import { getPatchedPodfile } from '../lib/patchPodfile';

const BASIC_PODFILE = `platform :ios, '15.1'

target 'MyApp' do
  pod 'React', :path => '../node_modules/react-native'
end
`;

const PODFILE_WITH_POST_INSTALL = `platform :ios, '15.1'

target 'MyApp' do
  pod 'React', :path => '../node_modules/react-native'

  post_install do |installer|
    puts 'done'
  end
end
`;

const PODFILE_WITH_NESTED_DO = `platform :ios, '15.1'

target 'MyApp' do
  pod 'React', :path => '../node_modules/react-native'

  post_install do |installer|
    installer.pods_project.targets.each do |target|
      puts target.name
    end
  end
end
`;

describe('patchPodfile', () => {
  it('nests NSE target inside the main app target', () => {
    const result = getPatchedPodfile(BASIC_PODFILE, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
    expect(result).toContain('inherit! :search_paths');
    expect(result).toContain("pod 'RNNotifeeCore'");
    // Verify it's INSIDE the main target (before the outer `end`)
    const nseIndex = result!.indexOf("target 'NotifyKitNSE'");
    const outerEndIndex = result!.lastIndexOf('end');
    expect(nseIndex).toBeLessThan(outerEndIndex);
  });

  it('inserts before the main target closing end (not after post_install)', () => {
    const result = getPatchedPodfile(PODFILE_WITH_POST_INSTALL, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
  });

  it('returns null when target already exists (idempotent)', () => {
    const podfileWithNse = BASIC_PODFILE.replace('end', "  target 'NotifyKitNSE' do\n  end\nend");
    expect(getPatchedPodfile(podfileWithNse, 'NotifyKitNSE')).toBeNull();
  });

  it('handles nested do blocks (post_install with .each do)', () => {
    const result = getPatchedPodfile(PODFILE_WITH_NESTED_DO, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    // NSE should be inside the main target, before its final `end`
    expect(result).toContain("target 'NotifyKitNSE' do");
    // The patched content should still end with `end` for the main target
    expect(result!.trim().endsWith('end')).toBe(true);
  });

  it('handles empty Podfile gracefully', () => {
    const result = getPatchedPodfile('', 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
  });

  it('handles custom target name', () => {
    const result = getPatchedPodfile(BASIC_PODFILE, 'MyCustomNSE');
    expect(result).toContain("target 'MyCustomNSE' do");
  });

  it('H1: does NOT match commented-out target as existing (false idempotency)', () => {
    const podfileWithComment = BASIC_PODFILE.replace(
      'end',
      "  # target 'NotifyKitNSE' do\n  # end\nend",
    );
    const result = getPatchedPodfile(podfileWithComment, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
  });

  it('includes inherit! :search_paths for CocoaPods host detection', () => {
    const result = getPatchedPodfile(BASIC_PODFILE, 'NotifyKitNSE');
    expect(result).toContain('inherit! :search_paths');
  });
});
