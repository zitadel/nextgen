import 'package:flutter/material.dart';
import 'package:zitadel_client/zitadel_client.dart';

import '../controller/flow_controller.dart';
import 'step_renderer.dart';

/// The embedded sign-in/sign-up widget — the Flutter counterpart of the
/// `<zitadel-login>` web component. Drives the server-driven flow via
/// [FlowController] and renders each step natively with Material widgets.
///
/// ```dart
/// ZitadelLogin(
///   project: configureZitadel(
///     projectId: 'proj_123',
///     baseUrl: Uri.parse('https://myapp.example/__nextgen'),
///   ),
///   autoExchange: true,
///   onComplete: (completion) => Navigator.of(context).pop(),
/// )
/// ```
///
/// Callbacks mirror the web component's events: [onStep] ≙
/// `zitadel-flow-step`, [onInput] ≙ `zitadel-flow-input`, [onComplete] ≙
/// `zitadel-flow-complete`, [onError] ≙ `zitadel-flow-error`.
class ZitadelLogin extends StatefulWidget {
  const ZitadelLogin({
    super.key,
    required this.project,
    this.purpose = FlowPurpose.login,
    this.resumeFlowId,
    this.autoExchange = true,
    this.languageCode,
    this.localeOverrides,
    this.onStep,
    this.onInput,
    this.onComplete,
    this.onError,
    this.onUnsupportedCapability,
    this.loadingBuilder,
    this.completedBuilder,
    this.controller,
  });

  final ZitadelProject project;
  final FlowPurpose purpose;

  /// Resume an existing flow instead of starting a new one.
  final String? resumeFlowId;

  /// Exchange the terminal handoff token automatically (default). Turn off
  /// to handle the exchange yourself from [onComplete].
  final bool autoExchange;

  /// BCP 47 tag for label resolution; defaults to the ambient
  /// [Localizations] locale, falling back to English.
  final String? languageCode;

  /// Custom locale dictionaries merged over the built-ins, keyed by
  /// language code.
  final Map<String, Map<String, String>>? localeOverrides;

  final void Function(FlowStep step)? onStep;
  final void Function(String name, String value)? onInput;
  final void Function(FlowCompletion completion)? onComplete;
  final void Function(Object error)? onError;
  final void Function(String capability)? onUnsupportedCapability;

  final WidgetBuilder? loadingBuilder;

  /// Replaces the built-in success screen for `complete: "show"`.
  final Widget Function(BuildContext context, FlowCompletion completion)?
      completedBuilder;

  /// Inject a preconfigured controller (tests, custom clients). When set,
  /// `project`/`purpose`/`resumeFlowId`/`autoExchange` and the callbacks on
  /// this widget are ignored in favor of the controller's own.
  final FlowController? controller;

  @override
  State<ZitadelLogin> createState() => _ZitadelLoginState();
}

class _ZitadelLoginState extends State<ZitadelLogin> {
  late FlowController _controller;
  bool _ownsController = false;

  @override
  void initState() {
    super.initState();
    _controller = widget.controller ?? _buildController();
    _ownsController = widget.controller == null;
    _controller.addListener(_onControllerChanged);
    if (_controller.state is FlowLoading) {
      // Fire-and-forget: state transitions arrive via the listener.
      // ignore: discarded_futures
      _controller.start();
    }
  }

  FlowController _buildController() => FlowController(
        project: widget.project,
        purpose: widget.purpose,
        resumeFlowId: widget.resumeFlowId,
        autoExchange: widget.autoExchange,
        onComplete: widget.onComplete,
        onError: widget.onError,
        onUnsupportedCapability: widget.onUnsupportedCapability,
      );

  void _onControllerChanged() {
    final state = _controller.state;
    if (state is FlowStepReady && !state.submitting) {
      widget.onStep?.call(state.step);
    }
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller.removeListener(_onControllerChanged);
    if (_ownsController) _controller.dispose();
    super.dispose();
  }

  ZitadelLocalizer get _localizer => ZitadelLocalizer.resolve(
        languageCode: widget.languageCode ??
            Localizations.maybeLocaleOf(context)?.toLanguageTag(),
        overrides: widget.localeOverrides,
      );

  @override
  Widget build(BuildContext context) {
    final state = _controller.state;
    final body = switch (state) {
      FlowLoading() => widget.loadingBuilder?.call(context) ??
          const Center(
            child: Padding(
              padding: EdgeInsets.all(48),
              child: CircularProgressIndicator(),
            ),
          ),
      FlowStepReady() => StepRenderer(
          step: state.step,
          values: state.values,
          localizer: _localizer,
          submitting: state.submitting,
          transportError: state.transportError,
          branding: state.response.branding,
          onValueChanged: (name, value) {
            _controller.setValue(name, value);
            widget.onInput?.call(name, value);
          },
          onAction: (action) {
            // ignore: discarded_futures
            _controller.submitAction(action);
          },
        ),
      FlowCompleted() =>
        widget.completedBuilder?.call(context, state.completion) ??
            _CompletedView(completion: state.completion, localizer: _localizer),
      FlowFailed() => _FailedView(
          error: state.error,
          localizer: _localizer,
          onRetry: () {
            // ignore: discarded_futures
            _controller.start();
          },
        ),
    };

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 400),
      child: body,
    );
  }
}

/// Built-in success screen for `complete: "show"`. `redirect` completions
/// render nothing — the host navigates via `onComplete`.
class _CompletedView extends StatelessWidget {
  const _CompletedView({required this.completion, required this.localizer});

  final FlowCompletion completion;
  final ZitadelLocalizer localizer;

  @override
  Widget build(BuildContext context) {
    if (completion.behavior != StepComplete.show) {
      return const SizedBox.shrink();
    }
    final titleKey = completion.response.step.texts?.titleKey ?? 'done.title';
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.check_circle_outline,
          size: 48,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(height: 16),
        Text(
          localizer.t(titleKey),
          style: Theme.of(context).textTheme.headlineSmall,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

class _FailedView extends StatelessWidget {
  const _FailedView({
    required this.error,
    required this.localizer,
    required this.onRetry,
  });

  final Object error;
  final ZitadelLocalizer localizer;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          localizer.t('error.sign_in_server.title'),
          style: Theme.of(context).textTheme.titleMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          localizer.t('error.sign_in_server.body'),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        TextButton(
            onPressed: onRetry, child: Text(localizer.t('submit.continue'))),
      ],
    );
  }
}
