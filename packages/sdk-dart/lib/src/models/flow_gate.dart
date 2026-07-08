import 'json.dart';

/// A security challenge that must be satisfied before submission is
/// accepted. The engine may inject gates at runtime based on policy.
/// Spec: `api/openapi/components/flows/gate.yaml`.
class FlowGate {
  const FlowGate({
    required this.kind,
    required this.provider,
    this.config = const {},
  });

  factory FlowGate.fromJson(Map<String, Object?> json) => FlowGate(
    kind: reqString(json, 'kind'),
    provider: reqString(json, 'provider'),
    config: optMap(json, 'config') ?? const {},
  );

  static const specProperties = {'kind', 'provider', 'config'};
  static const specRequired = {'kind', 'provider'};
  static const specKindWireValues = ['captcha'];

  /// Gate category. Only `captcha` is currently defined; kept as a raw
  /// string so new categories degrade to "unsupported" instead of losing
  /// the value.
  final String kind;

  /// Provider identifier within the kind — `altcha`, `turnstile`,
  /// `hcaptcha`, …
  final String provider;

  /// Provider-specific challenge configuration, opaque to the engine.
  final Map<String, Object?> config;
}
