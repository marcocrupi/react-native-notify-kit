import { getPatchedPodfile } from '../lib/patchPodfile';

const BASIC_PODFILE = `platform :ios, '15.1'

target 'MyApp' do
  pod 'React', :path => '../node_modules/react-native'
end
`;

const PODFILE_WITH_POST_INSTALL = `platform :ios, '15.1'

target 'MyApp' do
  pod 'React', :path => '../node_modules/react-native'
end

post_install do |installer|
  puts 'done'
end
`;

const PODFILE_WITH_USE_FRAMEWORKS = `platform :ios, '15.1'
use_frameworks! :linkage => :static

target 'MyApp' do
  pod 'React', :path => '../node_modules/react-native'
end
`;

describe('patchPodfile', () => {
  it('appends NSE target block to basic Podfile', () => {
    const result = getPatchedPodfile(BASIC_PODFILE, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
    expect(result).toContain("pod 'RNNotifeeCore'");
  });

  it('inserts before post_install block when present', () => {
    const result = getPatchedPodfile(PODFILE_WITH_POST_INSTALL, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    const nseIndex = result!.indexOf("target 'NotifyKitNSE'");
    const postInstallIndex = result!.indexOf('post_install do');
    expect(nseIndex).toBeLessThan(postInstallIndex);
  });

  it('returns null when target already exists (idempotent)', () => {
    const podfileWithNse = BASIC_PODFILE + "\ntarget 'NotifyKitNSE' do\nend\n";
    expect(getPatchedPodfile(podfileWithNse, 'NotifyKitNSE')).toBeNull();
  });

  it('detects use_frameworks! and adds static linkage conditional', () => {
    const result = getPatchedPodfile(PODFILE_WITH_USE_FRAMEWORKS, 'NotifyKitNSE');
    expect(result).toContain('$RNFirebaseAsStaticFramework');
  });

  it('does NOT add static linkage line when use_frameworks! absent', () => {
    const result = getPatchedPodfile(BASIC_PODFILE, 'NotifyKitNSE');
    expect(result).not.toContain('$RNFirebaseAsStaticFramework');
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
    const podfileWithComment = BASIC_PODFILE + "\n# target 'NotifyKitNSE' do\n# end\n";
    const result = getPatchedPodfile(podfileWithComment, 'NotifyKitNSE');
    // Should NOT return null — the comment should be ignored
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
  });
});
