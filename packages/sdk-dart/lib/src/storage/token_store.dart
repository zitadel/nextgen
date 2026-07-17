/// Storage for the `session_token` bearer credential.
///
/// The handoff exchange (`POST /sessions/exchange`) returns a
/// `session_token` in the body that authorises `GET`/`DELETE /sessions/me`.
/// Native clients send it as `Authorization: Bearer` (the middleware
/// explicitly anticipates this for mobile apps) instead of relying on the
/// `__nextgen_session` cookie. Each exchange supersedes the previous token —
/// [write] replaces, never appends.
abstract interface class TokenStore {
  Future<String?> read();

  Future<void> write(String token);

  Future<void> clear();
}

/// Volatile [TokenStore]. `zitadel_flutter` ships a secure persistent
/// implementation on `flutter_secure_storage`; use that in real apps.
class InMemoryTokenStore implements TokenStore {
  String? _token;

  @override
  Future<String?> read() async => _token;

  @override
  Future<void> write(String token) async => _token = token;

  @override
  Future<void> clear() async => _token = null;
}
