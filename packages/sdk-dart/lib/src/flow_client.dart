import 'api_executor.dart';
import 'config.dart';
import 'errors.dart';
import 'models/flow_purpose.dart';
import 'models/flow_response.dart';
import 'models/submit_request.dart';

/// Client for the flow API — the Dart port of
/// `packages/components/src/orchestrator/api-client.ts`.
///
/// - `POST /flow`             — [create]
/// - `POST /flow/{id}/submit` — [submit]
/// - `GET  /flow/{id}`        — [current]
///
/// Flow state rides the `_zflow` cookie, which the project's
/// [ZitadelProject.cookieStore] captures and replays automatically.
class FlowClient {
  FlowClient(this.project) : _executor = ApiExecutor(project);

  final ZitadelProject project;
  final ApiExecutor _executor;

  /// Starts a new flow and returns its first step. `POST /flow` is a
  /// public endpoint (`security: []`).
  Future<FlowResponse> create({
    FlowPurpose purpose = FlowPurpose.login,
    String? flowDefinitionName,
    String? sessionId,
    String? authRequestId,
    Uri? redirectUri,
    bool dryRun = false,
  }) async {
    final body = await _executor.execute(
      method: 'POST',
      path: '/flow',
      jsonBody: {
        'project_id': project.projectId,
        'purpose': purpose.wire,
        if (flowDefinitionName != null)
          'flow_definition_name': flowDefinitionName,
        if (sessionId != null) 'session_id': sessionId,
        if (authRequestId != null) 'auth_request_id': authRequestId,
        if (redirectUri != null) 'redirect_uri': redirectUri.toString(),
        if (dryRun) 'dry_run': true,
      },
    );
    return _asFlowResponse(body);
  }

  /// Advances the flow. Field validation failures come back as HTTP 400
  /// with the step echoed and `step.error` set — those are unwrapped and
  /// returned like a success so callers render the error in place
  /// (mirroring `submitStep` in the web orchestrator's api-client).
  /// Everything else throws [ZitadelApiException].
  Future<FlowResponse> submit(String flowId, SubmitRequest request) async {
    try {
      final body = await _executor.execute(
        method: 'POST',
        path: '/flow/${Uri.encodeComponent(flowId)}/submit',
        jsonBody: request.toJson(),
      );
      return _asFlowResponse(body);
    } on ZitadelApiException catch (error) {
      final raw = error.rawBody;
      if (error.status == 400 &&
          raw is Map<String, Object?> &&
          raw['step'] is Map<String, Object?>) {
        return FlowResponse.fromJson(raw);
      }
      rethrow;
    }
  }

  /// Re-reads the flow's current step — resume after an app restart or a
  /// network blip without losing collected state.
  Future<FlowResponse> current(String flowId) async {
    final body = await _executor.execute(
      method: 'GET',
      path: '/flow/${Uri.encodeComponent(flowId)}',
    );
    return _asFlowResponse(body);
  }

  FlowResponse _asFlowResponse(Object? body) {
    if (body is! Map<String, Object?>) {
      throw FormatException(
        'Expected a flow response object, got ${body.runtimeType}.',
      );
    }
    return FlowResponse.fromJson(body);
  }
}
