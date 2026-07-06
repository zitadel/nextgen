import 'package:test/test.dart';
import 'package:zitadel_client/zitadel_client.dart';

void main() {
  group('parseSetCookie', () {
    test('parses name, value, and ignores browser-only attributes', () {
      final cookie = parseSetCookie(
        '_zflow=abc123; Path=/; HttpOnly; Secure; SameSite=Lax',
      );
      expect(cookie, isNotNull);
      expect(cookie!.name, '_zflow');
      expect(cookie.value, 'abc123');
      expect(cookie.expiresAt, isNull);
    });

    test('parses IMF-fixdate Expires (which contains a comma)', () {
      final cookie = parseSetCookie(
        '_zflow=v; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
      );
      expect(cookie!.expiresAt, DateTime.utc(2026, 10, 21, 7, 28));
    });

    test('Max-Age takes precedence over Expires', () {
      final now = DateTime.utc(2026);
      final cookie = parseSetCookie(
        '_zflow=v; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=60',
        now: now,
      );
      expect(cookie!.expiresAt, now.add(const Duration(seconds: 60)));
    });

    test('returns null for unparseable lines', () {
      expect(parseSetCookie('no-equals-sign'), isNull);
      expect(parseSetCookie('=value-without-name'), isNull);
    });
  });

  group('InMemoryCookieStore', () {
    test('round-trips cookies into a Cookie header', () async {
      final store = InMemoryCookieStore();
      await store.storeSetCookies([
        '_zflow=flowstate; Path=/; HttpOnly',
        '__nextgen_session=sess; Path=/; HttpOnly',
      ]);
      expect(
        await store.cookieHeader(),
        '_zflow=flowstate; __nextgen_session=sess',
      );
    });

    test('a later Set-Cookie replaces the stored value', () async {
      final store = InMemoryCookieStore();
      await store.storeSetCookies(['_zflow=first']);
      await store.storeSetCookies(['_zflow=second']);
      expect(await store.cookieHeader(), '_zflow=second');
    });

    test('Max-Age=0 deletes the cookie (server sign-out signal)', () async {
      final store = InMemoryCookieStore();
      await store.storeSetCookies(['__nextgen_session=sess']);
      await store.storeSetCookies(['__nextgen_session=; Max-Age=0']);
      expect(await store.cookieHeader(), isNull);
    });

    test('expired cookies are not replayed', () async {
      var now = DateTime.utc(2026);
      final store = InMemoryCookieStore(clock: () => now);
      await store.storeSetCookies(['_zflow=v; Max-Age=10']);
      expect(await store.cookieHeader(), '_zflow=v');

      now = now.add(const Duration(seconds: 11));
      expect(await store.cookieHeader(), isNull);
    });

    test('clear drops everything', () async {
      final store = InMemoryCookieStore();
      await store.storeSetCookies(['_zflow=v']);
      await store.clear();
      expect(await store.cookieHeader(), isNull);
    });
  });
}
