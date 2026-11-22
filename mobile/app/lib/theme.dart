import 'package:flutter/material.dart';

/// Rangi za NAYA (frontend/shared/naya.css) — zinatumika kote kwenye PayPoint.
class Naya {
  static const green = Color(0xFF0A6E47); // kijani kikuu
  static const greenDark = Color(0xFF06502F);
  static const greenDeep = Color(0xFF043A22);
  static const mint = Color(0xFFE6F2EC);
  static const gold = Color(0xFFF2B705); // dhahabu
  static const goldInk = Color(0xFF6B4E00); // maandishi juu ya njano
  static const goldOn = Color(0xFF3A2A00);
  static const goldSoft = Color(0xFFFFF6D6);
  static const danger = Color(0xFFC2412D);
  static const dangerBg = Color(0xFFFBECE9);
  static const ink = Color(0xFF17231D);
  static const muted = Color(0xFF5C6A62);
  static const line = Color(0xFFD6E2DB);
  static const bg = Color(0xFFF6F8F7);
  static const offline = Color(0xFF8A958F);

  /// Kuweka = kijani, Kutoa = dhahabu
  static const deposit = green;
  static const withdraw = goldInk;
}

const kDisplayFont = 'BricolageGrotesque';
const kBodyFont = 'AtkinsonHyperlegible';

/// Mtindo wa vichwa vya habari (Bricolage Grotesque, nzito)
TextStyle display(double size, {Color color = Naya.ink, FontWeight weight = FontWeight.w800}) =>
    TextStyle(fontFamily: kDisplayFont, fontSize: size, fontWeight: weight, color: color, letterSpacing: -0.2, height: 1.1);

ThemeData buildNayaTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: Naya.green).copyWith(
    primary: Naya.green,
    onPrimary: Colors.white,
    primaryContainer: Naya.mint,
    onPrimaryContainer: Naya.greenDeep,
    secondary: Naya.gold,
    onSecondary: Naya.goldOn,
    secondaryContainer: Naya.goldSoft,
    onSecondaryContainer: Naya.goldInk,
    error: Naya.danger,
    onError: Colors.white,
    errorContainer: Naya.dangerBg,
    onErrorContainer: Naya.danger,
    surface: Colors.white,
    onSurface: Naya.ink,
    onSurfaceVariant: Naya.muted,
    outline: Naya.line,
    outlineVariant: Naya.line,
  );

  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: kBodyFont);
  final t = base.textTheme;
  TextStyle? head(TextStyle? s) =>
      s?.copyWith(fontFamily: kDisplayFont, fontWeight: FontWeight.w800, letterSpacing: -0.2);
  final rounded14 = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));

  OutlineInputBorder border(Color c, [double w = 1]) =>
      OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: c, width: w));

  return base.copyWith(
    scaffoldBackgroundColor: Naya.bg,
    textTheme: t
        .copyWith(
          displayLarge: head(t.displayLarge),
          displayMedium: head(t.displayMedium),
          displaySmall: head(t.displaySmall),
          headlineLarge: head(t.headlineLarge),
          headlineMedium: head(t.headlineMedium),
          headlineSmall: head(t.headlineSmall),
          titleLarge: head(t.titleLarge),
        )
        .apply(bodyColor: Naya.ink, displayColor: Naya.ink),
    appBarTheme: AppBarTheme(
      backgroundColor: Naya.bg,
      foregroundColor: Naya.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
      titleTextStyle: display(21),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      margin: const EdgeInsets.symmetric(vertical: 5),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Naya.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 52),
        shape: rounded14,
        textStyle: const TextStyle(fontFamily: kBodyFont, fontWeight: FontWeight.w700, fontSize: 16),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 52),
        foregroundColor: Naya.ink,
        backgroundColor: Colors.white,
        side: const BorderSide(color: Naya.line),
        shape: rounded14,
        textStyle: const TextStyle(fontFamily: kBodyFont, fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: Naya.green,
        textStyle: const TextStyle(fontFamily: kBodyFont, fontWeight: FontWeight.w700),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: border(Naya.line),
      enabledBorder: border(Naya.line),
      focusedBorder: border(Naya.green, 2),
      errorBorder: border(Naya.danger),
      focusedErrorBorder: border(Naya.danger, 2),
      labelStyle: const TextStyle(color: Naya.muted),
      prefixIconColor: Naya.muted,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: Naya.mint,
      elevation: 0,
      height: 68,
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(color: s.contains(WidgetState.selected) ? Naya.green : Naya.muted),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(
          fontFamily: kBodyFont,
          fontSize: 12,
          fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w400,
          color: s.contains(WidgetState.selected) ? Naya.green : Naya.muted,
        ),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: Naya.line,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Naya.ink,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    chipTheme: const ChipThemeData(side: BorderSide.none, shape: StadiumBorder()),
    dividerTheme: const DividerThemeData(color: Naya.line, thickness: 1, space: 20),
    listTileTheme: const ListTileThemeData(iconColor: Naya.muted),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: Naya.green),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: Naya.gold,
      foregroundColor: Naya.goldOn,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : null),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Naya.green : null),
    ),
  );
}
