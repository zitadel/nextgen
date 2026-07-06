/// Why a flow is being started.
/// Spec: `api/openapi/components/flows/create-flow-request.yaml` `purpose`.
enum FlowPurpose {
  login,
  register,
  recovery,
  profiling,
  reauth,
  linkAccount;

  static const wireValues = [
    'login',
    'register',
    'recovery',
    'profiling',
    'reauth',
    'link_account',
  ];

  String get wire => switch (this) {
        login => 'login',
        register => 'register',
        recovery => 'recovery',
        profiling => 'profiling',
        reauth => 'reauth',
        linkAccount => 'link_account',
      };
}
