import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zitadel_flutter/zitadel_flutter.dart';

import 'settings.dart';

/// Reference app for the Zitadel NextGen Flutter SDK — the Flutter
/// counterpart of `apps/demo-next`.
///
/// Three run modes (configure under Settings):
/// - mock server:   `corepack pnpm --filter @zitadel/mock-zitadel dev`
///   (defaults to http://localhost:8080; from the Android emulator use
///   http://10.0.2.2:8080)
/// - local Zitadel: `npx @zitadel/cli@alpha start`
/// - deployed proxy: your app's `/__nextgen` URL — required for the
///   handoff→session exchange to succeed, since it injects the project
///   service key.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DemoApp());
}

class DemoApp extends StatefulWidget {
  const DemoApp({super.key});

  @override
  State<DemoApp> createState() => _DemoAppState();
}

class _DemoAppState extends State<DemoApp> {
  DemoSettings? _settings;
  ZitadelProject? _project;

  @override
  void initState() {
    super.initState();
    // ignore: discarded_futures
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    _applySettings(DemoSettings.load(prefs));
  }

  void _applySettings(DemoSettings settings) {
    setState(() {
      _settings = settings;
      _project = configureZitadel(
        projectId: settings.projectId,
        baseUrl: Uri.parse(settings.baseUrl),
        // Secure stores persist the session across app restarts on
        // device/emulator targets; fall back to in-memory stores where the
        // platform plugin is unavailable (e.g. desktop dev without keyring).
        tokenStore: _secureStorageSupported ? SecureTokenStore() : null,
        cookieStore: _secureStorageSupported ? SecureCookieStore() : null,
      );
    });
  }

  bool get _secureStorageSupported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.macOS);

  @override
  Widget build(BuildContext context) {
    final settings = _settings;
    final project = _project;
    return MaterialApp(
      title: 'Zitadel Demo',
      theme: ThemeData(colorSchemeSeed: Colors.indigo),
      home: settings == null || project == null
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : HomeScreen(
              project: project,
              settings: settings,
              onSettingsChanged: _applySettings,
            ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.project,
    required this.settings,
    required this.onSettingsChanged,
  });

  final ZitadelProject project;
  final DemoSettings settings;
  final ValueChanged<DemoSettings> onSettingsChanged;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _signedIn = false;

  Future<void> _openLogin(FlowPurpose purpose) async {
    final completed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => LoginScreen(project: widget.project, purpose: purpose),
      ),
    );
    if (completed == true && mounted) {
      setState(() => _signedIn = true);
    }
  }

  Future<void> _openSettings() async {
    final updated = await Navigator.of(context).push<DemoSettings>(
      MaterialPageRoute(
        builder: (_) => SettingsScreen(settings: widget.settings),
      ),
    );
    if (updated != null) {
      setState(() => _signedIn = false);
      widget.onSettingsChanged(updated);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Zitadel Demo'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () {
              // ignore: discarded_futures
              _openSettings();
            },
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _signedIn
              ? ZitadelSession(
                  project: widget.project,
                  onSignedOut: () => setState(() => _signedIn = false),
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Not signed in',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () {
                        // ignore: discarded_futures
                        _openLogin(FlowPurpose.login);
                      },
                      child: const Text('Sign in'),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () {
                        // ignore: discarded_futures
                        _openLogin(FlowPurpose.register);
                      },
                      child: const Text('Create account'),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key, required this.project, required this.purpose});

  final ZitadelProject project;
  final FlowPurpose purpose;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ZitadelLogin(
            project: project,
            purpose: purpose,
            autoExchange: true,
            onComplete: (completion) {
              // `show` with autoExchange means the session token is
              // established; pop back to Home which reads /sessions/me.
              Navigator.of(context).pop(true);
            },
            onError: (error) => debugPrint('[demo] flow error: $error'),
            onUnsupportedCapability: (capability) =>
                debugPrint('[demo] unsupported capability: $capability'),
          ),
        ),
      ),
    );
  }
}
