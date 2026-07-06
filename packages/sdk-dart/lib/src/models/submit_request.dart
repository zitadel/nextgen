/// Response to a pending step challenge (e.g. a WebAuthn ceremony result).
/// Spec: `api/openapi/components/flows/flow-submit-request.yaml`
/// `challenge_response`.
class ChallengeResponse {
  const ChallengeResponse({
    required this.challengeId,
    required this.method,
    this.proof = const {},
  });

  static const specProperties = {'challenge_id', 'method', 'proof'};

  /// The identifier from `step.challenge.challenge_id`.
  final String challengeId;

  /// Which auth method this response is for (e.g. `passkey`).
  final String method;

  /// Method-specific proof payload.
  final Map<String, Object?> proof;

  Map<String, Object?> toJson() => {
        'challenge_id': challengeId,
        'method': method,
        'proof': proof,
      };
}

/// Body of `POST /flow/{id}/submit`.
/// Spec: `api/openapi/components/flows/flow-submit-request.yaml`.
class SubmitRequest {
  const SubmitRequest({
    required this.action,
    this.fields = const {},
    this.gateProofs = const {},
    this.challengeResponse,
    this.ssoProviderId,
    this.sessionToken,
  });

  static const specProperties = {
    'action',
    'fields',
    'gate_proofs',
    'challenge_response',
    'sso_provider_id',
    'session_token',
  };
  static const specRequired = {'action'};

  /// Which action to take: a key from the step's `actions`, or the reserved
  /// value `"sso"` (requires [ssoProviderId]).
  final String action;

  /// User input values keyed by field name. Send only values for fields the
  /// current step declares — carried-over state from earlier steps must not
  /// leak onto the wire.
  final Map<String, Object?> fields;

  /// Gate solutions keyed by gate name from the step's `gates`.
  final Map<String, String> gateProofs;

  /// Required when the step carries a `challenge`.
  final ChallengeResponse? challengeResponse;

  /// Selected provider from `sso_providers[].id`; required when [action]
  /// is `"sso"`.
  final String? ssoProviderId;

  /// Echo of the latest `FlowResponse.sessionToken`, when present.
  final String? sessionToken;

  Map<String, Object?> toJson() => {
        'action': action,
        'fields': fields,
        if (gateProofs.isNotEmpty) 'gate_proofs': gateProofs,
        if (challengeResponse != null)
          'challenge_response': challengeResponse!.toJson(),
        if (ssoProviderId != null) 'sso_provider_id': ssoProviderId,
        if (sessionToken != null) 'session_token': sessionToken,
      };
}
