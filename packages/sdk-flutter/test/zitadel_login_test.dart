import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zitadel_flutter/zitadel_flutter.dart';

import 'fake_transport.dart';

Widget app(Widget child) => MaterialApp(
      home: Scaffold(body: Center(child: SingleChildScrollView(child: child))),
    );

void main() {
  testWidgets('renders fields in server order with localized labels',
      (tester) async {
    final transport = FakeTransport([jsonResponse(201, identifierStepBody())]);
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'en',
    )));
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsWidgets); // title + primary action
    expect(find.text('Work email'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);

    final emailY = tester
        .getTopLeft(
            find.byKey(const ValueKey('zitadel-input-identifier-email')))
        .dy;
    final passwordY = tester
        .getTopLeft(
            find.byKey(const ValueKey('zitadel-input-identifier-password')))
        .dy;
    expect(emailY, lessThan(passwordY),
        reason: 'server order (email before password) must be preserved');
  });

  testWidgets('labels resolve through the requested locale', (tester) async {
    final transport = FakeTransport([jsonResponse(201, identifierStepBody())]);
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'de',
    )));
    await tester.pumpAndSettle();

    expect(find.text('Anmelden'), findsWidgets);
    expect(find.text('E-Mail'), findsOneWidget);
  });

  testWidgets('typing and tapping the primary action submits the fields',
      (tester) async {
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(200, doneStepBody()),
      jsonResponse(200, exchangeBody()),
    ]);
    final completions = <FlowCompletion>[];
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'en',
      onComplete: completions.add,
    )));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('zitadel-input-identifier-email')),
      'alice@acme.com',
    );
    await tester.enterText(
      find.byKey(const ValueKey('zitadel-input-identifier-password')),
      'hunter22',
    );
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    final submit = transport.requests[1].jsonBody! as Map<String, Object?>;
    expect(submit['fields'], {
      'email': 'alice@acme.com',
      'password': 'hunter22',
    });
    // autoExchange (default) traded the handoff token for a session and
    // the widget landed on the success screen.
    expect(completions.single.session?.sessionToken, 'stok_1');
    expect(find.text("You're signed in as"), findsOneWidget);
  });

  testWidgets('a step error renders as a localized banner', (tester) async {
    final transport = FakeTransport([
      jsonResponse(
        201,
        identifierStepBody(error: 'error.invalid_credentials'),
      ),
    ]);
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'en',
    )));
    await tester.pumpAndSettle();

    expect(find.text('Wrong email or password.'), findsOneWidget);
  });

  testWidgets('a raw (non-key) step error renders verbatim', (tester) async {
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody(error: 'Backend says no.')),
    ]);
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'en',
    )));
    await tester.pumpAndSettle();

    expect(find.text('Backend says no.'), findsOneWidget);
  });

  testWidgets('secondary actions render as text buttons and submit their name',
      (tester) async {
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(200, doneStepBody()),
      jsonResponse(200, exchangeBody()),
    ]);
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'en',
    )));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Sign up'));
    await tester.pumpAndSettle();

    final submit = transport.requests[1].jsonBody! as Map<String, Object?>;
    expect(submit['action'], 'register');
  });

  testWidgets('failed start renders the retry view and retry restarts',
      (tester) async {
    final transport = FakeTransport([
      jsonResponse(503, {'code': 'E_UNAVAILABLE', 'message': 'down'}),
      jsonResponse(201, identifierStepBody()),
    ]);
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'en',
    )));
    await tester.pumpAndSettle();

    expect(
      find.text("We couldn't complete your sign in."),
      findsOneWidget,
    );

    await tester.tap(find.byType(TextButton));
    await tester.pumpAndSettle();

    expect(find.text('Work email'), findsOneWidget);
  });

  testWidgets('onStep and onInput callbacks fire', (tester) async {
    final steps = <String>[];
    final inputs = <String>[];
    final transport = FakeTransport([jsonResponse(201, identifierStepBody())]);
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'en',
      onStep: (step) => steps.add(step.name),
      onInput: (name, value) => inputs.add('$name=$value'),
    )));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('zitadel-input-identifier-email')),
      'a@b.c',
    );

    expect(steps, contains('identifier'));
    expect(inputs, contains('email=a@b.c'));
  });

  testWidgets('checkbox and select fields render and submit values',
      (tester) async {
    final body = identifierStepBody();
    (body['step']! as Map<String, Object?>)['fields'] = [
      {
        'name': 'terms',
        'type': 'checkbox',
        'text_key': 'register.field.terms',
      },
      {
        'name': 'country',
        'type': 'select',
        'text_key': 'register.field.country',
        'validation': {
          'enum': ['CH', 'DE'],
        },
      },
    ];
    final transport = FakeTransport([
      jsonResponse(201, body),
      jsonResponse(200, doneStepBody()),
      jsonResponse(200, exchangeBody()),
    ]);
    await tester.pumpWidget(app(ZitadelLogin(
      project: projectWith(transport),
      languageCode: 'en',
    )));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CH').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    final submit = transport.requests[1].jsonBody! as Map<String, Object?>;
    expect(submit['fields'], {'terms': 'true', 'country': 'CH'});
  });
}
