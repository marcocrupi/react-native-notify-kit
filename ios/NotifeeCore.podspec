require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'packages', 'react-native', 'package.json')))

Pod::Spec.new do |s|
  s.name                = "NotifeeCore"
  s.version             = package["version"]
  s.description         = "NotifeeCore native module for react-native-notify-kit"
  s.summary             = <<-DESC
                            NotifeeCore module - podspec
                          DESC
  s.homepage            = "https://github.com/marcocrupi/react-native-notify-kit"
  s.license             = package['license']
  s.authors             = "Marco Crupi"
  s.source              = { :git => "https://github.com/marcocrupi/react-native-notify-kit", :tag => "react-native-notify-kit@#{s.version}" }

  s.ios.deployment_target   = '15.1'
  s.source_files             = 'NotifeeCore/*.{h,m}'
end
