import 'package:test/test.dart';
import 'package:zitadel_client/zitadel_client.dart';

import 'fake_transport.dart';

Map<String, Object?> sessionBody({String state = 'active'}) => {
  'session_id': 'sess_1',
  'project_id': 'proj_1',
  'state': state,
  'user_id': 'user_1',
  'factors': <Object?>[],
  'created_at': '2026-04-29T10:00:00Z',
  'expires_at': '2026-04-30T10:00:00Z',
};

void main() {
  late FakeTransport transport;
  late ZitadelProject project;

  ZitadelProject buildProject(List<ZitadelResponse> responses) {
    transport = FakeTransport(responses);
    project = configureZitadel(
      projectId: 'proj_1',
      baseUrl: Uri.parse('https://app.example/__nextgen'),
      transport: transport,
    );
    return project;
  }

  test(
    'exchange posts the handoff token and stores the session token',
    () async {
      final client = SessionClient(
        buildProject([
          jsonResponse(200, {
            'session': sessionBody(),
            'session_token': 'stok_new',
          }),
        ]),
      );

      final result = await client.exchange(
        handoffToken: 'handoff_1',
        ttl: const Duration(hours: 1, minutes: 30),
      );

      final request = transport.requests.single;
      expect(request.method, 'POST');
      expect(request.url.path, '/__nextgen/sessions/exchange');
      expect(request.url.queryParameters, {'project_id': 'proj_1'});
      expect(request.jsonBody, {
        'handoff_token': 'handoff_1',
        'ttl': 'PT1H30M',
      });
      expect(result.sessionToken, 'stok_new');
      expect(result.session.state, SessionState.active);
      expect(await project.tokenStore.read(), 'stok_new');
    },
  );

  test('a new exchange supersedes the stored token', () async {
    final client = SessionClient(
      buildProject([
        jsonResponse(200, {
          'session': sessionBody(),
          'session_token': 'stok_2',
        }),
      ]),
    );
    await project.tokenStore.write('stok_1');

    await client.exchange(handoffToken: 'handoff_2');

    expect(await project.tokenStore.read(), 'stok_2');
  });

  test(
    'a 401 on exchange explains the credentialed-proxy requirement',
    () async {
      final client = SessionClient(
        buildProject([
          jsonResponse(401, {'code': 'E_UNAUTHENTICATED', 'message': 'nope'}),
        ]),
      );

      await expectLater(
        client.exchange(handoffToken: 'handoff_1'),
        throwsA(
          isA<ZitadelApiException>().having(
            (e) => e.message,
            'message',
            contains('credentialed proxy'),
          ),
        ),
      );
    },
  );

  test('a 410 on exchange (replayed handoff token) surfaces as-is', () async {
    final client = SessionClient(
      buildProject([
        jsonResponse(410, {'code': 'E_GONE', 'message': 'consumed'}),
      ]),
    );

    await expectLater(
      client.exchange(handoffToken: 'handoff_1'),
      throwsA(
        isA<ZitadelApiException>().having((e) => e.status, 'status', 410),
      ),
    );
  });

  test('me sends the stored token as a bearer', () async {
    final client = SessionClient(
      buildProject([jsonResponse(200, sessionBody())]),
    );
    await project.tokenStore.write('stok_1');

    final session = await client.me();

    expect(transport.requests.single.headers['authorization'], 'Bearer stok_1');
    expect(session.sessionId, 'sess_1');
  });

  test('revoke deletes the session and clears the stored token', () async {
    final client = SessionClient(
      buildProject([ZitadelResponse(status: 204, body: '')]),
    );
    await project.tokenStore.write('stok_1');

    await client.revoke();

    expect(transport.requests.single.method, 'DELETE');
    expect(await project.tokenStore.read(), isNull);
  });

  test(
    'revoking an already-gone session clears the token and succeeds',
    () async {
      final client = SessionClient(
        buildProject([
          jsonResponse(404, {'code': 'E_NOT_FOUND', 'message': 'gone'}),
        ]),
      );
      await project.tokenStore.write('stok_1');

      await client.revoke();

      expect(await project.tokenStore.read(), isNull);
    },
  );

  test(
    'revoke rethrows unexpected failures but still clears the token',
    () async {
      final client = SessionClient(
        buildProject([
          jsonResponse(500, {'code': 'E_INTERNAL', 'message': 'boom'}),
        ]),
      );
      await project.tokenStore.write('stok_1');

      await expectLater(client.revoke(), throwsA(isA<ZitadelApiException>()));
      expect(await project.tokenStore.read(), isNull);
    },
  );
}
