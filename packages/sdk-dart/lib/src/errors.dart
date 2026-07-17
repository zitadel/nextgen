/// Error type thrown for non-2xx API responses.
///
/// Mirrors `ApiError` in `packages/api/src/runtime/fetch.ts` plus the spec's
/// standard error envelope in `api/openapi/components/error-details.yaml`
/// (`{ code, message, details? }`). When the response body is not that
/// envelope, [code] and [details] are null and [message] falls back to the
/// HTTP reason.
class ZitadelApiException implements Exception {
  ZitadelApiException({
    required this.status,
    required this.url,
    required this.message,
    this.code,
    this.details,
    this.rawBody,
  });

  /// Builds an exception from a decoded response body, extracting the
  /// error envelope when present.
  factory ZitadelApiException.fromResponse({
    required int status,
    required Uri url,
    Object? body,
  }) {
    if (body is Map<String, Object?>) {
      final code = body['code'];
      final message = body['message'];
      final details = body['details'];
      if (message is String) {
        return ZitadelApiException(
          status: status,
          url: url,
          message: message,
          code: code is String ? code : null,
          details: details is Map<String, Object?> ? details : null,
          rawBody: body,
        );
      }
    }
    return ZitadelApiException(
      status: status,
      url: url,
      message: 'Request to $url failed with status $status.',
      rawBody: body,
    );
  }

  /// HTTP status code of the failed response.
  final int status;

  /// The request URL.
  final Uri url;

  /// Machine-readable error code from the envelope (e.g. `E_VALIDATION`),
  /// when the server returned one.
  final String? code;

  /// Human-readable explanation.
  final String message;

  /// Additional error-specific context from the envelope.
  final Map<String, Object?>? details;

  /// The decoded response body as received, for callers that need shapes
  /// beyond the standard envelope (e.g. the flow submit 400-with-step).
  final Object? rawBody;

  @override
  String toString() =>
      'ZitadelApiException($status${code != null ? ' $code' : ''}: $message)';
}
