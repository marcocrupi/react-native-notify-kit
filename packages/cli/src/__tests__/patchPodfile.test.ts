import { getPatchedPodfile } from '../lib/patchPodfile';

const RNFB_POST_INSTALL_MARKER =
  'NotifyKitNSE: avoid an Xcode build cycle between the embedded app extension';
const RNFB_INFO_PLIST_INPUT_PATH = '$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)';

const BASIC_PODFILE = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!
end
`;

const PODFILE_WITH_POST_INSTALL = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!

  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

const PODFILE_WITH_NESTED_DO = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!

  post_install do |installer|
    installer.pods_project.targets.each do |target|
      puts target.name
    end
  end
end
`;

const PODFILE_WITH_POST_INSTALL_IF = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!

  post_install do |installer|
    if ENV['CI']
      puts 'CI'
    end

    react_native_post_install(installer)
  end
end
`;

const PODFILE_WITH_NESTED_DO_AND_IF = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!

  post_install do |installer|
    installer.pods_project.targets.each do |target|
      if target.name == 'Foo'
        puts target.name
      end
    end

    react_native_post_install(installer)
  end
end
`;

const PODFILE_WITH_POST_INSTALL_BEGIN = `platform :ios, '15.1'

target 'MyApp' do
  use_react_native!

  post_install do |installer|
    begin
      puts 'configure'
    rescue StandardError
      puts 'ignored'
    end

    react_native_post_install(installer)
  end
end
`;

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

