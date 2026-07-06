import 'package:flutter/material.dart';
import 'package:zitadel_client/zitadel_client.dart';

import 'zitadel_logout.dart';

/// Post-sign-in "signed in as" card — the Flutter counterpart of the
/// `<zitadel-session>` web component. Loads `GET /sessions/me` with the
/// stored bearer token and renders the session identity, with a sign-out
/// action wired to `DELETE /sessions/me`.
///
/// Pass [builder] to fully control rendering while reusing the load logic.
class ZitadelSession extends StatefulWidget {
  const ZitadelSession({
    super.key,
    required this.project,
    this.onSignedOut,
    this.builder,
    this.languageCode,
    this.sessionClient,
  });

  final ZitadelProject project;

  /// Invoked after a successful sign-out — ≙ the web `zitadel-signout`
  /// event.
  final VoidCallback? onSignedOut;

  final Widget Function(BuildContext context, AsyncSnapshot<Session> session)?
      builder;

  final String? languageCode;

  /// Test seam; defaults to a client over [project].
  final SessionClient? sessionClient;

  @override
  State<ZitadelSession> createState() => _ZitadelSessionState();
}

class _ZitadelSessionState extends State<ZitadelSession> {
  late final SessionClient _client =
      widget.sessionClient ?? SessionClient(widget.project);
  late Future<Session> _sessionFuture = _client.me();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Session>(
      future: _sessionFuture,
      builder: (context, snapshot) {
        if (widget.builder != null) {
          return widget.builder!(context, snapshot);
        }
        final localizer =
            ZitadelLocalizer.resolve(languageCode: widget.languageCode);
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError || !snapshot.hasData) {
          return Text(localizer.t('error.sign_in_server.title'));
        }
        final session = snapshot.data!;
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  localizer.t('done.title'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Text(session.userId ?? session.sessionId),
                Text(
                  session.state.name,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                ZitadelLogout(
                  project: widget.project,
                  onSignedOut: () {
                    // Refresh so a rebuilt card reflects the revocation.
                    setState(() => _sessionFuture = _client.me());
                    widget.onSignedOut?.call();
                  },
                  sessionClient: _client,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
