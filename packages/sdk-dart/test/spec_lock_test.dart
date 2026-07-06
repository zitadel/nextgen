/// Spec-lock: the drift guard that replaces OpenAPI codegen.
///
/// The Dart models are hand-written (see the "handwritten thin client"
/// decision in `docs/design/sdk-flutter/PLAN.md`). This suite parses the
/// in-repo OpenAPI schemas and asserts each model's static `spec*` manifest
/// matches the spec's property names, `required` lists, and enum values.
/// A PR that changes those spec files fails here until the models are
/// updated — mechanical sync without a generator.
///
/// If this test fails, update BOTH the model's `fromJson`/`toJson` AND its
/// `spec*` manifest (they sit next to each other), then the fixtures.
library;

import 'dart:io';

import 'package:test/test.dart';
import 'package:yaml/yaml.dart';
import 'package:zitadel_client/zitadel_client.dart';

const specRoot = '../../api/openapi';

YamlMap loadSpec(String relativePath) =>
    loadYaml(File('$specRoot/$relativePath').readAsStringSync()) as YamlMap;

Set<String> properties(YamlMap schema) =>
    ((schema['properties'] as YamlMap?) ?? YamlMap())
        .keys
        .cast<String>()
        .toSet();

Set<String> required(YamlMap schema) =>
    ((schema['required'] as YamlList?) ?? YamlList()).cast<String>().toSet();

List<String> enumOf(YamlMap schema, String property) =>
    ((schema['properties'] as YamlMap)[property] as YamlMap)['enum']
        .cast<String>()
        .toList() as List<String>;

YamlMap propertySchema(YamlMap schema, String property) =>
    (schema['properties'] as YamlMap)[property] as YamlMap;

void main() {
  setUpAll(() {
    // Guard against running from a wrong working directory (dart test runs
    // from the package root) or a moved spec tree.
    expect(
      Directory(specRoot).existsSync(),
      isTrue,
      reason: 'OpenAPI spec not found at $specRoot — did api/openapi move?',
    );
  });

  test('flow-response.yaml matches FlowResponse', () {
    final schema = loadSpec('components/flows/flow-response.yaml');
    expect(properties(schema), FlowResponse.specProperties);
    expect(required(schema), FlowResponse.specRequired);
  });

  test('flow-step.yaml matches FlowStep and its nested types', () {
    final schema = loadSpec('components/flows/flow-step.yaml');
    expect(properties(schema), FlowStep.specProperties);
    expect(required(schema), FlowStep.specRequired);
    expect(enumOf(schema, 'complete'), StepComplete.wireValues);

    final challenge = propertySchema(schema, 'challenge');
    expect(properties(challenge), FlowChallenge.specProperties);
    expect(
      enumOf(challenge, 'method'),
      FlowChallenge.specMethodWireValues,
    );
  });

  test('field.yaml matches FlowField, FieldType, and FieldValidation', () {
    final schema = loadSpec('components/flows/field.yaml');
    expect(properties(schema), FlowField.specProperties);
    expect(required(schema), FlowField.specRequired);
    expect(enumOf(schema, 'type'), FieldType.wireValues);

    final validation = propertySchema(schema, 'validation');
    expect(properties(validation), FieldValidation.specProperties);
    expect(enumOf(validation, 'format'), FieldFormat.wireValues);
  });

  test('step-action.yaml matches FlowAction and ActionKind', () {
    final schema = loadSpec('components/flows/step-action.yaml');
    expect(properties(schema), FlowAction.specProperties);
    expect(required(schema), FlowAction.specRequired);
    expect(enumOf(schema, 'kind'), ActionKind.wireValues);
  });

  test('gate.yaml matches FlowGate', () {
    final schema = loadSpec('components/flows/gate.yaml');
    expect(properties(schema), FlowGate.specProperties);
    expect(required(schema), FlowGate.specRequired);
    expect(enumOf(schema, 'kind'), FlowGate.specKindWireValues);
  });

  test('step-texts.yaml matches StepTexts', () {
    final schema = loadSpec('components/flows/step-texts.yaml');
    expect(properties(schema), StepTexts.specProperties);
  });

  test('sso-provider.yaml matches SsoProvider', () {
    final schema = loadSpec('components/flows/sso-provider.yaml');
    expect(properties(schema), SsoProvider.specProperties);
    expect(required(schema), SsoProvider.specRequired);
  });

  test('branding.yaml matches FlowBranding', () {
    final schema = loadSpec('components/flows/branding.yaml');
    expect(properties(schema), FlowBranding.specProperties);
    expect(enumOf(schema, 'layout'), BrandingLayout.wireValues);
  });

  test('flow-submit-request.yaml matches SubmitRequest', () {
    final schema = loadSpec('components/flows/flow-submit-request.yaml');
    expect(properties(schema), SubmitRequest.specProperties);
    expect(required(schema), SubmitRequest.specRequired);

    final challengeResponse = propertySchema(schema, 'challenge_response');
    expect(properties(challengeResponse), ChallengeResponse.specProperties);
  });

  test('create-flow-request.yaml purpose enum matches FlowPurpose', () {
    final schema = loadSpec('components/flows/create-flow-request.yaml');
    expect(enumOf(schema, 'purpose'), FlowPurpose.wireValues);
    expect(
      FlowPurpose.values.map((p) => p.wire).toSet(),
      FlowPurpose.wireValues.toSet(),
    );
  });

  test('session-response.yaml matches Session and SessionState', () {
    final schema = loadSpec('endpoints/sessions/session-response.yaml');
    expect(properties(schema), Session.specProperties);
    expect(required(schema), Session.specRequired);
    expect(enumOf(schema, 'state'), SessionState.wireValues);
  });

  test('session-with-token-response.yaml matches SessionWithToken', () {
    final schema =
        loadSpec('endpoints/sessions/session-with-token-response.yaml');
    expect(properties(schema), SessionWithToken.specProperties);
    expect(required(schema), SessionWithToken.specRequired);
  });

  test('exchange-request.yaml matches SessionClient.exchange', () {
    final schema =
        loadSpec('endpoints/sessions/exchange/exchange-request.yaml');
    // exchange() builds this body inline; the manifest lives here.
    expect(properties(schema), {'handoff_token', 'ttl'});
    expect(required(schema), {'handoff_token'});
  });

  test('error-details.yaml matches ZitadelApiException', () {
    final schema = loadSpec('components/error-details.yaml');
    // The exception surfaces the envelope as code/message/details fields.
    expect(properties(schema), {'code', 'message', 'details'});
    expect(required(schema), {'code', 'message'});
  });
}
