/// Flutter widgets for Zitadel NextGen authentication.
///
/// The server-driven login/registration flow renders natively:
///
/// ```dart
/// import 'package:zitadel_flutter/zitadel_flutter.dart';
///
/// final project = configureZitadel(
///   projectId: 'proj_123',
///   baseUrl: Uri.parse('https://myapp.example/__nextgen'),
///   tokenStore: SecureTokenStore(),
///   cookieStore: SecureCookieStore(),
/// );
///
/// ZitadelLogin(
///   project: project,
///   onComplete: (completion) => Navigator.of(context).pop(),
/// );
/// ```
///
/// Re-exports the full headless `zitadel_client` API so apps that build
/// their own UI need only this one dependency.
library;

export 'package:zitadel_client/zitadel_client.dart';

export 'src/controller/flow_controller.dart'
    show
        FlowCompleted,
        FlowCompletion,
        FlowController,
        FlowFailed,
        FlowLoading,
        FlowStepReady,
        FlowUiState;
export 'src/gates/altcha_solver.dart' show AltchaSolver;
export 'src/storage/secure_stores.dart'
    show SecureCookieStore, SecureTokenStore;
export 'src/widgets/step_renderer.dart' show StepRenderer;
export 'src/widgets/zitadel_login.dart' show ZitadelLogin;
export 'src/widgets/zitadel_logout.dart' show ZitadelLogout;
export 'src/widgets/zitadel_session.dart' show ZitadelSession;
