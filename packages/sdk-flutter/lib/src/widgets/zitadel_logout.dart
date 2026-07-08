import 'package:flutter/material.dart';
import 'package:zitadel_client/zitadel_client.dart';

/// Sign-out button — the Flutter counterpart of the `<zitadel-logout>` web
/// component. Calls `DELETE /sessions/me` (clearing the stored session
/// token) and then [onSignedOut].
class ZitadelLogout extends StatefulWidget {
  const ZitadelLogout({
    super.key,
    required this.project,
    this.onSignedOut,
    this.onError,
    this.child,
    this.languageCode,
    this.sessionClient,
  });

  final ZitadelProject project;

  /// ≙ the web `zitadel-signout` event.
  final VoidCallback? onSignedOut;

  final void Function(Object error)? onError;

  /// Custom button content; defaults to the localized "Sign out" label.
  final Widget? child;

  final String? languageCode;

  /// Test seam; defaults to a client over [project].
  final SessionClient? sessionClient;

  @override
  State<ZitadelLogout> createState() => _ZitadelLogoutState();
}

class _ZitadelLogoutState extends State<ZitadelLogout> {
  late final SessionClient _client =
      widget.sessionClient ?? SessionClient(widget.project);
  bool _busy = false;

  Future<void> _signOut() async {
    setState(() => _busy = true);
    try {
      await _client.revoke();
      widget.onSignedOut?.call();
    } catch (error) {
      widget.onError?.call(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizer = ZitadelLocalizer.resolve(
      languageCode: widget.languageCode,
    );
    return OutlinedButton(
      onPressed: _busy
          ? null
          : () {
              // ignore: discarded_futures
              _signOut();
            },
      child: widget.child ?? Text(localizer.t('signed-in.logout')),
    );
  }
}
