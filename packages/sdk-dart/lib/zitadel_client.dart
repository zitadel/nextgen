/// Pure-Dart client for the Zitadel NextGen flow and session APIs.
///
/// Drives server-driven login/registration flows (BDUI) and manages the
/// resulting session token:
///
/// ```dart
/// final project = configureZitadel(
///   projectId: 'proj_123',
///   baseUrl: Uri.parse('https://myapp.example/__nextgen'),
/// );
/// final flows = FlowClient(project);
///
/// var flow = await flows.create(purpose: FlowPurpose.login);
/// // Render flow.step.fields / flow.step.actions, collect input, then:
/// flow = await flows.submit(flow.id, SubmitRequest(
///   action: 'submit',
///   fields: {'email': 'alice@acme.com'},
/// ));
/// if (flow.step.complete != null && flow.handoffToken != null) {
///   final session = await SessionClient(project)
///       .exchange(handoffToken: flow.handoffToken!);
/// }
/// ```
///
/// See `zitadel_flutter` for prebuilt widgets on top of this package.
library;

export 'src/config.dart' show ZitadelProject, configureZitadel;
export 'src/errors.dart' show ZitadelApiException;
export 'src/flow_client.dart' show FlowClient;
export 'src/http/cookie_store.dart'
    show CookieStore, InMemoryCookieStore, StoredCookie, parseSetCookie;
export 'src/http/io_transport.dart' show IoTransport;
export 'src/http/transport.dart'
    show ZitadelRequest, ZitadelResponse, ZitadelTransport;
export 'src/l10n/localizer.dart' show ZitadelLocalizer, builtinLocales;
export 'src/models/flow_action.dart' show ActionKind, FlowAction;
export 'src/models/flow_field.dart'
    show FieldFormat, FieldType, FieldValidation, FlowField;
export 'src/models/flow_gate.dart' show FlowGate;
export 'src/models/flow_purpose.dart' show FlowPurpose;
export 'src/models/flow_response.dart'
    show BrandingLayout, FlowBranding, FlowResponse;
export 'src/models/flow_step.dart'
    show FlowChallenge, FlowStep, SsoProvider, StepComplete, StepTexts;
export 'src/models/session.dart' show Session, SessionState, SessionWithToken;
export 'src/models/submit_request.dart' show ChallengeResponse, SubmitRequest;
export 'src/session_client.dart' show SessionClient;
export 'src/storage/token_store.dart' show InMemoryTokenStore, TokenStore;
