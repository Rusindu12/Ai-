/// Tiny in-memory ring buffer + optional console echo.
///
/// Deliberately not `package:logger`: we need (a) an on-screen diagnostics view
/// and (b) the ability to *not* leak secrets into logcat in release builds.
class AppLog {
  AppLog({this.echo = true, this.capacity = 300});

  final bool echo;
  final int capacity;
  final QueueEntryQueue _entries = QueueEntryQueue()..capacity = capacity;

  int get count => _entries.length;
  List<LogEntry> get recent => _entries.snapshot();

  void debug(String message) => _add(LogLevel.debug, message);
  void info(String message) => _add(LogLevel.info, message);
  void warn(String message) => _add(LogLevel.warn, message);
  void error(String message, [Object? error]) => _add(LogLevel.error, error == null ? message : '$message: $error');

  /// Never log a raw secret: redact anything that looks like a key/secret/token.
  static String redact(String message) {
    var out = message;
    for (final pattern in const [
      RegExp(r'(?i)(api[_ -]?key|api[_ -]?secret|secret|token|password)["\']?\s*[:=]\s*["\']?([A-Za-z0-9_\-]{4,})'),
    ]) {
      out = out.replaceAllMapped(pattern, (m) => '${m.group(1)}=<redacted>');
    }
    return out;
  }

  void _add(LogLevel level, String rawMessage) {
    final message = redact(rawMessage);
    _entries.push(LogEntry(level: level, message: message, at: DateTime.now()));
    if (echo) {
      // ignore: avoid_print
      print('[${level.name.toUpperCase()}] $message');
    }
  }

  void clear() => _entries.clear();
}

enum LogLevel { debug, info, warn, error }

class LogEntry {
  const LogEntry({required this.level, required this.message, required this.at});
  final LogLevel level;
  final String message;
  final DateTime at;

  String get label => '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}:${at.second.toString().padLeft(2, '0')}';
}

class QueueEntryQueue {
  final List<LogEntry> _items = [];
  int _max = 300;

  int get length => _items.length;

  void set capacity(int value) => _max = value;

  void push(LogEntry entry) {
    _items.add(entry);
    while (_items.length > _max) {
      _items.removeAt(0);
    }
  }

  List<LogEntry> snapshot() => List<LogEntry>.unmodifiable(_items.reversed);

  void clear() => _items.clear();
}
