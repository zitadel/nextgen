import 'dart:convert';

import 'config.dart';
import 'errors.dart';
import 'http/transport.dart';

/// Shared request pipeline for the flow and session clients: resolves the
/// URL against the project's base URL, replays stored cookies, optionally
/// attaches the bearer session token, ingests `Set-Cookie` responses, and
/// maps non-2xx statuses to [ZitadelApiException].
///
/// The Dart analog of `customFetch` in `packages/api/src/runtime/fetch.ts`.
class ApiExecutor {
  ApiExecutor(this.project);

  final ZitadelProject project;

  Future<Object?> execute({
    required String method,
    required String path,
    Map<String, String>? query,
    Object? jsonBody,
    bool withBearer = false,
  }) async {
    final url = project.resolveApiPath(path, query);
    final headers = <String, String>{};
    final cookieHeader = await project.cookieStore.cookieHeader();
    if (cookieHeader != null) {
      headers['cookie'] = cookieHeader;
    }
    if (withBearer) {
      final token = await project.tokenStore.read();
      if (token != null) {
        headers['authorization'] = 'Bearer $token';
      }
    }

    final response = await project.transport.send(
      ZitadelRequest(
        method: method,
        url: url,
        headers: headers,
        jsonBody: jsonBody,
      ),
    );
    if (response.setCookies.isNotEmpty) {
      await project.cookieStore.storeSetCookies(response.setCookies);
    }

    final decoded = _decode(response.body);
    if (!response.isSuccess) {
      throw ZitadelApiException.fromResponse(
        status: response.status,
        url: url,
        body: decoded,
      );
    }
    return decoded;
  }

  Object? _decode(String body) {
    if (body.isEmpty) return null;
    try {
      return jsonDecode(body);
    } on FormatException {
      return body;
    }
  }
}

/// Formats a [Duration] as an ISO-8601 duration (`PT1H30M`), the wire
/// format of the exchange request's optional `ttl`.
String isoDuration(Duration duration) {
  if (duration.inSeconds <= 0) return 'PT0S';
  final hours = duration.inHours;
  final minutes = duration.inMinutes % 60;
  final seconds = duration.inSeconds % 60;
  final buffer = StringBuffer('PT');
  if (hours > 0) buffer.write('${hours}H');
  if (minutes > 0) buffer.write('${minutes}M');
  if (seconds > 0) buffer.write('${seconds}S');
  return buffer.toString();
}
