import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:zitadel_client/zitadel_client.dart';

/// Hex SHA-256 of [input] — for building solvable altcha challenges.
String sha256Hex(String input) => sha256.convert(utf8.encode(input)).toString();

/// Records requests and replays canned responses in order.
class FakeTransport implements ZitadelTransport {
  FakeTransport(this._responses);

  final List<ZitadelResponse> _responses;
  final List<ZitadelRequest> requests = [];

  @override
  Future<ZitadelResponse> send(ZitadelRequest request) async {
    requests.add(request);
    if (_responses.isEmpty) {
      throw StateError('FakeTransport ran out of canned responses.');
    }
    return _responses.removeAt(0);
  }
}

ZitadelResponse jsonResponse(
  int status,
  Object? body, {
  List<String>? setCookies,
}) => ZitadelResponse(
  status: status,
  body: body == null ? '' : jsonEncode(body),
  setCookies: setCookies,
);

/// A two-step login: identifier (email+password) → done (show + handoff).
Map<String, Object?> identifierStepBody({String? error}) => {
  'id': 'flow_1',
  'session_id': 'sess_1',
  'session_token': 'tok_1',
  'step': {
    'name': 'identifier',
    'texts': {
      'title_key': 'identifier.title',
      'description_key': 'identifier.description',
    },
    if (error != null) 'error': error,
    'fields': [
      {
        'name': 'email',
        'type': 'email',
        'text_key': 'identifier.field.email',
        'required': true,
      },
      {
        'name': 'password',
        'type': 'password',
        'text_key': 'identifier.field.password',
        'required': true,
      },
    ],
    'actions': [
      {
        'name': 'submit',
        'kind': 'submit',
        'text_key': 'identifier.action.submit',
        'primary': true,
      },
      {
        'name': 'register',
        'kind': 'navigate',
        'text_key': 'identifier.action.register.link',
      },
    ],
    'gates': <String, Object?>{},
  },
};

Map<String, Object?> doneStepBody({String flowId = 'flow_2'}) => {
  'id': flowId,
  'session_id': 'sess_1',
  'step': {
    'name': 'done',
    'texts': {'title_key': 'done.title'},
    'complete': 'show',
    'fields': <Object?>[],
    'actions': <Object?>[],
    'gates': <String, Object?>{},
  },
  'handoff_token': 'handoff_1',
  'handoff_token_expires_at': DateTime.now()
      .add(const Duration(minutes: 1))
      .toIso8601String(),
};

Map<String, Object?> exchangeBody() => {
  'session': {
    'session_id': 'sess_1',
    'project_id': 'proj_1',
    'state': 'active',
    'user_id': 'user_1',
    'factors': <Object?>[],
    'created_at': '2026-04-29T10:00:00Z',
    'expires_at': '2026-04-30T10:00:00Z',
  },
  'session_token': 'stok_1',
};

ZitadelProject projectWith(FakeTransport transport) => configureZitadel(
  projectId: 'proj_1',
  baseUrl: Uri.parse('https://app.example/__nextgen'),
  transport: transport,
);
