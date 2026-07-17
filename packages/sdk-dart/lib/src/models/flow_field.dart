import 'json.dart';

/// Input kind the client should render.
/// Spec: `api/openapi/components/flows/field.yaml` `type` enum.
enum FieldType {
  text,
  email,
  password,
  tel,
  number,
  url,
  date,
  hidden,
  checkbox,
  select,

  /// Forward-compatibility catch-all for enum values this SDK version does
  /// not know. Render as [text].
  unknown;

  static const wireValues = [
    'text',
    'email',
    'password',
    'tel',
    'number',
    'url',
    'date',
    'hidden',
    'checkbox',
    'select',
  ];

  static FieldType fromWire(String? value) => switch (value) {
    'text' => text,
    'email' => email,
    'password' => password,
    'tel' => tel,
    'number' => number,
    'url' => url,
    'date' => date,
    'hidden' => hidden,
    'checkbox' => checkbox,
    'select' => select,
    _ => unknown,
  };
}

/// Semantic format rule from `validation.format`.
enum FieldFormat {
  email,
  dateTime,
  uuid,
  uri,
  unknown;

  static const wireValues = ['email', 'date-time', 'uuid', 'uri'];

  static FieldFormat fromWire(String? value) => switch (value) {
    'email' => email,
    'date-time' => dateTime,
    'uuid' => uuid,
    'uri' => uri,
    _ => unknown,
  };
}

/// Schema-derived input rules — a UX hint to reduce round trips; the server
/// re-validates on submit and is the only authority.
class FieldValidation {
  const FieldValidation({
    this.format,
    this.minLength,
    this.maxLength,
    this.enumValues,
  });

  factory FieldValidation.fromJson(Map<String, Object?> json) {
    final rawEnum = json['enum'];
    return FieldValidation(
      format: json['format'] is String
          ? FieldFormat.fromWire(json['format'] as String)
          : null,
      minLength: optInt(json, 'min_length'),
      maxLength: optInt(json, 'max_length'),
      enumValues: rawEnum is List
          ? List.unmodifiable(rawEnum.whereType<String>())
          : null,
    );
  }

  /// Property names in `field.yaml#/properties/validation`.
  static const specProperties = {'format', 'min_length', 'max_length', 'enum'};

  final FieldFormat? format;
  final int? minLength;
  final int? maxLength;

  /// Closed list of allowed values (`select` options).
  final List<String>? enumValues;
}

/// A data input capability: what the user must provide on this step.
/// Spec: `api/openapi/components/flows/field.yaml`.
class FlowField {
  const FlowField({
    required this.name,
    required this.type,
    required this.textKey,
    this.required = false,
    this.value,
    this.validation,
  });

  factory FlowField.fromJson(Map<String, Object?> json) => FlowField(
    name: reqString(json, 'name'),
    type: FieldType.fromWire(optString(json, 'type')),
    textKey: reqString(json, 'text_key'),
    required: boolOr(json, 'required', orElse: false),
    value: json['value'],
    validation: optMap(json, 'validation') != null
        ? FieldValidation.fromJson(optMap(json, 'validation')!)
        : null,
  );

  static const specProperties = {
    'name',
    'type',
    'text_key',
    'required',
    'value',
    'validation',
  };
  static const specRequired = {'name', 'type', 'text_key'};

  /// Field name; carries the submitted value back to the engine.
  final String name;

  final FieldType type;

  /// Localization key for the label. Resolved client-side.
  final String textKey;

  /// The field MUST be present and non-empty on submit.
  final bool required;

  /// Pre-filled value (e.g. an identifier carried over from a pivot).
  final Object? value;

  final FieldValidation? validation;

  /// [value] when it is a string, else empty — the seed for form state,
  /// mirroring `collectInitialValues` in the web orchestrator.
  String get initialValue => value is String ? value! as String : '';
}
