import 'dart:convert';
import 'dart:io';

import 'transport.dart';

/// Default [ZitadelTransport] backed by `dart:io`'s [HttpClient].
///
/// Chosen over `package:http` because [HttpHeaders] exposes `Set-Cookie`
/// as a `List<String>` — each cookie line intact — which the cookie store
/// requires. Not available on the web platform; web apps should use the
/// JS SDKs instead.
class IoTransport implements ZitadelTransport {
  IoTransport({HttpClient? client, Duration? timeout})
    : _client = client ?? HttpClient(),
      _timeout = timeout ?? const Duration(seconds: 30);

  final HttpClient _client;
  final Duration _timeout;

  @override
  Future<ZitadelResponse> send(ZitadelRequest request) async {
    final ioRequest = await _client
        .openUrl(request.method, request.url)
        .timeout(_timeout);
    // We manage the _zflow cookie through CookieStore explicitly; the
    // HttpClient's own jar must not interfere or duplicate headers.
    ioRequest.followRedirects = false;
    ioRequest.headers.set(HttpHeaders.acceptHeader, 'application/json');
    request.headers.forEach(ioRequest.headers.set);
    if (request.jsonBody != null) {
      ioRequest.headers.contentType = ContentType.json;
      ioRequest.write(jsonEncode(request.jsonBody));
    }
    final ioResponse = await ioRequest.close().timeout(_timeout);
    final body = await utf8.decoder.bind(ioResponse).join();
    return ZitadelResponse(
      status: ioResponse.statusCode,
      body: body,
      setCookies: ioResponse.headers[HttpHeaders.setCookieHeader],
    );
  }

  /// Closes the underlying client. Idle by default; pass `force: true` to
  /// terminate in-flight requests.
  void close({bool force = false}) => _client.close(force: force);
}
