/// Contract tests against a live `apps/mock-zitadel` server.
///
/// Drives the real HTTP path (dart:io transport, cookie capture, error
/// mapping) through the mock's canonical login flow:
/// identifier → done (`complete: "show"` + signed handoff token) → exchange.
///
/// Start the server first:
///   corepack pnpm --filter @zitadel/mock-zitadel dev
/// then run:
///   dart test --tags contract
///
/// The whole suite skips itself when nothing listens on the target URL, so
/// `dart test` stays green in environments without the mock (the moon task
/// runs only the untagged suites; CI wiring for this suite is deferred with
/// the e2e milestone).
@Tags(['contract'])
library;

import 'dart:io';

import 'package:test/test.dart';
import 'package:zitadel_client/zitadel_client.dart';

final mockBaseUrl = Uri.parse(
  Platform.environment['ZITADEL_MOCK_URL'] ?? 'http://localhost:8080',
);

Future<bool> serverReachable() async {
  try {
    final socket = await Socket.connect(
      mockBaseUrl.host,
      mockBaseUrl.port,
      timeout: const Duration(seconds: 1),
    );
    socket.destroy();
    return true;
  } on SocketException {
    return false;
  }
}

void main() async {
  if (!await serverReachable()) {
    test(
      'mock-zitadel not reachable at $mockBaseUrl — suite skipped',
      () {},
      skip: 'start it with: corepack pnpm --filter @zitadel/mock-zitadel dev',
    );
    return;
  }

  late ZitadelProject project;

  setUp(() {
    project = configureZitadel(
      projectId: 'proj_contract_test',
      baseUrl: mockBaseUrl,
    );
  });

  test(
    'login journey: create → submit → terminal handoff → exchange',
    () async {
      final flows = FlowClient(project);

      final first = await flows.create(purpose: FlowPurpose.login);
      expect(first.step.name, 'identifier');
      expect(first.step.fields, isNotEmpty);
      expect(first.step.actions, isNotEmpty);
      expect(first.step.isTerminal, isFalse);
      final emailField = first.step.fields.where(
        (f) => f.type == FieldType.email,
      );
      expect(
        emailField,
        isNotEmpty,
        reason: 'identifier step should collect an email',
      );

      final done = await flows.submit(
        first.id,
        SubmitRequest(
          action: first.step.primaryAction?.name ?? 'submit',
          fields: const {
            'email': 'contract-test@example.com',
            'password': 'super-secret-1',
          },
          sessionToken: first.sessionToken,
        ),
      );
      expect(done.step.complete, StepComplete.show);
      expect(done.handoffToken, isNotNull);
      expect(
        done.handoffTokenExpiresAt?.isAfter(DateTime.now()),
        isTrue,
        reason: 'handoff token must not arrive pre-expired',
      );

      final exchanged = await SessionClient(
        project,
      ).exchange(handoffToken: done.handoffToken!);
      expect(exchanged.sessionToken, isNotEmpty);
      expect(await project.tokenStore.read(), exchanged.sessionToken);
    },
  );

  test('GET /flow/{id} re-renders the current step', () async {
    final flows = FlowClient(project);
    final first = await flows.create(purpose: FlowPurpose.login);

    final rendered = await flows.current(first.id);

    expect(rendered.step.name, first.step.name);
    expect(
      rendered.step.fields.map((f) => f.name),
      first.step.fields.map((f) => f.name),
    );
  });

  test('register purpose starts on the register step', () async {
    final flows = FlowClient(project);
    final first = await flows.create(purpose: FlowPurpose.register);
    expect(first.step.name, 'register');
  });
}
