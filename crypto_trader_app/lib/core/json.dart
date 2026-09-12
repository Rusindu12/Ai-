/// Defensive JSON helpers.
///
/// The backend serialises `Decimal` values as **strings** (exact precision for
/// money) and some numeric fields as ints or floats depending on the endpoint,
/// so every numeric read in the app goes through these helpers.
library;

double asDouble(Object? value, {double fallback = 0}) {
  if (value == null) return fallback;
  if (value is double) return value;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

double? asDoubleOrNull(Object? value) {
  if (value == null) return null;
  final d = asDouble(value, fallback: double.nan);
  return d.isNaN ? null : d;
}

int asInt(Object? value, {int fallback = 0}) {
  if (value == null) return fallback;
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

bool asBool(Object? value, {bool fallback = false}) {
  if (value == null) return fallback;
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) return value == 'true' || value == '1';
  return fallback;
}

String asString(Object? value, {String fallback = ''}) {
  if (value == null) return fallback;
  if (value is String) return value;
  return value.toString();
}

/// Binance-style epoch millis or ISO-8601 strings.
DateTime asDate(Object? value, {DateTime? fallback}) {
  if (value == null) return fallback ?? DateTime.fromMillisecondsSinceEpoch(0);
  if (value is int) {
    // Heuristic: seconds vs milliseconds.
    return value > 100000000000
        ? DateTime.fromMillisecondsSinceEpoch(value)
        : DateTime.fromMillisecondsSinceEpoch(value * 1000);
  }
  if (value is String) {
    final parsed = DateTime.tryParse(value);
    if (parsed != null) return parsed.toLocal();
    final numValue = int.tryParse(value);
    if (numValue != null) return asDate(numValue, fallback: fallback);
  }
  return fallback ?? DateTime.fromMillisecondsSinceEpoch(0);
}

Map<String, dynamic> asMap(Object? value) =>
    value is Map ? value.map((k, v) => MapEntry(k.toString(), v)) : <String, dynamic>{};

List<dynamic> asList(Object? value) => value is List ? value : const [];

List<Map<String, dynamic>> asMapList(Object? value) =>
    asList(value).map(asMap).toList(growable: false);

/// Trailing-digits formatting used all over the UI.
String trimZeros(String input) {
  if (!input.contains('.')) return input;
  var out = input;
  while (out.endsWith('0')) {
    out = out.substring(0, out.length - 1);
  }
  if (out.endsWith('.')) out = out.substring(0, out.length - 1);
  return out;
}
