import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:zitadel_client/zitadel_client.dart';

const _tokenKey = 'zitadel_session_token';
const _cookiesKey = 'zitadel_flow_cookies';

/// [TokenStore] on the platform keychain/keystore
/// (`flutter_secure_storage`). Use this in real apps so the session
/// survives app restarts without ever touching plain-text storage.
class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() => _storage.read(key: _tokenKey);

  @override
  Future<void> write(String token) =>
      _storage.write(key: _tokenKey, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _tokenKey);
}

/// [CookieStore] persisted to the platform keychain/keystore, so a killed
/// app can resume an in-flight flow (`FlowClient.current(flowId)`) — the
/// `_zflow` cookie IS the flow state.
///
/// Serialized as a JSON map of `name → {value, expires_at?}`. Expiry is
/// enforced on read; `Max-Age=0` deletions are enforced on write, matching
/// [InMemoryCookieStore].
class SecureCookieStore implements CookieStore {
  SecureCookieStore({FlutterSecureStorage? storage, DateTime Function()? clock})
    : _storage = storage ?? const FlutterSecureStorage(),
      _clock = clock ?? DateTime.now;

  final FlutterSecureStorage _storage;
  final DateTime Function() _clock;

  @override
  Future<String?> cookieHeader() async {
    final cookies = await _load();
    if (cookies.isEmpty) return null;
    return cookies.values
        .map((cookie) => '${cookie.name}=${cookie.value}')
        .join('; ');
  }

  @override
  Future<void> storeSetCookies(List<String> setCookies) async {
    final now = _clock();
    final cookies = await _load();
    for (final line in setCookies) {
      final cookie = parseSetCookie(line, now: now);
      if (cookie == null) continue;
      if (cookie.isExpired(now)) {
        cookies.remove(cookie.name);
      } else {
        cookies[cookie.name] = cookie;
      }
    }
    await _save(cookies);
  }

  @override
  Future<void> clear() => _storage.delete(key: _cookiesKey);

  Future<Map<String, StoredCookie>> _load() async {
    final raw = await _storage.read(key: _cookiesKey);
    if (raw == null) return {};
    final now = _clock();
    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, Object?>) return {};
    final cookies = <String, StoredCookie>{};
    for (final entry in decoded.entries) {
      final item = entry.value;
      if (item is! Map<String, Object?>) continue;
      final value = item['value'];
      if (value is! String) continue;
      final expiresRaw = item['expires_at'];
      final cookie = StoredCookie(
        name: entry.key,
        value: value,
        expiresAt: expiresRaw is String ? DateTime.tryParse(expiresRaw) : null,
      );
      if (!cookie.isExpired(now)) {
        cookies[entry.key] = cookie;
      }
    }
    return cookies;
  }

  Future<void> _save(Map<String, StoredCookie> cookies) async {
    if (cookies.isEmpty) {
      await _storage.delete(key: _cookiesKey);
      return;
    }
    await _storage.write(
      key: _cookiesKey,
      value: jsonEncode({
        for (final cookie in cookies.values)
          cookie.name: {
            'value': cookie.value,
            if (cookie.expiresAt != null)
              'expires_at': cookie.expiresAt!.toIso8601String(),
          },
      }),
    );
  }
}
