import 'http/cookie_store.dart';
import 'http/io_transport.dart';
import 'http/transport.dart';
import 'storage/token_store.dart';

/// Configured handle for talking to a Zitadel project.
///
/// The Dart analog of `configureZitadel()` in
/// `packages/api/src/runtime/config.ts`, with two deliberate differences:
/// [baseUrl] is required and absolute (a native app has no page origin for
/// a relative proxy path to resolve against), and there is no global
/// singleton — pass the handle to the clients/widgets that need it.
class ZitadelProject {
  ZitadelProject({
    required this.projectId,
    required this.baseUrl,
    ZitadelTransport? transport,
    CookieStore? cookieStore,
    TokenStore? tokenStore,
  })  : transport = transport ?? IoTransport(),
        cookieStore = cookieStore ?? InMemoryCookieStore(),
        tokenStore = tokenStore ?? InMemoryTokenStore() {
    if (!baseUrl.isAbsolute) {
      throw ArgumentError.value(
        baseUrl,
        'baseUrl',
        'must be an absolute URL, e.g. https://myapp.example/__nextgen '
            'or http://localhost:8080',
      );
    }
  }

  /// Public project identifier (safe to ship in the app binary).
  final String projectId;

  /// API origin. Point it at your app's credentialed `/__nextgen` proxy
  /// (the middleware installed by `@zitadel/sdk-next` / `sdk-nuxt`) — the
  /// handoff exchange requires a project service key that must NEVER be
  /// embedded in a client binary; the proxy injects it server-side. A
  /// direct server URL works for the flow itself in development.
  final Uri baseUrl;

  final ZitadelTransport transport;

  /// Holds the `_zflow` flow-state cookie between requests.
  final CookieStore cookieStore;

  /// Holds the `session_token` bearer credential.
  final TokenStore tokenStore;

  /// Resolves an API path against [baseUrl], preserving any path prefix
  /// (e.g. `/__nextgen`) the base URL carries.
  Uri resolveApiPath(String path, [Map<String, String>? query]) {
    final basePath = baseUrl.path.endsWith('/')
        ? baseUrl.path.substring(0, baseUrl.path.length - 1)
        : baseUrl.path;
    return baseUrl.replace(
      path: '$basePath$path',
      queryParameters: (query?.isNotEmpty ?? false) ? query : null,
    );
  }
}

/// Convenience constructor mirroring the JS SDKs' `configureZitadel()`.
ZitadelProject configureZitadel({
  required String projectId,
  required Uri baseUrl,
  ZitadelTransport? transport,
  CookieStore? cookieStore,
  TokenStore? tokenStore,
}) =>
    ZitadelProject(
      projectId: projectId,
      baseUrl: baseUrl,
      transport: transport,
      cookieStore: cookieStore,
      tokenStore: tokenStore,
    );
