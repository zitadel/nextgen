/// Cookie handling for the flow API.
///
/// The server is stateless between flow requests — the encrypted `_zflow`
/// cookie carries all orchestration state (see `POST /flow` in the OpenAPI
/// spec). Browsers replay it automatically; a native client must capture
/// `Set-Cookie` responses and send the cookies back itself. This store is
/// deliberately single-origin: the SDK talks to exactly one base URL, so
/// cookies are keyed by name only and `Domain`/`Path` attributes are not
/// evaluated.
library;

/// Persists cookies between requests to the configured base URL.
abstract interface class CookieStore {
  /// Value for the `Cookie` request header, or null when no unexpired
  /// cookies are stored.
  Future<String?> cookieHeader();

  /// Ingests `Set-Cookie` response headers (one string per header).
  Future<void> storeSetCookies(List<String> setCookies);

  /// Drops all stored cookies.
  Future<void> clear();
}

/// A single stored cookie.
class StoredCookie {
  StoredCookie({required this.name, required this.value, this.expiresAt});

  final String name;
  final String value;

  /// Absolute expiry, or null for a session cookie.
  final DateTime? expiresAt;

  bool isExpired(DateTime now) => expiresAt != null && !expiresAt!.isAfter(now);
}

/// In-memory [CookieStore]. Flows survive as long as the process does;
/// `zitadel_flutter` provides a secure persistent implementation so a
/// killed app can resume a flow.
class InMemoryCookieStore implements CookieStore {
  InMemoryCookieStore({DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;
  final Map<String, StoredCookie> _cookies = {};

  @override
  Future<String?> cookieHeader() async {
    final now = _clock();
    _cookies.removeWhere((_, cookie) => cookie.isExpired(now));
    if (_cookies.isEmpty) return null;
    return _cookies.values
        .map((cookie) => '${cookie.name}=${cookie.value}')
        .join('; ');
  }

  @override
  Future<void> storeSetCookies(List<String> setCookies) async {
    final now = _clock();
    for (final line in setCookies) {
      final cookie = parseSetCookie(line, now: now);
      if (cookie == null) continue;
      // Max-Age=0 (or any past expiry) is the server's deletion signal —
      // e.g. DELETE /sessions/me clears __nextgen_session this way.
      if (cookie.isExpired(now)) {
        _cookies.remove(cookie.name);
      } else {
        _cookies[cookie.name] = cookie;
      }
    }
  }

  @override
  Future<void> clear() async => _cookies.clear();
}

/// Parses one `Set-Cookie` header line into a [StoredCookie].
///
/// `Max-Age` takes precedence over `Expires` (RFC 6265 §5.3). Attributes
/// that only matter in a multi-origin browser context (`Domain`, `Path`,
/// `Secure`, `HttpOnly`, `SameSite`) are accepted and ignored. Returns null
/// for unparseable lines.
StoredCookie? parseSetCookie(String line, {DateTime? now}) {
  final segments = line.split(';');
  final pair = segments.first;
  final eq = pair.indexOf('=');
  if (eq <= 0) return null;
  final name = pair.substring(0, eq).trim();
  final value = pair.substring(eq + 1).trim();
  if (name.isEmpty) return null;

  DateTime? expiresAt;
  int? maxAgeSeconds;
  for (final segment in segments.skip(1)) {
    final attr = segment.trim();
    final attrEq = attr.indexOf('=');
    final attrName = (attrEq > 0 ? attr.substring(0, attrEq) : attr)
        .toLowerCase();
    final attrValue = attrEq > 0 ? attr.substring(attrEq + 1).trim() : '';
    switch (attrName) {
      case 'max-age':
        maxAgeSeconds = int.tryParse(attrValue);
      case 'expires':
        expiresAt = _parseHttpDate(attrValue);
    }
  }
  if (maxAgeSeconds != null) {
    expiresAt = (now ?? DateTime.now()).add(Duration(seconds: maxAgeSeconds));
  }
  return StoredCookie(name: name, value: value, expiresAt: expiresAt);
}

DateTime? _parseHttpDate(String value) {
  // IMF-fixdate: "Wed, 21 Oct 2026 07:28:00 GMT". DateTime.parse does not
  // accept it, so normalize the fields into ISO-8601.
  final match = RegExp(
    r'^\w{3}, (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$',
  ).firstMatch(value.trim());
  if (match == null) return DateTime.tryParse(value);
  const months = {
    'Jan': '01',
    'Feb': '02',
    'Mar': '03',
    'Apr': '04',
    'May': '05',
    'Jun': '06',
    'Jul': '07',
    'Aug': '08',
    'Sep': '09',
    'Oct': '10',
    'Nov': '11',
    'Dec': '12',
  };
  final month = months[match[2]];
  if (month == null) return null;
  return DateTime.tryParse(
    '${match[3]}-$month-${match[1]}T${match[4]}:${match[5]}:${match[6]}Z',
  );
}
