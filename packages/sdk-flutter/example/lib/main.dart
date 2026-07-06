import 'package:flutter/material.dart';
import 'package:zitadel_flutter/zitadel_flutter.dart';

/// Minimal zitadel_flutter example: a sign-in page that prints the
/// session on completion.
///
/// Point [baseUrl] at your app's credentialed proxy (production) or a
/// local Zitadel/mock server (development; use http://10.0.2.2:8080 from
/// the Android emulator). See apps/demo-flutter in the zitadel/nextgen
/// repo for a full app with session display and sign-out.
void main() {
  final project = configureZitadel(
    projectId: 'proj_example',
    baseUrl: Uri.parse('http://localhost:8080'),
    tokenStore: SecureTokenStore(),
    cookieStore: SecureCookieStore(),
  );
  runApp(ExampleApp(project: project));
}

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key, required this.project});

  final ZitadelProject project;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Zitadel Example',
      home: Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ZitadelLogin(
              project: project,
              onComplete: (completion) {
                debugPrint(
                  'Signed in: session ${completion.session?.session.sessionId}',
                );
              },
              onError: (error) => debugPrint('Flow error: $error'),
            ),
          ),
        ),
      ),
    );
  }
}
