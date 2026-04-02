
require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name                = "RNNotifeeCore"
  s.version             = package["version"]
  s.description         = package["description"]
  s.summary             = <<-DESC
                            A feature rich local notifications library for React Native Android & iOS.
                          DESC
  s.homepage            = "https://github.com/marcocrupi/react-native-notify-kit"
  s.license             = package['license']
  s.authors             = "Marco Crupi"
  s.source              = { :git => "https://github.com/marcocrupi/react-native-notify-kit", :tag => "react-native-notify-kit@#{s.version}" }

  s.cocoapods_version        = '>= 1.10.0'
  s.ios.deployment_target   = '15.1'
    
  if defined?($NotifeeCoreFromSources) && $NotifeeCoreFromSources == true
    # internal dev flag used by Notifee devs, ignore
    Pod::UI.warn "RNNotifeeCore: Using NotifeeCore from sources."
    s.dependency 'NotifeeCore'
  else
    s.subspec "NotifeeCore" do |ss|
      ss.source_files = "ios/NotifeeCore/*.{h,mm,m}"
    end
  end

  s.source_files =  ['ios/RNNotifee/NotifeeExtensionHelper.h', 'ios/RNNotifee/NotifeeExtensionHelper.m']
  s.public_header_files = ['ios/RNNotifee/NotifeeExtensionHelper.h']
end
