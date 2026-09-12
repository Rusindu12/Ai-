/// Ultra-light localisation: a string table + RTL detection.
///
/// Deliberately dependency-free (no `.arb`, no codegen) so the build stays
/// simple; swap for `flutter gen-l10n` if you grow this.
class L {
  const L(this.locale);

  final String locale;

  static const List<String> supported = ['en', 'es', 'ar', 'si'];

  bool get isRtl => locale == 'ar';

  static List<Locale> get supportedLocales =>
      supported.map((c) => Locale(c)).toList(growable: false);

  String t(String key) {
    final table = _tables[locale] ?? _tables['en']!;
    return table[key] ?? _tables['en']![key] ?? key;
  }

  static const Map<String, Map<String, String>> _tables = {
    'en': {
      'dashboard': 'Dashboard',
      'trade': 'Trade',
      'ai': 'AI Trader',
      'portfolio': 'Portfolio',
      'orders': 'Orders',
      'settings': 'Settings',
      'alerts': 'Alerts',
      'buy': 'Buy',
      'sell': 'Sell',
      'hold': 'Hold',
      'market': 'Market',
      'limit': 'Limit',
      'sign_in': 'Sign in',
      'register': 'Create account',
      'email': 'Email',
      'password': 'Password',
      'paper_mode': 'Paper trading',
      'live_mode': 'Live trading',
      'kill_switch': 'Kill switch',
      'auto_trade': 'Auto-trade',
      'refresh': 'Refresh',
      'connected': 'Live stream connected',
      'disconnected': 'Stream offline',
      'locked': 'Locked',
      'unlock': 'Unlock',
    },
    'es': {
      'dashboard': 'Panel',
      'trade': 'Operar',
      'ai': 'Trader IA',
      'portfolio': 'Cartera',
      'orders': 'Órdenes',
      'settings': 'Ajustes',
      'alerts': 'Alertas',
      'buy': 'Comprar',
      'sell': 'Vender',
      'hold': 'Esperar',
      'market': 'Mercado',
      'limit': 'Límite',
      'sign_in': 'Entrar',
      'register': 'Crear cuenta',
      'email': 'Correo',
      'password': 'Contraseña',
      'paper_mode': 'Simulación',
      'live_mode': 'Real',
      'kill_switch': 'Paro total',
      'auto_trade': 'Auto-trading',
      'refresh': 'Actualizar',
      'connected': 'Stream conectado',
      'disconnected': 'Stream caído',
      'locked': 'Bloqueado',
      'unlock': 'Desbloquear',
    },
    'ar': {
      'dashboard': 'اللوحة',
      'trade': 'تداول',
      'ai': 'متداول الذكاء',
      'portfolio': 'المحفظة',
      'orders': 'الأوامر',
      'settings': 'الإعدادات',
      'alerts': 'التنبيهات',
      'buy': 'شراء',
      'sell': 'بيع',
      'hold': 'انتظار',
      'market': 'سعر السوق',
      'limit': 'حد',
      'sign_in': 'دخول',
      'register': 'حساب جديد',
      'email': 'البريد',
      'password': 'كلمة المرور',
      'paper_mode': 'تداول تجريبي',
      'live_mode': 'تداول حقيقي',
      'kill_switch': 'إيقاف كامل',
      'auto_trade': 'التداول الآلي',
      'refresh': 'تحديث',
      'connected': 'البث متصل',
      'disconnected': 'البث متوقف',
      'locked': 'مقفل',
      'unlock': 'فتح',
    },
    'si': {
      'dashboard': 'උපකරණ පුවරුව',
      'trade': 'වෙළඳාම',
      'ai': 'AI වෙළඳුරා',
      'portfolio': 'යම්කරුව',
      'orders': 'නියෝග',
      'settings': 'සැකසුම්',
      'alerts': 'ආනතති',
      'buy': 'ගන්න',
      'sell': 'විකිරීම',
      'hold': 'රැඳින්න',
      'market': 'වෙළඳපොල',
      'limit': 'සීමිත',
      'sign_in': 'පිවිසෙන්න',
      'register': 'ගිණුමක් සාදන්න',
      'email': 'විද්‍යුත් තැපෑල',
      'password': 'මුරපදය',
      'paper_mode': 'අනුකරණ වෙළඳාම',
      'live_mode': 'සජීවී වෙළඳාම',
      'kill_switch': 'සම්පූර්ණ නවතන්න',
      'auto_trade': 'ස්වයංක්‍රීය',
      'refresh': 'නැවුම්',
      'connected': 'ප්‍රවාහය සම්බන්ධයි',
      'disconnected': 'ප්‍රවාහය විසන්ධි',
      'locked': 'අගුළු',
      'unlock': 'අගුළු අරින්න',
    },
  };
}
