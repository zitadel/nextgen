import 'flow_action.dart';
import 'flow_field.dart';
import 'flow_gate.dart';
import 'json.dart';

/// What the frontend does on a terminal step.
enum StepComplete {
  /// Navigate to `redirect_uri` immediately (OIDC/SAML done).
  redirect,

  /// Render the step as a success screen (e.g. registration confirmed).
  show,
  unknown;

  static const wireValues = ['redirect', 'show'];

  static StepComplete? fromWire(String? value) => switch (value) {
    null => null,
    'redirect' => redirect,
    'show' => show,
    _ => unknown,
  };
}

/// Step-level localization keys.
/// Spec: `api/openapi/components/flows/step-texts.yaml`.
class StepTexts {
  const StepTexts({this.titleKey, this.descriptionKey});

  factory StepTexts.fromJson(Map<String, Object?> json) => StepTexts(
    titleKey: optString(json, 'title_key'),
    descriptionKey: optString(json, 'description_key'),
  );

  static const specProperties = {'title_key', 'description_key'};

  final String? titleKey;
  final String? descriptionKey;
}

/// An available SSO identity provider.
/// Spec: `api/openapi/components/flows/sso-provider.yaml`.
class SsoProvider {
  const SsoProvider({
    required this.id,
    required this.name,
    required this.template,
  });

  factory SsoProvider.fromJson(Map<String, Object?> json) => SsoProvider(
    id: reqString(json, 'id'),
    name: reqString(json, 'name'),
    template: reqString(json, 'template'),
  );

  static const specProperties = {'id', 'name', 'template'};
  static const specRequired = {'id', 'name', 'template'};

  final String id;

  /// Display name (the one place the server sends display text).
  final String name;

  /// Rendering hint (logo, colors) — e.g. `google`, `entraid`.
  final String template;
}

/// A pending authentication challenge (issued after the user selects a
/// ceremony-based action such as `passkey`). Never present on the initial
/// step.
class FlowChallenge {
  const FlowChallenge({
    required this.method,
    required this.challengeId,
    this.options = const {},
  });

  factory FlowChallenge.fromJson(Map<String, Object?> json) => FlowChallenge(
    method: reqString(json, 'method'),
    challengeId: reqString(json, 'challenge_id'),
    options: optMap(json, 'options') ?? const {},
  );

  static const specProperties = {'method', 'challenge_id', 'options'};
  static const specMethodWireValues = ['passkey', 'passkey_register'];

  /// `passkey` or `passkey_register`; raw string for forward compatibility.
  final String method;

  /// Echoed back in the submit request's `challenge_response`.
  final String challengeId;

  /// Protocol-specific options (WebAuthn request/creation options).
  final Map<String, Object?> options;
}

/// One step of a flow: ordered capability arrays describing what to collect
/// ([fields]), what the user can do ([actions]), and which security gates
/// must be satisfied ([gates]). Ordering comes from the server — render the
/// arrays in order.
/// Spec: `api/openapi/components/flows/flow-step.yaml`.
class FlowStep {
  const FlowStep({
    required this.name,
    this.texts,
    this.error,
    this.complete,
    this.redirectUrl,
    this.fields = const [],
    this.actions = const [],
    this.gates = const {},
    this.ssoProviders = const [],
    this.challenge,
  });

  factory FlowStep.fromJson(Map<String, Object?> json) {
    final rawGates = optMap(json, 'gates') ?? const {};
    return FlowStep(
      name: reqString(json, 'name'),
      texts: optMap(json, 'texts') != null
          ? StepTexts.fromJson(optMap(json, 'texts')!)
          : null,
      error: optString(json, 'error'),
      complete: StepComplete.fromWire(optString(json, 'complete')),
      redirectUrl: optString(json, 'redirect_url'),
      fields: List.unmodifiable(listOf(json, 'fields', FlowField.fromJson)),
      actions: List.unmodifiable(listOf(json, 'actions', FlowAction.fromJson)),
      gates: Map.unmodifiable({
        for (final entry in rawGates.entries)
          if (entry.value is Map<String, Object?>)
            entry.key: FlowGate.fromJson(entry.value! as Map<String, Object?>),
      }),
      ssoProviders: List.unmodifiable(
        listOf(json, 'sso_providers', SsoProvider.fromJson),
      ),
      challenge: optMap(json, 'challenge') != null
          ? FlowChallenge.fromJson(optMap(json, 'challenge')!)
          : null,
    );
  }

  static const specProperties = {
    'name',
    'texts',
    'error',
    'complete',
    'redirect_url',
    'fields',
    'actions',
    'gates',
    'sso_providers',
    'challenge',
  };
  static const specRequired = {'name', 'fields', 'actions', 'gates'};

  /// Step name from the flow definition. Anchors derived text keys
  /// (`<name>.title`, `<name>.field.<field>`, `<name>.action.<action>`).
  final String name;

  final StepTexts? texts;

  /// Error from a previous failed submission. By web-orchestrator
  /// convention a value starting with `error.` is a localization key;
  /// anything else is a raw message.
  final String? error;

  /// Present only on terminal steps.
  final StepComplete? complete;

  /// URL to navigate to (e.g. SSO provider redirect).
  final String? redirectUrl;

  /// Ordered input fields to collect.
  final List<FlowField> fields;

  /// Ordered available user actions.
  final List<FlowAction> actions;

  /// Security gates keyed by gate name. Keys go back on the wire in
  /// `gate_proofs`.
  final Map<String, FlowGate> gates;

  final List<SsoProvider> ssoProviders;

  final FlowChallenge? challenge;

  bool get isTerminal => complete != null;

  /// Whether [error] should be resolved through the locale dictionary.
  bool get errorIsTextKey => error?.startsWith('error.') ?? false;

  /// The step's primary action, or the first action as a fallback, or null
  /// when the step has none.
  FlowAction? get primaryAction {
    for (final action in actions) {
      if (action.primary) return action;
    }
    return actions.isEmpty ? null : actions.first;
  }
}
