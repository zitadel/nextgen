# zitadel_client

Pure-Dart client for the Zitadel NextGen flow and session APIs. Drives
server-driven login/registration flows (BDUI) and manages the resulting
session token. Framework-agnostic — usable from Flutter apps, Dart CLIs,
and Dart servers. For prebuilt Flutter widgets, see
[`zitadel_flutter`](../sdk-flutter).

## How it works

The Zitadel NextGen login is backend-driven: the server returns each step
as ordered capability arrays (`fields`, `actions`, `gates`), your app
renders them, collects input, and posts back. The server decides what
comes next — there is no client-side "email then password" logic.

```dart
import 'package:zitadel_client/zitadel_client.dart';

final project = configureZitadel(
  projectId: 'proj_123',
  baseUrl: Uri.parse('https://myapp.example/__nextgen'),
);
final flows = FlowClient(project);

var flow = await flows.create(purpose: FlowPurpose.login);
while (!flow.step.isTerminal) {
  // Render flow.step.fields / flow.step.actions (in order!), collect
  // input, resolve labels via ZitadelLocalizer, then:
  flow = await flows.submit(
    flow.id, // may rotate between responses — always use the latest
    SubmitRequest(action: 'submit', fields: {'email': 'alice@acme.com'}),
  );
}

// Terminal step: exchange the one-time handoff token for a session.
final sessions = SessionClient(project);
final result = await sessions.exchange(handoffToken: flow.handoffToken!);
// result.sessionToken is now stored in project.tokenStore and sent as
// a Bearer token by sessions.me() / sessions.revoke().
```

Flow state rides an encrypted `_zflow` cookie which the configured
`CookieStore` captures and replays automatically; the server is stateless
between requests.

## Base URL: use your app's credentialed proxy

> **Warning**
> `POST /sessions/exchange` requires a project service key. That key must
> **never** ship inside a client binary. Point `baseUrl` at your
> application's server-side proxy (the `/__nextgen` middleware installed
> by `@zitadel/sdk-next` / `@zitadel/sdk-nuxt`), which injects the key —
> exactly how the browser SDKs work.

A direct server URL (e.g. `http://localhost:8080` from
`npx @zitadel/cli start`, or `http://10.0.2.2:8080` from the Android
emulator) works for the flow itself during development; only the final
exchange needs the credentialed path. Server-side Dart holding its own
service key can inject it via a custom `ZitadelTransport`.

## Localization

The server never sends display text, only semantic `text_key`s.
`ZitadelLocalizer` resolves them against built-in dictionaries (en, de,
it — ported from `@zitadel/components`) with per-key overrides:

```dart
final l10n = ZitadelLocalizer.resolve(languageCode: 'de');
l10n.t('identifier.title'); // "Anmelden"
l10n.t('some.unknown.key'); // falls back to the raw key
```

## Development

This package lives in the [zitadel/nextgen](https://github.com/zitadel/nextgen)
monorepo but is published to pub.dev independently of the npm release
train. Models are hand-written against the OpenAPI spec in `api/openapi/`;
the `test/spec_lock_test.dart` suite fails whenever the spec and the
models drift, so spec changes force a model update.

```sh
dart pub get
dart analyze --fatal-infos
dart test                  # unit + spec-lock
dart test --tags contract  # against a live mock: corepack pnpm --filter @zitadel/mock-zitadel dev
```

## License

MIT
