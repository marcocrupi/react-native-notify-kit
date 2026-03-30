Pod::Spec.new do |s|
  s.name                = "NotifeeCore"
  s.version             = "1.0.0"
  s.description         = "NotifeeCore"
  s.summary             = <<-DESC
                            NotifeeCore module - podspec
                          DESC
  s.homepage            = "https://github.com/marcocrupi/react-native-notify-kit"
  s.license             = "Apache 2.0"
  s.authors             = "Invertase Limited"
  s.source              = { :git => "https://github.com/marcocrupi/react-native-notify-kit" }
  s.social_media_url    = 'http://twitter.com/notifee_app'

  s.ios.deployment_target   = '10.0'
  s.source_files             = 'NotifeeCore/*.{h,m}'
end
