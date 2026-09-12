import 'package:flutter/material.dart';

/// Dark-first trading UI (traders keep dark mode) with a light theme for
/// daytime use. Colour semantics are fixed: green = up/buy, red = down/sell,
/// amber = AI, blue = info.
class AppColors {
  const AppColors._();

  static const Color up = Color(0xFF10B981);
  static const Color down = Color(0xFFF43F5E);
  static const Color ai = Color(0xFFF59E0B);
  static const Color info = Color(0xFF38BDF8);
  static const Color hold = Color(0xFF94A3B8);

  static const Color darkBg = Color(0xFF0B1220);
  static const Color darkSurface = Color(0xFF111B2E);
  static const Color darkCard = Color(0xFF16233A);
  static const Color darkBorder = Color(0xFF1F2F4A);

  static const Color lightBg = Color(0xFFF6F8FC);
  static const Color lightCard = Color(0xFFFFFFFF);
  static const Color lightBorder = Color(0xFFDDE3EE);

  static Color forChange(double pct) => pct >= 0 ? up : down;

  static Color forAction(String action) => switch (action.toUpperCase()) {
        'BUY' => up,
        'SELL' => down,
        _ => hold,
      };
}

ThemeData buildTheme({required Brightness brightness}) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.up,
    brightness: brightness,
    primary: dark ? AppColors.up : const Color(0xFF059669),
    secondary: AppColors.info,
    error: AppColors.down,
    surface: dark ? AppColors.darkSurface : Colors.white,
  );
  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? AppColors.darkBg : AppColors.lightBg,
    visualDensity: VisualDensity.compact,
    splashFactory: InkRipple.splashFactory,
  );

  return base.copyWith(
    appBarTheme: AppBarTheme(
      backgroundColor: dark ? AppColors.darkBg : Colors.white,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: base.textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w700,
        color: dark ? Colors.white : const Color(0xFF0F172A),
      ),
      iconTheme: IconThemeData(color: dark ? Colors.white70 : const Color(0xFF334155)),
    ),
    cardTheme: CardThemeData(
      color: dark ? AppColors.darkCard : AppColors.lightCard,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: dark ? AppColors.darkBorder : AppColors.lightBorder),
      ),
    ),
    dividerTheme: DividerThemeData(
      color: dark ? AppColors.darkBorder : AppColors.lightBorder,
      thickness: 1,
      space: 1,
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: dark ? const Color(0xFF0E1728) : const Color(0xFFF1F5F9),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: dark ? AppColors.darkBorder : AppColors.lightBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: dark ? AppColors.darkBorder : AppColors.lightBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.info, width: 1.4),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.down),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 46),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(shape: const StadiumBorder()),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: dark ? AppColors.darkSurface : Colors.white,
      indicatorColor: (dark ? AppColors.up : const Color(0xFF059669)).withOpacity(0.16),
      height: 64,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStatePropertyAll(
        base.textTheme.labelSmall?.copyWith(fontSize: 11, fontWeight: FontWeight.w600),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    tabBarTheme: const TabBarThemeData(dividerColor: Colors.transparent),
    listTileTheme: const ListTileThemeData(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 2)),
    progressIndicatorTheme: base.progressIndicatorTheme.copyWith(
      linearMinHeight: 3,
      color: AppColors.info,
    ),
  );
}
