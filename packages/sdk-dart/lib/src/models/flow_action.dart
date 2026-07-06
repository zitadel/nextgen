import 'json.dart';

/// How the engine handles an action.
/// Spec: `api/openapi/components/flows/step-action.yaml` `kind` enum.
enum ActionKind {
  submit,
  passkey,
  passkeyRegister,
  navigate,
  back,
  unknown;

  static const wireValues = [
    'submit',
    'passkey',
    'passkey_register',
    'navigate',
    'back',
  ];

  static ActionKind fromWire(String? value) => switch (value) {
        'submit' => submit,
        'passkey' => passkey,
        'passkey_register' => passkeyRegister,
        'navigate' => navigate,
        'back' => back,
        _ => unknown,
      };
}

/// A user-invokable action on a step. `name` goes back on the wire as the
/// submit request's `action`.
/// Spec: `api/openapi/components/flows/step-action.yaml`.
class FlowAction {
  const FlowAction({
    required this.name,
    required this.kind,
    this.primary = false,
    this.textKey,
  });

  factory FlowAction.fromJson(Map<String, Object?> json) => FlowAction(
        name: reqString(json, 'name'),
        kind: ActionKind.fromWire(optString(json, 'kind')),
        primary: boolOr(json, 'primary', orElse: false),
        textKey: optString(json, 'text_key'),
      );

  static const specProperties = {'name', 'kind', 'primary', 'text_key'};
  static const specRequired = {'name', 'kind'};

  final String name;
  final ActionKind kind;

  /// Default/primary action hint for visual emphasis; at most one per step.
  final bool primary;

  /// Optional label key override. When omitted the engine derives
  /// `<step>.action.<name>` — see [labelKeyFor].
  final String? textKey;

  /// The localization key for this action's label on [stepName].
  String labelKeyFor(String stepName) => textKey ?? '$stepName.action.$name';
}
