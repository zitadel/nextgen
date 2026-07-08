import 'package:flutter/foundation.dart';
import 'package:zitadel_client/zitadel_client.dart';

import '../gates/altcha_solver.dart';

/// Terminal outcome of a flow, delivered to `onComplete` — the Flutter
/// analog of the web component's `zitadel-flow-complete` event detail.
class FlowCompletion {
  const FlowCompletion({
    required this.behavior,
    required this.response,
    this.redirectUri,
    this.handoffToken,
    this.handoffTokenExpiresAt,
    this.session,
  });

  /// `redirect` → navigate to [redirectUri] (the SDK does not navigate for
  /// you); `show` → the terminal step is a success screen.
  final StepComplete behavior;

  /// The full terminal response, for hosts with custom post-sign-in flows.
  final FlowResponse response;

  final String? redirectUri;

  /// One-time token for `SessionClient.exchange`. Null when the controller
  /// already exchanged it (`autoExchange`) — see [session].
  final String? handoffToken;

  final DateTime? handoffTokenExpiresAt;

  /// The exchanged session when `autoExchange` is on and succeeded.
  final SessionWithToken? session;
}

/// UI state of a running flow.
sealed class FlowUiState {
  const FlowUiState();
}

/// Initial fetch (or resume) in progress.
class FlowLoading extends FlowUiState {
  const FlowLoading();
}

/// A step is on screen. [values] carries collected input across steps —
/// only the current step's declared fields go on the wire at submit.
class FlowStepReady extends FlowUiState {
  const FlowStepReady({
    required this.response,
    required this.values,
    this.submitting = false,
    this.transportError,
  });

  final FlowResponse response;
  final Map<String, String> values;

  /// A submit is in flight; the UI must disable inputs and actions
  /// (double-submit guard).
  final bool submitting;

  /// Message of a failed transport attempt (network error, 5xx). Field
  /// validation errors are NOT this — those come back inside
  /// `response.step.error`.
  final String? transportError;

  FlowStep get step => response.step;
}

/// The flow reached a terminal step.
class FlowCompleted extends FlowUiState {
  const FlowCompleted(this.completion);

  final FlowCompletion completion;
}

/// The flow could not start (or resume). Terminal for this controller;
/// call [FlowController.start] again to retry.
class FlowFailed extends FlowUiState {
  const FlowFailed(this.error);

  final Object error;
}

/// Drives one flow from start to completion — the port of the
/// `<zitadel-login>` orchestrator's state machine
/// (`packages/components/src/orchestrator/zitadel-login.ts`) minus the
/// rendering:
///
/// - seeds form values from each step's `field.value` defaults, letting
///   typed input win on conflict;
/// - submits only the current step's declared fields;
/// - re-reads the flow handle from every response (it rotates on pivots);
/// - unwrapped validation errors surface as `step.error` on a new step
///   state, transport errors as [FlowStepReady.transportError];
/// - optionally solves altcha proof-of-work gates before submitting
///   ([enableAltchaGates], off by default until the server accepts
///   gate proofs);
/// - on a terminal step, optionally exchanges the handoff token
///   ([autoExchange]) and emits a [FlowCompletion].
class FlowController extends ChangeNotifier {
  FlowController({
    required this.project,
    this.purpose = FlowPurpose.login,
    this.resumeFlowId,
    this.autoExchange = false,
    this.enableAltchaGates = false,
    this.onComplete,
    this.onError,
    this.onUnsupportedCapability,
    FlowClient? flowClient,
    SessionClient? sessionClient,
    AltchaSolver? altchaSolver,
  }) : _flows = flowClient ?? FlowClient(project),
       _sessions = sessionClient ?? SessionClient(project),
       _altcha = altchaSolver ?? const AltchaSolver();

  final ZitadelProject project;
  final FlowPurpose purpose;

  /// Existing flow handle to resume via `GET /flow/{id}` instead of
  /// starting a new flow — a reload/restart re-renders the same step
  /// without losing collected state.
  final String? resumeFlowId;

  /// Exchange the terminal `handoff_token` for a session automatically.
  /// Requires the base URL to point at a credentialed proxy.
  final bool autoExchange;

  /// Solve altcha proof-of-work gates and submit their proofs. **Off by
  /// default:** the current server rejects any non-empty `gate_proofs`
  /// with an unsupported error (`internal/domain/flow_state_machine.go`
  /// treats them as reserved) and never emits gates yet. Until server-side
  /// gate verification lands, altcha gates are reported through
  /// [onUnsupportedCapability] like every other provider. Flip this on
  /// against a backend that accepts proofs (e.g. the mock server).
  final bool enableAltchaGates;

  final void Function(FlowCompletion completion)? onComplete;
  final void Function(Object error)? onError;

  /// Invoked when the server sends a capability this SDK version cannot
  /// drive natively yet (passkey actions, captcha gates unless
  /// [enableAltchaGates] covers them, SSO providers). The step still
  /// renders; the capability is omitted.
  final void Function(String capability)? onUnsupportedCapability;

  final FlowClient _flows;
  final SessionClient _sessions;
  final AltchaSolver _altcha;

