import 'package:crypto_trader_app/core/formatters.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('fmtPrice', () {
    test('scales decimals with magnitude', () {
      expect(fmtPrice(68123.456), '68,123.5');
      expect(fmtPrice(1234.5), '1,234.50');
      expect(fmtPrice(0.00004321), '0.0000432100');
      expect(fmtPrice(3.14159), '3.1416');
    });

    test('groups thousands', () {
      expect(fmtPrice(1234567.891), '1,234,567.9');
      expect(fmtPrice(-12345.6), '-12,345.6');
    });
  });

  group('fmtUsd / fmtPct', () {
    test('always two decimals and a sign for gains', () {
      expect(fmtUsd(1234.5), r'$1,234.50');
      expect(fmtUsd(-1234.5), r'-$1,234.50');
      expect(fmtSignedUsd(10.5), r'+$10.50');
      expect(fmtPct(2.5), '+2.50%');
      expect(fmtPct(-2.5), '-2.50%');
      expect(fmtPct(2.5, signed: false), '2.50%');
    });
  });

  group('fmtCompact', () {
    test('abbreviates big numbers', () {
      expect(fmtCompact(1_234_567), '1.23M');
      expect(fmtCompact(1_234_567_890_000), '1.23T');
      expect(fmtCompact(-4_200), '-4.20K');
      expect(fmtCompact(0.000123), '0.000123');
    });
  });

  group('fmtQty', () {
    test('trims trailing zeros', () {
      expect(fmtQty(0.0010000), '0.001');
      expect(fmtQty(12345.6789), '12,345.68');
      expect(fmtQty(0), '0');
    });
  });

  group('relative time', () {
    test('humanises durations', () {
      expect(fmtRelative(const Duration(seconds: 3)), 'just now');
      expect(fmtRelative(const Duration(seconds: 45)), '45s ago');
      expect(fmtRelative(const Duration(minutes: 7)), '7m ago');
      expect(fmtRelative(const Duration(hours: 5)), '5h ago');
      expect(fmtRelative(const Duration(days: 3)), '3d ago');
    });
  });

  test('date helpers', () {
    expect(fmtDate(DateTime(2026, 1, 2)), '2 Jan 2026');
    expect(fmtTime(DateTime(2026, 1, 2, 9, 5)), '09:05');
    expect(fmtTimeSeconds(DateTime(2026, 1, 2, 23, 59, 1)), '23:59:01');
  });
}