describe('patchPodfile', () => {
  it('nests NSE target inside the main app target and adds post_install when absent', () => {
    const result = getPatchedPodfile(BASIC_PODFILE, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
    expect(result).toContain('inherit! :search_paths');
    expect(result).toContain("pod 'RNNotifeeCore'");
    expect(result).toContain('post_install do |installer|');
    expect(result).toContain(RNFB_POST_INSTALL_MARKER);
    expect(result).toContain(`rnfb_info_plist_input_path = '${RNFB_INFO_PLIST_INPUT_PATH}'`);
    expect(result).toContain('script_phase[:input_files].delete(rnfb_info_plist_input_path)');
    expect(result).toContain('phase.input_paths.delete(rnfb_info_plist_input_path)');
    // Verify it's INSIDE the main target (before the outer `end`)
    const nseIndex = result!.indexOf("target 'NotifyKitNSE'");
    const postInstallIndex = result!.indexOf('post_install do |installer|');
    expect(nseIndex).toBeLessThan(postInstallIndex);
  });

  it('preserves an existing post_install hook and inserts the RNFB patch inside it', () => {
    const result = getPatchedPodfile(PODFILE_WITH_POST_INSTALL, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
    expect(result).toContain('react_native_post_install(installer)');
    expect(result).toContain(`${RNFB_POST_INSTALL_MARKER}`);
    expect(countOccurrences(result!, 'post_install do |installer|')).toBe(1);
    expect(result!.indexOf('react_native_post_install(installer)')).toBeLessThan(
      result!.indexOf(RNFB_POST_INSTALL_MARKER),
    );
  });

  it('inserts the RNFB patch outside an internal if/end block in post_install', () => {
    const result = getPatchedPodfile(PODFILE_WITH_POST_INSTALL_IF, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("if ENV['CI']");
    expect(result).toContain('react_native_post_install(installer)');
    expect(countOccurrences(result!, 'post_install do |installer|')).toBe(1);

    const markerIndex = result!.indexOf(RNFB_POST_INSTALL_MARKER);
    const reactNativePostInstallIndex = result!.indexOf('react_native_post_install(installer)');
    const nseTargetIndex = result!.indexOf("target 'NotifyKitNSE' do");
    expect(markerIndex).toBeGreaterThan(reactNativePostInstallIndex);
    expect(nseTargetIndex).toBeGreaterThan(markerIndex);
  });

  it('inserts the RNFB patch after nested each do and if/end blocks', () => {
    const result = getPatchedPodfile(PODFILE_WITH_NESTED_DO_AND_IF, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain('installer.pods_project.targets.each do |target|');
    expect(result).toContain("if target.name == 'Foo'");
    expect(result).toContain('react_native_post_install(installer)');

    const markerIndex = result!.indexOf(RNFB_POST_INSTALL_MARKER);
    const reactNativePostInstallIndex = result!.indexOf('react_native_post_install(installer)');
    const nseTargetIndex = result!.indexOf("target 'NotifyKitNSE' do");
    expect(markerIndex).toBeGreaterThan(reactNativePostInstallIndex);
    expect(nseTargetIndex).toBeGreaterThan(markerIndex);
  });

  it('is idempotent when run twice on a complex post_install hook', () => {
    const first = getPatchedPodfile(PODFILE_WITH_NESTED_DO_AND_IF, 'NotifyKitNSE');
    expect(first).not.toBeNull();

    const second = getPatchedPodfile(first!, 'NotifyKitNSE');
    expect(second).toBeNull();
    expect(countOccurrences(first!, RNFB_POST_INSTALL_MARKER)).toBe(1);
    expect(countOccurrences(first!, "target 'NotifyKitNSE' do")).toBe(1);
    expect(countOccurrences(first!, 'post_install do |installer|')).toBe(1);
    expect(first!.trim().endsWith('end')).toBe(true);
  });

  it('handles begin/end blocks inside post_install', () => {
    const result = getPatchedPodfile(PODFILE_WITH_POST_INSTALL_BEGIN, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain('begin');
    expect(result).toContain('rescue StandardError');

    const markerIndex = result!.indexOf(RNFB_POST_INSTALL_MARKER);
    const reactNativePostInstallIndex = result!.indexOf('react_native_post_install(installer)');
    const nseTargetIndex = result!.indexOf("target 'NotifyKitNSE' do");
    expect(markerIndex).toBeGreaterThan(reactNativePostInstallIndex);
    expect(nseTargetIndex).toBeGreaterThan(markerIndex);
  });

  it('patches legacy Podfiles when the NSE target already exists without the RNFB hook', () => {
    const podfileWithNse = BASIC_PODFILE.replace('end', "  target 'NotifyKitNSE' do\n  end\nend");
    const result = getPatchedPodfile(podfileWithNse, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(countOccurrences(result!, "target 'NotifyKitNSE' do")).toBe(1);
    expect(result).toContain(RNFB_POST_INSTALL_MARKER);
  });

  it('is idempotent when run twice', () => {
    const first = getPatchedPodfile(BASIC_PODFILE, 'NotifyKitNSE');
    expect(first).not.toBeNull();

    const second = getPatchedPodfile(first!, 'NotifyKitNSE');
    expect(second).toBeNull();
    expect(countOccurrences(first!, "target 'NotifyKitNSE' do")).toBe(1);
    expect(countOccurrences(first!, RNFB_POST_INSTALL_MARKER)).toBe(1);
  });

  it('handles nested do blocks (post_install with .each do)', () => {
    const result = getPatchedPodfile(PODFILE_WITH_NESTED_DO, 'NotifyKitNSE');
    expect(result).not.toBeNull();
    // NSE should be inside the main target, before its final `end`
    expect(result).toContain("target 'NotifyKitNSE' do");
    expect(result).toContain(RNFB_POST_INSTALL_MARKER);
    // The patched content should still end with `end` for the main target
    expect(result!.trim().endsWith('end')).toBe(true);
  });

  it('handles empty Podfile gracefully', () => {
    const result = getPatchedPodfile('', 'NotifyKitNSE');
    expect(result).not.toBeNull();
    expect(result).toContain("target 'NotifyKitNSE' do");
    expect(result).toContain(RNFB_POST_INSTALL_MARKER);
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

  it('generates RNFB-safe logic when React Native Firebase is absent', () => {
    const result = getPatchedPodfile(BASIC_PODFILE, 'NotifyKitNSE');
    expect(result).toContain('next unless rnfb_phase_names.include?(script_phase[:name])');
    expect(result).toContain('next unless script_phase[:input_files]');
    expect(result).toContain('next unless rnfb_phase_names.include?(phase.name)');
    expect(result).toContain('next unless phase.input_paths');
    expect(result).toContain(`rnfb_info_plist_input_path = '${RNFB_INFO_PLIST_INPUT_PATH}'`);
  });

  it('H2: throws when depth counter cannot find matching end', () => {
    // A Podfile where ^target matches but the closing `end` is missing.
    const brokenPodfile = `platform :ios, '15.1'

target 'MyApp' do
  pod 'React', :path => '../node_modules/react-native'
`;
    expect(() => getPatchedPodfile(brokenPodfile, 'NotifyKitNSE')).toThrow(
      /Could not locate main app target/,
    );
  });
});
