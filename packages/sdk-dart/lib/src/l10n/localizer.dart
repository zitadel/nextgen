import 'de.dart' as l10n_de;
import 'en.dart' as l10n_en;
import 'it.dart' as l10n_it;

/// Built-in locale dictionaries keyed by language code. Mirrors
/// `builtinLocales` in `packages/components/src/orchestrator/locales/`.
const Map<String, Map<String, String>> builtinLocales = {
  'en': l10n_en.en,
  'de': l10n_de.de,
  'it': l10n_it.it,
};

/// Resolves server-sent `text_key`s to display strings — the Dart analog of
/// the web orchestrator's `| t` Liquid filter.
///
/// The server never sends display text, only semantic keys following the
/// `<step>.<scope>.<name>` convention. Missing keys fall back to the raw
/// key (spec behavior — useful for debugging and custom schema fields).
class ZitadelLocalizer {
  ZitadelLocalizer._(this.languageCode, this._dictionary);

  /// Resolves a dictionary for [languageCode] (a BCP 47 tag such as `de`
  /// or `de-CH`; the primary subtag is what's matched). Unknown languages
  /// fall back to English. [overrides] merge over the built-in dictionary
  /// per key, so partial customization is possible.
  factory ZitadelLocalizer.resolve({
    String? languageCode,
    Map<String, Map<String, String>>? overrides,
  }) {
    final primary =
        (languageCode ?? 'en').split(RegExp('[-_]')).first.toLowerCase();
    final base = builtinLocales[primary] ?? l10n_en.en;
    final custom = overrides?[primary] ?? overrides?[languageCode];
    return ZitadelLocalizer._(
      builtinLocales.containsKey(primary) || custom != null ? primary : 'en',
      custom == null ? base : {...base, ...custom},
    );
  }

  /// The resolved primary language subtag.
  final String languageCode;
  final Map<String, String> _dictionary;

  /// Looks up [key], returning the raw key when absent. When [args] is
  /// given, `{{name}}` placeholders in the resolved string are replaced —
  /// the same basic interpolation the web `| t` filter supports.
  String t(String key, [Map<String, String>? args]) {
    var resolved = _dictionary[key] ?? key;
    if (args != null) {
      args.forEach((name, value) {
        resolved = resolved.replaceAll('{{$name}}', value);
      });
    }
    return resolved;
  }

  /// Whether the dictionary has an entry for [key].
  bool contains(String key) => _dictionary.containsKey(key);
}
