/// Tolerant JSON accessors shared by the hand-written models.
///
/// Posture matches the generated TS client: unknown keys are ignored,
/// wrong-typed optionals decode as null, and unknown enum strings map to an
/// `unknown` variant rather than throwing — the SDK must not break when the
/// pre-release server adds fields.
library;

String? optString(Map<String, Object?> json, String key) {
  final value = json[key];
  return value is String ? value : null;
}

String reqString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Expected string "$key", got ${value.runtimeType}.');
}

bool boolOr(Map<String, Object?> json, String key, {required bool orElse}) {
  final value = json[key];
  return value is bool ? value : orElse;
}

int? optInt(Map<String, Object?> json, String key) {
  final value = json[key];
  return value is int ? value : null;
}

Map<String, Object?>? optMap(Map<String, Object?> json, String key) {
  final value = json[key];
  return value is Map<String, Object?> ? value : null;
}

List<T> listOf<T>(
  Map<String, Object?> json,
  String key,
  T Function(Map<String, Object?>) decode,
) {
  final value = json[key];
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map<String, Object?>) decode(item),
  ];
}

DateTime? optDateTime(Map<String, Object?> json, String key) {
  final value = json[key];
  return value is String ? DateTime.tryParse(value) : null;
}
