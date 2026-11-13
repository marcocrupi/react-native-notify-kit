# Only isolated paths created by test-ios-nse-pod-ownership.cjs are modified.
require 'cocoapods'
require 'xcodeproj'
require 'json'
# Preserve the production podspec branch/file semantics, isolate the RN graph.
def install_modules_dependencies(spec); end
root, phase = ARGV
raise 'fixture path required' unless File.basename(File.dirname(root)).start_with?('notifee-issue95-pods-')
project = Xcodeproj::Project.new(File.join(root, 'Probe.xcodeproj'))
app = project.new_target(:application, 'Host', :ios, '15.1')
extension = project.new_target(:app_extension, 'NotifyKitNSE', :ios, '15.1')
app.add_dependency(extension)
embed = app.new_copy_files_build_phase('Embed App Extensions')
embed.dst_subfolder_spec = '13'
embed.add_file_reference(extension.product_reference, true)
project.save
$notifee_probe_early = nil
def probe_autolinking
  spec = Pod::Specification.from_file(File.join(Dir.pwd, '../package/RNNotifee.podspec'))
  $notifee_probe_early = { subspecs: spec.subspecs.map(&:name), dependencies: spec.dependencies.map(&:name) }
end
Dir.chdir(root) do
  config = Pod::Config.instance
  config.installation_root = Pathname.new(root)
  config.sandbox_root = Pathname.new(File.join(root, 'Pods'))
  config.silent = true
  podfile = Pod::Podfile.from_file(Pathname.new(File.join(root, 'Podfile')))
  installer = Pod::Installer.new(Pod::Sandbox.new(File.join(root, 'Pods')), podfile)
  installer.repo_update = false
  installer.install!
  host = installer.aggregate_targets.find { |target| target.name == 'Pods-Host' }
  raise 'missing host aggregate' unless host
  owners = host.pod_targets.map do |target|
    files = target.file_accessors.flat_map(&:source_files).map(&:to_s)
    { name: target.name, dependencies: target.dependencies, type: target.send(:build_type).to_s,
      core: files.grep(/NotifeeCore\+UNUserNotificationCenter\.m$/),
      helper: files.grep(%r{/RNNotifee/NotifeeExtensionHelper\.m$}) }
  end
  core = owners.select { |owner| !owner[:core].empty? }.map { |owner| owner[:name] }
  helper = owners.select { |owner| !owner[:helper].empty? }.map { |owner| owner[:name] }
  xcconfig = Dir.glob('Pods/Target Support Files/Pods-Host/Pods-Host.*.xcconfig').to_h do |file|
    [file, File.readlines(file).grep(/OTHER_LDFLAGS|FRAMEWORK_SEARCH_PATHS|LIBRARY_SEARCH_PATHS/).map(&:strip)]
  end
  report = { coreOwners: core, helperOwners: helper, earlyPodspec: $notifee_probe_early,
             hostPods: owners, linkerInputs: xcconfig,
             extensionPods: installer.aggregate_targets.reject { |target| target == host }.map { |target| { name: target.name, pods: target.pod_targets.map(&:name) } } }
  File.write('ownership.json', JSON.pretty_generate(report))
  expected = phase == 'before' && owners.any? { |owner| owner[:type] == 'dynamic framework' } ? 2 : 1
  raise "core ownership #{core.inspect}, expected #{expected}" unless core.length == expected
  raise "helper ownership #{helper.inspect}, expected #{expected}" unless helper.length == expected
  if phase != 'before'
    raise 'flag too late at autolinking' unless $notifee_probe_early[:dependencies].include?('RNNotifeeCore') && $notifee_probe_early[:subspecs].empty?
    raise 'RNNotifee should depend on RNNotifeeCore' unless owners.find { |owner| owner[:name] == 'RNNotifee' }[:dependencies].include?('RNNotifeeCore')
    raise 'no generated linker inputs' if xcconfig.empty?
  end
end
