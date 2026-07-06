import 'package:demo_flutter/main.dart';
import 'package:demo_flutter/settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zitadel_flutter/zitadel_flutter.dart';

void main() {
  testWidgets('boots to the signed-out home screen', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const DemoApp());
    await tester.pumpAndSettle();

    expect(find.text('Not signed in'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Create account'), findsOneWidget);
  });

  testWidgets('settings screen edits and returns the configuration',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const DemoApp());
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.settings));
    await tester.pumpAndSettle();

    expect(find.text('API base URL'), findsOneWidget);
    expect(find.text('Project ID'), findsOneWidget);
  });

  test('settings defaults are sane', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final settings = DemoSettings.load(prefs);
    expect(Uri.parse(settings.baseUrl).isAbsolute, isTrue);
    expect(settings.projectId, isNotEmpty);
  });

  test('the demo project handle builds from settings', () {
    final project = configureZitadel(
      projectId: 'proj_demo',
      baseUrl: Uri.parse('http://localhost:8080'),
    );
    expect(project.resolveApiPath('/flow').toString(),
        'http://localhost:8080/flow');
  });
}