  FlowUiState _state = const FlowLoading();
  Map<String, String> _values = {};
  final Set<String> _reportedUnsupported = {};
  bool _disposed = false;

  FlowUiState get state => _state;

  /// Starts (or resumes) the flow. Safe to call again after [FlowFailed].
  Future<void> start() async {
    _setState(const FlowLoading());
    try {
      final wire = resumeFlowId != null
          ? await _flows.current(resumeFlowId!)
          : await _flows.create(purpose: purpose);
      await _applyResponse(wire);
    } catch (error) {
      onError?.call(error);
      _setState(FlowFailed(error));
    }
  }

  /// Records typed input. Values persist across steps (e.g. the email for
  /// a signed-in greeting) but never leak onto the wire for steps that
  /// don't declare the field.
  void setValue(String name, String value) {
    _values = {..._values, name: value};
    final current = _state;
    if (current is FlowStepReady) {
      _setState(
        FlowStepReady(
          response: current.response,
          values: _values,
          submitting: current.submitting,
        ),
      );
    }
  }

  /// Submits [actionName] with the current step's field values, solving
  /// any supported gates first.
  Future<void> submitAction(
    String actionName, {
    ChallengeResponse? challengeResponse,
  }) async {
    final current = _state;
    if (current is! FlowStepReady || current.submitting) return;

    _setState(
      FlowStepReady(
        response: current.response,
        values: _values,
        submitting: true,
      ),
    );
    try {
      final step = current.step;
      final fields = <String, Object?>{
        for (final field in step.fields)
          if (_values.containsKey(field.name)) field.name: _values[field.name],
      };
      final gateProofs = await _solveGates(step);
      final wire = await _flows.submit(
        current.response.id,
        SubmitRequest(
          action: actionName,
          fields: fields,
          gateProofs: gateProofs,
          challengeResponse: challengeResponse,
          sessionToken: current.response.sessionToken,
        ),
      );
      await _applyResponse(wire);
    } catch (error) {
      onError?.call(error);
      // Keep the step interactive: show the transport failure inline and
      // let the user retry, mirroring the web orchestrator.
      _setState(
        FlowStepReady(
          response: current.response,
          values: _values,
          transportError: error is ZitadelApiException
              ? error.message
              : error.toString(),
        ),
      );
    }
  }

  /// Submits the step's primary action (Enter-key behavior).
  Future<void> submitPrimary() async {
    final current = _state;
    if (current is! FlowStepReady) return;
    final primary = current.step.primaryAction;
    if (primary != null) {
      await submitAction(primary.name);
    }
  }

  Future<void> _applyResponse(FlowResponse wire) async {
    // Defaults seed every declared field; existing entries (typed input,
    // carry-over from prior steps) win on conflict.
    _values = {
      for (final field in wire.step.fields) field.name: field.initialValue,
      ..._values,
    };
    _reportUnsupportedCapabilities(wire.step);

    final behavior = wire.step.complete;
    if (behavior == null) {
      _setState(FlowStepReady(response: wire, values: _values));
      return;
    }

    SessionWithToken? session;
    var handoffToken = wire.handoffToken;
    if (autoExchange && behavior == StepComplete.show && handoffToken != null) {
      try {
        session = await _sessions.exchange(handoffToken: handoffToken);
        handoffToken = null; // Consumed — single-use.
      } catch (error) {
        onError?.call(error);
        _setState(FlowFailed(error));
        return;
      }
    }
    final completion = FlowCompletion(
      behavior: behavior,
      response: wire,
      redirectUri: wire.redirectUri,
      handoffToken: handoffToken,
      handoffTokenExpiresAt: wire.handoffTokenExpiresAt,
      session: session,
    );
    _setState(FlowCompleted(completion));
    onComplete?.call(completion);
  }

  Future<Map<String, String>> _solveGates(FlowStep step) async {
    final proofs = <String, String>{};
    if (!enableAltchaGates) return proofs;
    for (final entry in step.gates.entries) {
      final gate = entry.value;
      if (gate.kind == 'captcha' && gate.provider == 'altcha') {
        final proof = await _altcha.solve(gate.config);
        if (proof != null) {
          proofs[entry.key] = proof;
        }
      }
    }
    return proofs;
  }

  void _reportUnsupportedCapabilities(FlowStep step) {
    void report(String capability) {
      if (_reportedUnsupported.add(capability)) {
        onUnsupportedCapability?.call(capability);
      }
    }

    for (final action in step.actions) {
      if (action.kind == ActionKind.passkey ||
          action.kind == ActionKind.passkeyRegister) {
        report('action:${action.kind.name}');
      }
    }
    for (final gate in step.gates.values) {
      final solvable =
          enableAltchaGates &&
          gate.kind == 'captcha' &&
          gate.provider == 'altcha';
      if (!solvable) {
        report('gate:${gate.kind}:${gate.provider}');
      }
    }
    if (step.ssoProviders.isNotEmpty) {
      report('sso_providers');
    }
    if (step.challenge != null) {
      report('challenge:${step.challenge!.method}');
    }
  }

  void _setState(FlowUiState next) {
    if (_disposed) return;
    _state = next;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
