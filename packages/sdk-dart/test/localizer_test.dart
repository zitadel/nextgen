import 'package:test/test.dart';
import 'package:zitadel_client/zitadel_client.dart';

void main() {
  test('resolves built-in locales by primary subtag', () {
    expect(
      ZitadelLocalizer.resolve(languageCode: 'de').t('identifier.title'),
      'Anmelden',
    );
    expect(
      ZitadelLocalizer.resolve(languageCode: 'de-CH').t('identifier.title'),
      'Anmelden',
    );
    expect(
      ZitadelLocalizer.resolve(languageCode: 'it').t('identifier.title'),
      'Accedi',
    );
  });

  test('unknown languages fall back to English', () {
    final localizer = ZitadelLocalizer.resolve(languageCode: 'xx');
    expect(localizer.languageCode, 'en');
    expect(localizer.t('identifier.title'), 'Sign in');
  });

  test('missing keys fall through to the raw key (spec behavior)', () {
    final localizer = ZitadelLocalizer.resolve();
    expect(
      localizer.t('identifier.field.department_code'),
      'identifier.field.department_code',
    );
    expect(localizer.contains('identifier.field.department_code'), isFalse);
  });

  test('overrides win over built-in entries, per key', () {
    final localizer = ZitadelLocalizer.resolve(
      languageCode: 'en',
      overrides: {
        'en': {'identifier.title': 'Welcome to ACME'},
      },
    );
    expect(localizer.t('identifier.title'), 'Welcome to ACME');
    // Non-overridden keys keep the built-in copy.
    expect(localizer.t('identifier.field.email'), 'Work email');
  });

  test('interpolates {{name}} placeholders', () {
    final localizer = ZitadelLocalizer.resolve(
      overrides: {
        'en': {'greeting': 'Hi, {{displayName}}!'},
      },
    );
    expect(localizer.t('greeting', {'displayName': 'Alice'}), 'Hi, Alice!');
  });

  test('all built-in dictionaries carry the same key set', () {
    final english = builtinLocales['en']!.keys.toSet();
    for (final entry in builtinLocales.entries) {
      expect(
        entry.value.keys.toSet(),
        english,
        reason: 'locale "${entry.key}" diverges from en',
      );
    }
  });
}
