
require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name                = "RNNotifee"
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
  s.platforms                = { :ios => '15.1' }

  install_modules_dependencies(s)
  s.source_files = 'ios/RNNotifee/*.{h,m,mm,cpp}'

  if defined?($NotifeeCoreFromSources) && $NotifeeCoreFromSources == true
    # internal dev flag used by Notifee devs, ignore
    Pod::UI.warn "RNNotifee: Using NotifeeCore from sources."
    s.dependency 'NotifeeCore'
  elsif defined?($NotifeeExtension) && $NotifeeExtension == true
    # App uses Notification Service Extension
    Pod::UI.warn "RNNotifee: using Notification Service Extension."
    s.dependency 'RNNotifeeCore'
  else
    s.subspec "NotifeeCore" do |ss|
      ss.source_files = "ios/NotifeeCore/*.{h,mm,m}"
    end
  end

end
