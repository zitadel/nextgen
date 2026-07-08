import 'json.dart';

/// Session lifecycle state.
/// Spec: `api/openapi/endpoints/sessions/session-response.yaml`.
enum SessionState {
  /// Has a user factor but is still gathering authentication factors.
  building,

  /// Has at least one verified authentication factor.
  active,

  /// TTL elapsed.
  expired,

  /// Explicitly revoked via DELETE.
  revoked,
  unknown;

  static const wireValues = ['building', 'active', 'expired', 'revoked'];

  static SessionState fromWire(String? value) => switch (value) {
    'building' => building,
    'active' => active,
    'expired' => expired,
    'revoked' => revoked,
    _ => unknown,
  };
}

/// The durable post-auth primitive: accumulated verified factors plus the
/// assurance levels they currently satisfy. Read-only from the client's
/// perspective — factors flow in through auth_attempts.
/// Spec: `api/openapi/endpoints/sessions/session-response.yaml`.
class Session {
  const Session({
    required this.sessionId,
    required this.projectId,
    required this.state,
    this.userId,
    this.factors = const [],
    this.assuranceLevels = const [],
    this.metadata,
    this.createdAt,
    this.expiresAt,
  });

  factory Session.fromJson(Map<String, Object?> json) {
    final rawFactors = json['factors'];
    final rawLevels = json['assurance_levels'];
    return Session(
      sessionId: reqString(json, 'session_id'),
      projectId: reqString(json, 'project_id'),
      state: SessionState.fromWire(optString(json, 'state')),
      userId: optString(json, 'user_id'),
      factors: rawFactors is List
          ? List.unmodifiable(rawFactors.whereType<Map<String, Object?>>())
          : const [],
      assuranceLevels: rawLevels is List
          ? List.unmodifiable(rawLevels.whereType<String>())
          : const [],
      metadata: optMap(json, 'metadata'),
      createdAt: optDateTime(json, 'created_at'),
      expiresAt: optDateTime(json, 'expires_at'),
    );
  }

  static const specProperties = {
    'session_id',
    'project_id',
    'state',
    'user_id',
    'factors',
    'assurance_levels',
    'metadata',
    'user_agent',
    'created_at',
    'expires_at',
  };
  static const specRequired = {
    'session_id',
    'project_id',
    'state',
    'factors',
    'created_at',
    'expires_at',
  };

  final String sessionId;
  final String projectId;
  final SessionState state;

  /// The authenticated user; null for anonymous sessions.
  final String? userId;

  /// Verified factor event objects (each has at least `verified_at`); kept
  /// as raw maps because the factor shape is method-specific.
  final List<Map<String, Object?>> factors;

  /// Assurance profiles the current factors satisfy. Shrinks as factor
  /// freshness windows expire.
  final List<String> assuranceLevels;

  final Map<String, Object?>? metadata;
  final DateTime? createdAt;
  final DateTime? expiresAt;
}

/// Session plus the bearer token that authorises managing it.
/// Spec: `api/openapi/endpoints/sessions/session-with-token-response.yaml`.
class SessionWithToken {
  const SessionWithToken({required this.session, required this.sessionToken});

  factory SessionWithToken.fromJson(Map<String, Object?> json) =>
      SessionWithToken(
        session: Session.fromJson(
          optMap(json, 'session') ?? const <String, Object?>{},
        ),
        sessionToken: reqString(json, 'session_token'),
      );

  static const specProperties = {'session', 'session_token'};
  static const specRequired = {'session', 'session_token'};

  final Session session;

  /// Supersedes any previously stored token for the same session.
  final String sessionToken;
}
