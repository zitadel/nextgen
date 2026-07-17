import 'api_executor.dart';
import 'config.dart';
import 'errors.dart';
import 'models/session.dart';

/// Client for the session API:
///
/// - `POST   /sessions/exchange` — [exchange]
/// - `GET    /sessions/me`       — [me]
/// - `DELETE /sessions/me`       — [revoke]
///
/// After [exchange], the returned `session_token` is written to the
/// project's [ZitadelProject.tokenStore] and sent as `Authorization:
/// Bearer` on subsequent session calls — native clients authenticate with
/// the bearer token rather than the `__nextgen_session` cookie.
class SessionClient {
  SessionClient(this.project) : _executor = ApiExecutor(project);

  final ZitadelProject project;
  final ApiExecutor _executor;

  /// Exchanges a terminal flow's one-time `handoff_token` for a session.
  ///
  /// The upstream endpoint requires a project service key. When the
  /// configured base URL points at a credentialed proxy (the documented
  /// setup), the proxy injects it; a 401 here almost always means the base
  /// URL points directly at the server instead — the thrown error says so.
  Future<SessionWithToken> exchange({
    required String handoffToken,
    Duration? ttl,
  }) async {
    final Object? body;
    try {
      body = await _executor.execute(
        method: 'POST',
        path: '/sessions/exchange',
        query: {'project_id': project.projectId},
        jsonBody: {
          'handoff_token': handoffToken,
          if (ttl != null) 'ttl': isoDuration(ttl),
        },
      );
    } on ZitadelApiException catch (error) {
      if (error.status == 401) {
        throw ZitadelApiException(
          status: error.status,
          url: error.url,
          code: error.code,
          details: error.details,
          rawBody: error.rawBody,
          message:
              '${error.message} — POST /sessions/exchange requires a project '
              'service key. Point baseUrl at your app\'s credentialed proxy '
              '(e.g. https://myapp.example/__nextgen); the key must never '
              'ship inside a client binary.',
        );
      }
      rethrow;
    }
    if (body is! Map<String, Object?>) {
      throw FormatException(
        'Expected a session response object, got ${body.runtimeType}.',
      );
    }
    final result = SessionWithToken.fromJson(body);
    // The new token supersedes any previously issued one for this session;
    // the spec requires clients to replace their stored token here.
    await project.tokenStore.write(result.sessionToken);
    return result;
  }

  /// Reads the current session's state, factors, and assurance levels.
  Future<Session> me() async {
    final body = await _executor.execute(
      method: 'GET',
      path: '/sessions/me',
      withBearer: true,
    );
    if (body is! Map<String, Object?>) {
      throw FormatException(
        'Expected a session object, got ${body.runtimeType}.',
      );
    }
    return Session.fromJson(body);
  }

  /// Revokes the current session and clears the stored token. Statuses
  /// that mean "already gone" (401/404/410) also clear the token and
  /// return normally — signing out twice is not an error.
  Future<void> revoke() async {
    try {
      await _executor.execute(
        method: 'DELETE',
        path: '/sessions/me',
        withBearer: true,
      );
    } on ZitadelApiException catch (error) {
      if (error.status != 401 && error.status != 404 && error.status != 410) {
        rethrow;
      }
    } finally {
      await project.tokenStore.clear();
    }
  }
}
