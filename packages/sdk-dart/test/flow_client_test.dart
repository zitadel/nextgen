import 'package:test/test.dart';
import 'package:zitadel_client/zitadel_client.dart';

import 'fake_transport.dart';

Map<String, Object?> flowBody({
  String id = 'flow_1',
  String stepName = 'login',
  String? error,
}) =>
    {
      'id': id,
      'session_id': 'sess_1',
      'step': {
        'name': stepName,
        if (error != null) 'error': error,
        'fields': <Object?>[],
        'actions': <Object?>[],
        'gates': <String, Object?>{},
      },
    };

ZitadelProject projectWith(FakeTransport transport) => configureZitadel(
      projectId: 'proj_1',
      baseUrl: Uri.parse('https://app.example/__nextgen'),
      transport: transport,
    );

void main() {
  test('create posts project_id and purpose to /flow', () async {
    final transport = FakeTransport([jsonResponse(201, flowBody())]);
    final client = FlowClient(projectWith(transport));

    final response = await client.create(purpose: FlowPurpose.register);

    final request = transport.requests.single;
    expect(request.method, 'POST');
    expect(request.url.toString(), 'https://app.example/__nextgen/flow');
    expect(request.jsonBody, {
      'project_id': 'proj_1',
      'purpose': 'register',
    });
    expect(response.id, 'flow_1');
  });

  test('the _zflow cookie is captured and replayed on the next call', () async {
    final transport = FakeTransport([
      jsonResponse(
        201,
        flowBody(),
        setCookies: ['_zflow=state1; Path=/; HttpOnly'],
      ),
      jsonResponse(
        200,
        flowBody(id: 'flow_2'),
        setCookies: ['_zflow=state2; Path=/; HttpOnly'],
      ),
    ]);
    final client = FlowClient(projectWith(transport));

    await client.create();
    await client.submit('flow_1', const SubmitRequest(action: 'submit'));

    expect(transport.requests[0].headers.containsKey('cookie'), isFalse);
    expect(transport.requests[1].headers['cookie'], '_zflow=state1');
  });

  test('submit unwraps a 400 that echoes the step (field validation)',
      () async {
    final transport = FakeTransport([
      jsonResponse(400, flowBody(error: 'error.invalid_credentials')),
    ]);
    final client = FlowClient(projectWith(transport));

    final response = await client.submit(
      'flow_1',
      const SubmitRequest(action: 'submit', fields: {'password': 'nope'}),
    );

    expect(response.step.error, 'error.invalid_credentials');
    expect(response.step.errorIsTextKey, isTrue);
  });

  test('submit rethrows a 400 without a step in the body', () async {
    final transport = FakeTransport([
      jsonResponse(400, {'code': 'E_VALIDATION', 'message': 'Bad request.'}),
    ]);
    final client = FlowClient(projectWith(transport));

    await expectLater(
      client.submit('flow_1', const SubmitRequest(action: 'submit')),
      throwsA(
        isA<ZitadelApiException>()
            .having((e) => e.status, 'status', 400)
            .having((e) => e.code, 'code', 'E_VALIDATION'),
      ),
    );
  });

  test('non-400 errors map to ZitadelApiException with the envelope', () async {
    final transport = FakeTransport([
      jsonResponse(500, {'code': 'E_INTERNAL', 'message': 'boom'}),
    ]);
    final client = FlowClient(projectWith(transport));

    await expectLater(
      client.create(),
      throwsA(
        isA<ZitadelApiException>()
            .having((e) => e.status, 'status', 500)
            .having((e) => e.message, 'message', 'boom'),
      ),
    );
  });

  test('current GETs /flow/{id} with the id URL-encoded', () async {
    final transport = FakeTransport([jsonResponse(200, flowBody())]);
    final client = FlowClient(projectWith(transport));

    await client.current('flow/../weird');

    expect(
      transport.requests.single.url.toString(),
      'https://app.example/__nextgen/flow/flow%2F..%2Fweird',
    );
  });

  test('base URLs without a path prefix resolve correctly', () async {
    final transport = FakeTransport([jsonResponse(201, flowBody())]);
    final client = FlowClient(
      ZitadelProject(
        projectId: 'proj_1',
        baseUrl: Uri.parse('http://localhost:8080'),
        transport: transport,
      ),
    );

    await client.create();

    expect(
      transport.requests.single.url.toString(),
      'http://localhost:8080/flow',
    );
  });
}
