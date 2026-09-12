/// Tiny formatting helpers (no `intl` dependency, so version resolution in CI
/// stays trivial and the APK stays small).
library;

String _groupDigits(String intPart) {
  final buf = StringBuffer();
  final reversed = intPart.replaceAll('-', '').split('').reversed.toList();
  for (var i = 0; i < reversed.length; i++) {
    if (i > 0 && i % 3 == 0) buf.write(',');
    buf.write(reversed[i]);
  }
  final grouped = buf.toString().split('').reversed.join();
  return intPart.startsWith('-') ? '-$grouped' : grouped;
}

/// Price with sensible precision (BTC needs 2 decimals, SHIB needs 8).
String fmtPrice(double value, {int? decimals}) {
  final a = value.abs();
  final d = decimals ??
      (a >= 10000
          ? 1
          : a >= 1000
              ? 2
              : a >= 10
                  ? 3
                  : a >= 1
                      ? 4
                      : a >= 0.01
                          ? 6
                          : a >= 0.0001
                              ? 8
                              : 10);
  final s = value.toStringAsFixed(d);
  final dot = s.indexOf('.');
  if (dot <= 0) return s;
  return '${_groupDigits(s.substring(0, dot))}${s.substring(dot)}';
}

String fmtUsd(double value, {int decimals = 2}) {
  final sign = value < 0 ? '-' : '';
  final s = value.abs().toStringAsFixed(decimals);
  final dot = s.indexOf('.');
  return '$sign\$${_groupDigits(s.substring(0, dot))}${s.substring(dot)}';
}

String fmtSignedUsd(double value, {int decimals = 2}) =>
    '${value > 0 ? '+' : ''}${fmtUsd(value, decimals: decimals)}';

String fmtPct(double value, {int decimals = 2, bool signed = true}) {
  final sign = signed && value > 0 ? '+' : '';
  return '$sign${value.toStringAsFixed(decimals)}%';
}

/// 12345 -> 12.3K, 5_400_000 -> 5.4M
String fmtCompact(num value) {
  final a = value.abs();
  final sign = value < 0 ? '-' : '';
  if (a >= 1e12) return '${sign}${(a / 1e12).toStringAsFixed(2)}T';
  if (a >= 1e9) return '${sign}${(a / 1e9).toStringAsFixed(2)}B';
  if (a >= 1e6) return '${sign}${(a / 1e6).toStringAsFixed(2)}M';
  if (a >= 1e3) return '${sign}${(a / 1e3).toStringAsFixed(2)}K';
  if (a >= 1) return '$sign${a.toStringAsFixed(2)}';
  return '$sign${a.toStringAsFixed(6)}';
}

String fmtQty(double value) {
  if (value == 0) return '0';
  final a = value.abs();
  if (a >= 1000) return _groupDigits(value.toStringAsFixed(2));
  if (a >= 1) return trimTail(value.toStringAsFixed(5));
  return trimTail(value.toStringAsFixed(a >= 0.001 ? 6 : 10));
}

String trimTail(String s) {
  if (!s.contains('.')) return s;
  var out = s;
  while (out.endsWith('0')) {
    out = out.substring(0, out.length - 1);
  }
  if (out.endsWith('.')) out = out.substring(0, out.length - 1);
  return out;
}

const List<String> _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

String fmtTime(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

String fmtTimeSeconds(DateTime t) =>
    '${fmtTime(t)}:${t.second.toString().padLeft(2, '0')}';

String fmtDate(DateTime t) => '${t.day} ${_months[t.month - 1]} ${t.year}';

String fmtDateTime(DateTime t) => '${fmtDate(t)} ${fmtTime(t)}';

/// "3m ago" / "2h ago" style relative time.
String fmtRelative(Duration d) {
  final s = d.inSeconds.abs();
  if (s < 10) return 'just now';
  if (s < 60) return '${s}s ago';
  if (d.inMinutes < 60) return '${d.inMinutes}m ago';
  if (d.inHours < 24) return '${d.inHours}h ago';
  if (d.inDays < 30) return '${d.inDays}d ago';
  return '${(d.inDays / 30).floor()}mo ago';
}
