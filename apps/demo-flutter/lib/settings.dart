import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _baseUrlKey = 'demo_base_url';
const _projectIdKey = 'demo_project_id';

/// Where the demo points its SDK by default. Android (emulator) reaches
/// the host machine's localhost via 10.0.2.2; everything else uses plain
/// localhost. Both are overridable under Settings.
String get defaultBaseUrl => defaultTargetPlatform == TargetPlatform.android
    ? 'http://10.0.2.2:8080'
    : 'http://localhost:8080';

class DemoSettings {
  const DemoSettings({required this.baseUrl, required this.projectId});

  factory DemoSettings.load(SharedPreferences prefs) => DemoSettings(
        baseUrl: prefs.getString(_baseUrlKey) ?? defaultBaseUrl,
        projectId: prefs.getString(_projectIdKey) ?? 'proj_demo',
      );

  final String baseUrl;
  final String projectId;

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_baseUrlKey, baseUrl);
    await prefs.setString(_projectIdKey, projectId);
  }
}

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.settings});

  final DemoSettings settings;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _baseUrl = TextEditingController(
    text: widget.settings.baseUrl,
  );
  late final TextEditingController _projectId = TextEditingController(
    text: widget.settings.projectId,
  );

  @override
  void dispose() {
    _baseUrl.dispose();
    _projectId.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final updated = DemoSettings(
      baseUrl: _baseUrl.text.trim(),
      projectId: _projectId.text.trim(),
    );
    await updated.save();
    if (mounted) Navigator.of(context).pop(updated);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          TextField(
            controller: _baseUrl,
            decoration: const InputDecoration(
              labelText: 'API base URL',
              helperText:
                  'Mock/local server for the flow; a credentialed proxy URL '
                  '(https://…/__nextgen) for the full session exchange. '
                  'Android emulator: http://10.0.2.2:8080',
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _projectId,
            decoration: const InputDecoration(
              labelText: 'Project ID',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () {
              // ignore: discarded_futures
              _save();
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
}
