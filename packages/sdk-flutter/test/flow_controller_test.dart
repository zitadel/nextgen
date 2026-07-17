import 'package:flutter_test/flutter_test.dart';
import 'package:zitadel_flutter/zitadel_flutter.dart';

import 'fake_transport.dart';

void main() {
  test('start loads the first step and seeds field defaults', () async {
    final transport = FakeTransport([
      jsonResponse(201, {
        ...identifierStepBody(),
        'step': {
          ...identifierStepBody()['step']! as Map<String, Object?>,
          'fields': [
            {
              'name': 'email',
              'type': 'email',
              'text_key': 'identifier.field.email',
              'value': 'prefilled@acme.com',
            },
          ],
        },
      }),
    ]);
    final controller = FlowController(project: projectWith(transport));

    await controller.start();

    final state = controller.state;
    expect(state, isA<FlowStepReady>());
    expect((state as FlowStepReady).values['email'], 'prefilled@acme.com');
  });

  test('typed input wins over server defaults on the next step', () async {
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(200, {
        ...identifierStepBody(),
        'step': {
          ...identifierStepBody()['step']! as Map<String, Object?>,
          'fields': [
            {
              'name': 'email',
              'type': 'email',
              'text_key': 'identifier.field.email',
              'value': 'server-default@acme.com',
            },
          ],
        },
      }),
    ]);
    final controller = FlowController(project: projectWith(transport));
    await controller.start();

    controller.setValue('email', 'typed@acme.com');
    await controller.submitAction('submit');

    expect(
      (controller.state as FlowStepReady).values['email'],
      'typed@acme.com',
    );
  });

  test('submit sends only the current step\'s declared fields', () async {
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(200, doneStepBody()),
    ]);
    final controller = FlowController(project: projectWith(transport));
    await controller.start();

    controller.setValue('email', 'alice@acme.com');
    controller.setValue('password', 'hunter22');
    controller.setValue('stale_from_prior_step', 'must-not-leak');
    await controller.submitAction('submit');

    final submitBody = transport.requests[1].jsonBody! as Map<String, Object?>;
    expect(submitBody['action'], 'submit');
    expect(submitBody['fields'], {
      'email': 'alice@acme.com',
      'password': 'hunter22',
    });
    expect(submitBody['session_token'], 'tok_1');
  });

  test('a validation 400 with an echoed step stays interactive', () async {
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(400, identifierStepBody(error: 'error.invalid_credentials')),
    ]);
    final controller = FlowController(project: projectWith(transport));
    await controller.start();

    await controller.submitAction('submit');

    final state = controller.state as FlowStepReady;
    expect(state.step.error, 'error.invalid_credentials');
    expect(state.submitting, isFalse);
    expect(state.transportError, isNull);
  });

  test('a transport failure keeps the step and reports the error', () async {
    final errors = <Object>[];
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(500, {'code': 'E_INTERNAL', 'message': 'boom'}),
    ]);
    final controller = FlowController(
      project: projectWith(transport),
      onError: errors.add,
    );
    await controller.start();

    await controller.submitAction('submit');

    final state = controller.state as FlowStepReady;
    expect(state.transportError, 'boom');
    expect(state.step.name, 'identifier');
    expect(errors, hasLength(1));
  });

  test('double submits are guarded while a submit is in flight', () async {
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(200, doneStepBody()),
    ]);
    final controller = FlowController(project: projectWith(transport));
    await controller.start();

    final first = controller.submitAction('submit');
    final second = controller.submitAction('submit'); // no-op: in flight
    await Future.wait([first, second]);

    // create + exactly one submit — the second call must not hit the wire.
    expect(transport.requests, hasLength(2));
  });

  test('completion without autoExchange surfaces the handoff token', () async {
    FlowCompletion? completion;
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(200, doneStepBody()),
    ]);
    final controller = FlowController(
      project: projectWith(transport),
      onComplete: (c) => completion = c,
    );
    await controller.start();

    await controller.submitAction('submit');

    expect(controller.state, isA<FlowCompleted>());
    expect(completion?.behavior, StepComplete.show);
    expect(completion?.handoffToken, 'handoff_1');
    expect(completion?.session, isNull);
  });

  test('autoExchange trades the handoff token for a session', () async {
    FlowCompletion? completion;
    final transport = FakeTransport([
      jsonResponse(201, identifierStepBody()),
      jsonResponse(200, doneStepBody()),
      jsonResponse(200, exchangeBody()),
    ]);
    final project = projectWith(transport);
    final controller = FlowController(
      project: project,
      autoExchange: true,
      onComplete: (c) => completion = c,
    );
    await controller.start();

    await controller.submitAction('submit');

    expect(completion?.session?.sessionToken, 'stok_1');
    expect(
      completion?.handoffToken,
      isNull,
      reason: 'consumed tokens must not be re-exposed',
    );
    expect(await project.tokenStore.read(), 'stok_1');
    final exchangeRequest = transport.requests[2];
    expect(exchangeRequest.url.path, '/__nextgen/sessions/exchange');
  });

  test(
    'the rotated flow id from each response is used for the next submit',
    () async {
      final transport = FakeTransport([
        jsonResponse(201, identifierStepBody()),
        jsonResponse(200, {...identifierStepBody(), 'id': 'flow_rotated'}),
        jsonResponse(200, doneStepBody()),
      ]);
      final controller = FlowController(project: projectWith(transport));
      await controller.start();

      await controller.submitAction('submit');
      await controller.submitAction('submit');

      expect(transport.requests[1].url.path, '/__nextgen/flow/flow_1/submit');
      expect(
        transport.requests[2].url.path,
        '/__nextgen/flow/flow_rotated/submit',
      );
    },
  );

  test('unsupported capabilities are reported once each', () async {
    final reported = <String>[];
    final body = identifierStepBody();
    (body['step']! as Map<String, Object?>)['actions'] = [
      {'name': 'passkey', 'kind': 'passkey'},
    ];
    (body['step']! as Map<String, Object?>)['gates'] = {
      'captcha': {
        'kind': 'captcha',
        'provider': 'turnstile',
        'config': <String, Object?>{},
      },
    };
    final transport = FakeTransport([jsonResponse(201, body)]);
    final controller = FlowController(
      project: projectWith(transport),
      onUnsupportedCapability: reported.add,
    );

    await controller.start();

    expect(reported, ['action:passkey', 'gate:captcha:turnstile']);
  });

  test('resumeFlowId loads via GET /flow/{id} instead of POST /flow', () async {
    final transport = FakeTransport([jsonResponse(200, identifierStepBody())]);
    final controller = FlowController(
      project: projectWith(transport),
      resumeFlowId: 'flow_resume',
    );

    await controller.start();

    final request = transport.requests.single;
    expect(request.method, 'GET');
    expect(request.url.path, '/__nextgen/flow/flow_resume');
  });

  test(
    'altcha gates are unsupported by default and no proofs are sent',
    () async {
      final reported = <String>[];
      final body = identifierStepBody();
      (body['step']! as Map<String, Object?>)['gates'] = {
        'captcha': {
          'kind': 'captcha',
          'provider': 'altcha',
          'config': {
            'algorithm': 'SHA-256',
            // sha256('s7') — trivially solvable, so a wrongly-enabled
            // solver would definitely produce a proof.
            'challenge': sha256Hex('s7'),
            'salt': 's',
            'max_number': 10,
          },
        },
      };
      final transport = FakeTransport([
        jsonResponse(201, body),
        jsonResponse(200, doneStepBody()),
      ]);
      final controller = FlowController(
        project: projectWith(transport),
        onUnsupportedCapability: reported.add,
      );
      await controller.start();

      await controller.submitAction('submit');

      expect(reported, contains('gate:captcha:altcha'));
      final submit = transport.requests[1].jsonBody! as Map<String, Object?>;
      expect(
        submit.containsKey('gate_proofs'),
        isFalse,
        reason:
            'the server rejects gate_proofs as reserved; default must '
            'not send them',
      );
    },
  );

  test('enableAltchaGates solves the gate and submits the proof', () async {
    final reported = <String>[];
    final body = identifierStepBody();
    (body['step']! as Map<String, Object?>)['gates'] = {
      'captcha': {
        'kind': 'captcha',
        'provider': 'altcha',
        'config': {
          'algorithm': 'SHA-256',
          'challenge': sha256Hex('s7'),
          'salt': 's',
          'max_number': 10,
        },
      },
    };
    final transport = FakeTransport([
      jsonResponse(201, body),
      jsonResponse(200, doneStepBody()),
    ]);
    final controller = FlowController(
      project: projectWith(transport),
      enableAltchaGates: true,
      onUnsupportedCapability: reported.add,
    );
    await controller.start();

    await controller.submitAction('submit');

    expect(reported, isNot(contains('gate:captcha:altcha')));
    final submit = transport.requests[1].jsonBody! as Map<String, Object?>;
    final proofs = submit['gate_proofs'] as Map<String, Object?>?;
    expect(proofs, isNotNull);
    expect(proofs!['captcha'], isA<String>());
  });

  test('a failed start surfaces FlowFailed and start() can retry', () async {
    final transport = FakeTransport([
      jsonResponse(503, {'code': 'E_UNAVAILABLE', 'message': 'down'}),
      jsonResponse(201, identifierStepBody()),
    ]);
    final controller = FlowController(project: projectWith(transport));

    await controller.start();
    expect(controller.state, isA<FlowFailed>());

    await controller.start();
    expect(controller.state, isA<FlowStepReady>());
  });
}
