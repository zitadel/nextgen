import 'dart:convert';

import 'package:zitadel_client/zitadel_client.dart';

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
