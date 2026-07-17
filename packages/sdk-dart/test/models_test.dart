import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';
import 'package:zitadel_client/zitadel_client.dart';

void main() {
  late Map<String, Object?> fixture;

  setUpAll(() {
    fixture =
        jsonDecode(File('test/fixtures/flow_response.json').readAsStringSync())
            as Map<String, Object?>;
  });

  group('FlowResponse.fromJson', () {
    test('decodes the spec-example response', () {
      final response = FlowResponse.fromJson(fixture);

      expect(response.id, 'flow_01H8Z');
      expect(response.sessionId, 'sess_01H8Y');
      expect(response.handoffToken, isNull);
      expect(response.step.name, 'login');
      expect(response.step.texts?.titleKey, 'login.title');
      expect(response.step.isTerminal, isFalse);
      expect(response.branding?.layout, BrandingLayout.centered);
      expect(response.branding?.logoUrl, 'https://cdn.example.com/logo.svg');
    });

    test('preserves server-declared field and action order', () {
      final step = FlowResponse.fromJson(fixture).step;

      expect(step.fields.map((f) => f.name), ['email', 'password', 'country']);
      expect(step.actions.map((a) => a.name), [
        'submit',
        'register',
        'recover',
      ]);
    });

    test('decodes field metadata, validation, and pre-filled values', () {
      final step = FlowResponse.fromJson(fixture).step;
      final email = step.fields[0];
      final country = step.fields[2];

      expect(email.type, FieldType.email);
      expect(email.required, isTrue);
      expect(email.validation?.format, FieldFormat.email);
      expect(email.validation?.maxLength, 254);
      expect(email.initialValue, '');
      expect(country.type, FieldType.select);
      expect(country.required, isFalse);
      expect(country.initialValue, 'CH');
      expect(country.validation?.enumValues, ['CH', 'DE', 'IT']);
    });

    test('decodes gates as a name-keyed map', () {
      final step = FlowResponse.fromJson(fixture).step;
      final captcha = step.gates['captcha'];

      expect(captcha, isNotNull);
      expect(captcha!.kind, 'captcha');
      expect(captcha.provider, 'altcha');
      expect(captcha.config['max_number'], 100000);
    });

    test('primaryAction prefers the primary flag, falls back to first', () {
      final step = FlowResponse.fromJson(fixture).step;
      expect(step.primaryAction?.name, 'submit');

      final noPrimary = FlowStep.fromJson({
        'name': 'x',
        'actions': [
          {'name': 'a', 'kind': 'navigate'},
          {'name': 'b', 'kind': 'submit'},
        ],
      });
      expect(noPrimary.primaryAction?.name, 'a');
      expect(FlowStep.fromJson({'name': 'x'}).primaryAction, isNull);
    });

    test('maps unknown enum wire values to unknown instead of throwing', () {
      final step = FlowStep.fromJson({
        'name': 'future',
        'complete': 'teleport',
        'fields': [
          {'name': 'f', 'type': 'retina-scan', 'text_key': 'k'},
        ],
        'actions': [
          {'name': 'a', 'kind': 'quantum'},
        ],
      });

      expect(step.complete, StepComplete.unknown);
      expect(step.fields.single.type, FieldType.unknown);
      expect(step.actions.single.kind, ActionKind.unknown);
    });

    test('ignores unknown top-level keys', () {
      final withExtra = {...fixture, 'brand_new_server_key': 42};
      expect(() => FlowResponse.fromJson(withExtra), returnsNormally);
    });
  });

  group('FlowStep semantics ported from the web orchestrator', () {
    test('errorIsTextKey distinguishes keys from raw messages', () {
      FlowStep withError(String error) =>
          FlowStep.fromJson({'name': 's', 'error': error});
      expect(withError('error.invalid_credentials').errorIsTextKey, isTrue);
      expect(withError('Something exploded').errorIsTextKey, isFalse);
    });

    test('action label keys derive from step and action names', () {
      const action = FlowAction(name: 'submit', kind: ActionKind.submit);
      expect(action.labelKeyFor('identifier'), 'identifier.action.submit');
      const withKey = FlowAction(
        name: 'submit',
        kind: ActionKind.submit,
        textKey: 'custom.key',
      );
      expect(withKey.labelKeyFor('identifier'), 'custom.key');
    });
  });

  group('SubmitRequest.toJson', () {
    test('emits only populated optional keys', () {
      const minimal = SubmitRequest(action: 'submit');
      expect(minimal.toJson(), {
        'action': 'submit',
        'fields': <String, Object?>{},
      });

      const full = SubmitRequest(
        action: 'passkey',
        fields: {'email': 'a@b.c'},
        gateProofs: {'captcha': 'proof'},
        challengeResponse: ChallengeResponse(
          challengeId: 'ch_1',
          method: 'passkey',
          proof: {'id': 'cred'},
        ),
        sessionToken: 'stok_1',
      );
      final json = full.toJson();
      expect(json['gate_proofs'], {'captcha': 'proof'});
      expect(json['challenge_response'], {
        'challenge_id': 'ch_1',
        'method': 'passkey',
        'proof': {'id': 'cred'},
      });
      expect(json['session_token'], 'stok_1');
      expect(json.containsKey('sso_provider_id'), isFalse);
    });
  });

  group('Session.fromJson', () {
    test('decodes the session shape', () {
      final session = Session.fromJson({
        'session_id': 'sess_1',
        'project_id': 'proj_1',
        'state': 'active',
        'user_id': 'user_1',
        'factors': [
          {'type': 'password', 'verified_at': '2026-04-29T10:00:00Z'},
        ],
        'assurance_levels': ['urn:nist:aal:1'],
        'created_at': '2026-04-29T10:00:00Z',
        'expires_at': '2026-04-30T10:00:00Z',
      });

      expect(session.state, SessionState.active);
      expect(session.userId, 'user_1');
      expect(session.factors.single['type'], 'password');
      expect(session.assuranceLevels, ['urn:nist:aal:1']);
      expect(session.expiresAt, DateTime.utc(2026, 4, 30, 10));
    });

    test('tolerates anonymous sessions and unknown states', () {
      final session = Session.fromJson({
        'session_id': 'sess_1',
        'project_id': 'proj_1',
        'state': 'hibernating',
      });
      expect(session.userId, isNull);
      expect(session.state, SessionState.unknown);
    });
  });
}
