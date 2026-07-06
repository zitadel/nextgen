import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zitadel_flutter/zitadel_flutter.dart';

void main() {
  test('solves a known SHA-256 proof-of-work challenge', () async {
    const salt = 'abc123';
    const secretNumber = 4242;
    final challenge =
        sha256.convert(utf8.encode('$salt$secretNumber')).toString();

    final proof = await const AltchaSolver().solve({
      'algorithm': 'SHA-256',
      'challenge': challenge,
      'salt': salt,
      'max_number': 10000,
    });

    expect(proof, isNotNull);
    final payload =
        jsonDecode(utf8.decode(base64Decode(proof!))) as Map<String, Object?>;
    expect(payload['number'], secretNumber);
    expect(payload['challenge'], challenge);
    expect(payload['salt'], salt);
    expect(payload['algorithm'], 'SHA-256');
  });

  test('returns null when no solution exists within max_number', () async {
    final proof = await const AltchaSolver().solve({
      'algorithm': 'SHA-256',
      'challenge': 'f' * 64, // matches no sha256 of salt+n for tiny n
      'salt': 's',
      'max_number': 10,
    });
    expect(proof, isNull);
  });

  test('returns null for malformed configs', () async {
    expect(await const AltchaSolver().solve({}), isNull);
    expect(
      await const AltchaSolver().solve({
        'algorithm': 'SHA-512', // unsupported
        'challenge': 'x',
        'salt': 's',
        'max_number': 10,
      }),
      isNull,
    );
  });
}
