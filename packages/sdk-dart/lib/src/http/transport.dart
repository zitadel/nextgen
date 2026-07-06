/// Minimal HTTP abstraction the SDK is built on.
///
/// This interface exists (instead of using `package:http` directly) because
/// the flow API's state rides on cookies and `package:http` folds repeated
/// `Set-Cookie` headers into one comma-joined string — lossy, since cookie
/// `Expires` attributes contain commas. Implementations must surface each
/// `Set-Cookie` line individually via [ZitadelResponse.setCookies].
///
/// The default implementation is `IoTransport` (dart:io). Tests use fakes.
library;

/// An outgoing API request.
class ZitadelRequest {
  ZitadelRequest({
    required this.method,
    required this.url,
    Map<String, String>? headers,
    this.jsonBody,
  }) : headers = {...?headers};

  /// HTTP method, upper-case (`GET`, `POST`, `DELETE`).
  final String method;

  final Uri url;

  /// Request headers. `Content-Type: application/json` is set by the
  /// transport when [jsonBody] is present.
  final Map<String, String> headers;

  /// JSON-encodable request body, or null for bodiless requests.
  final Object? jsonBody;
}

/// A completed API response.
class ZitadelResponse {
  ZitadelResponse({
    required this.status,
    required this.body,
    List<String>? setCookies,
  }) : setCookies = List.unmodifiable(setCookies ?? const <String>[]);

  final int status;

  /// Raw response body text (may be empty, e.g. for 204).
  final String body;

  /// Each `Set-Cookie` header as its own string, order preserved.
  final List<String> setCookies;

  bool get isSuccess => status >= 200 && status < 300;
}

/// Sends requests. Implementations must not throw on non-2xx statuses —
/// error mapping happens in the API client layer, which needs the body.
abstract interface class ZitadelTransport {
  Future<ZitadelResponse> send(ZitadelRequest request);
}
