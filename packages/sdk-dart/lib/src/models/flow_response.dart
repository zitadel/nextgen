import 'flow_step.dart';
import 'json.dart';

/// Layout preset selector in the resolved branding.
enum BrandingLayout {
  centered,
  split,
  unknown;

  static const wireValues = ['centered', 'split'];

  static BrandingLayout fromWire(String? value) => switch (value) {
    'split' => split,
    'centered' || null => centered,
    _ => unknown,
  };
}

/// Resolved branding, inherited app → team → project at flow creation.
/// The `liquid_template` property is web-renderer-only and deliberately not
/// modelled here — native renderers derive layout from the capability
/// arrays and the visual hints below.
/// Spec: `api/openapi/components/flows/branding.yaml`.
class FlowBranding {
  const FlowBranding({
    this.layout = BrandingLayout.centered,
    this.logoUrl,
    this.fontUrl,
    this.heroUrl,
  });

  factory FlowBranding.fromJson(Map<String, Object?> json) => FlowBranding(
    layout: BrandingLayout.fromWire(optString(json, 'layout')),
    logoUrl: optString(json, 'logo_url'),
    fontUrl: optString(json, 'font_url'),
    heroUrl: optString(json, 'hero_url'),
  );

  /// Property names in `branding.yaml`. Includes `liquid_template`, which
  /// this SDK intentionally ignores (see class doc) — the spec-lock test
  /// checks the spec side, not that every property is modelled.
  static const specProperties = {
    'layout',
    'liquid_template',
    'logo_url',
    'font_url',
    'hero_url',
  };

  final BrandingLayout layout;
  final String? logoUrl;
  final String? fontUrl;
  final String? heroUrl;
}

/// Response of `POST /flow`, `GET /flow/{id}` and `POST /flow/{id}/submit`.
/// Spec: `api/openapi/components/flows/flow-response.yaml`.
class FlowResponse {
  const FlowResponse({
    required this.id,
    required this.sessionId,
    required this.step,
    this.sessionToken,
    this.branding,
    this.redirectUri,
    this.handoffToken,
    this.handoffTokenExpiresAt,
  });

  factory FlowResponse.fromJson(Map<String, Object?> json) => FlowResponse(
    id: reqString(json, 'id'),
    sessionId: reqString(json, 'session_id'),
    step: FlowStep.fromJson(
      optMap(json, 'step') ?? const <String, Object?>{'name': ''},
    ),
    sessionToken: optString(json, 'session_token'),
    branding: optMap(json, 'branding') != null
        ? FlowBranding.fromJson(optMap(json, 'branding')!)
        : null,
    redirectUri: optString(json, 'redirect_uri'),
    handoffToken: optString(json, 'handoff_token'),
    handoffTokenExpiresAt: optDateTime(json, 'handoff_token_expires_at'),
  );

  static const specProperties = {
    'id',
    'session_id',
    'session_token',
    'step',
    'branding',
    'redirect_uri',
    'handoff_token',
    'handoff_token_expires_at',
  };
  static const specRequired = {'id', 'session_id', 'step'};

  /// Flow handle for subsequent submit/event calls. May change between
  /// responses on a flow pivot or pop — always use the latest response's
  /// value, never a cached one.
  final String id;

  /// Underlying session ID, stable across all stacked flows.
  final String sessionId;

  /// Reserved for future rotation; the sealed `_zflow` cookie carries the
  /// flow state today. Echo it back on submit when present.
  final String? sessionToken;

  final FlowStep step;

  final FlowBranding? branding;

  /// Present when `step.complete` is `redirect`.
  final String? redirectUri;

  /// Short-lived, audience-bound token produced on flow completion.
  /// Exchange it via `SessionClient.exchange`. Only present when
  /// `step.complete` is set.
  final String? handoffToken;

  final DateTime? handoffTokenExpiresAt;
}
