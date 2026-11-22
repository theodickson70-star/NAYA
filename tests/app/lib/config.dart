/// Weka URL na anon key za Supabase hapa, au tumia --dart-define wakati wa build:
///   flutter run --dart-define=SUPABASE_URL=https://xxx.supabase.co --dart-define=SUPABASE_ANON_KEY=eyJ...
class AppConfig {
  static const supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://WEKA-PROJECT-YAKO.supabase.co',
  );
  static const supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: 'WEKA-ANON-KEY-YAKO',
  );
  static const appName = 'WakalaLink';
  static const company = 'DUKALANGU SOLUTION GROUP';

  /// SMS bado hazijawekwa (zitaunganishwa na RodSMS baadaye). Zikiwa false, swichi za SMS hazionekani
  /// na arifa zinaonekana ndani ya app tu.
  static const smsEnabled = false;
}
