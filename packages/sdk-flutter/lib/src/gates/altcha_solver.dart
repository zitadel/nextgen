import 'dart:convert';
import 'dart:isolate';

import 'package:crypto/crypto.dart';

/// Solves altcha proof-of-work captcha gates.
///
/// Altcha challenges are pure computation — `config` carries
/// `{ algorithm, challenge, salt, max_number }` and the solution is the
/// number `n ≤ max_number` with `hex(sha256(salt + n)) == challenge`. No
/// third-party widget or WebView is needed, which is why altcha is the one
/// captcha provider this SDK drives natively (turnstile/hcaptcha need an
/// embedded browser and surface as unsupported capabilities instead).
///
/// The search runs in a background isolate so the UI isolate never blocks.
/// The returned proof is the standard altcha payload: base64-encoded JSON
/// `{ algorithm, challenge, number, salt, signature, took }`.
class AltchaSolver {
  const AltchaSolver();

  /// Returns the proof string for [config], or null when the config is
  /// malformed or no solution exists within `max_number`.
  Future<String?> solve(Map<String, Object?> config) async {
    final algorithm = config['algorithm'];
    final challenge = config['challenge'];
    final salt = config['salt'];
    final maxNumber = config['max_number'];
    if (challenge is! String || salt is! String || maxNumber is! int) {
      return null;
    }
    if (algorithm is String && algorithm.toUpperCase() != 'SHA-256') {
      return null; // Only SHA-256 is specified today.
    }

    final started = DateTime.now();
    final number = await Isolate.run(
      () => _search(challenge: challenge, salt: salt, maxNumber: maxNumber),
    );
    if (number == null) return null;

    return base64Encode(
      utf8.encode(
        jsonEncode({
          'algorithm': 'SHA-256',
          'challenge': challenge,
          'number': number,
          'salt': salt,
          'signature': config['signature'] ?? '',
          'took': DateTime.now().difference(started).inMilliseconds,
        }),
      ),
    );
  }

  static int? _search({
    required String challenge,
    required String salt,
    required int maxNumber,
  }) {
    for (var n = 0; n <= maxNumber; n++) {
      if (sha256.convert(utf8.encode('$salt$n')).toString() == challenge) {
        return n;
      }
    }
    return null;
  }
}
