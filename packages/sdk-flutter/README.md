# zitadel_flutter

Flutter widgets for Zitadel NextGen authentication. `ZitadelLogin`
natively renders the server-driven login/registration flow (the same
BDUI contract the `@zitadel/*` web SDKs drive), plus `ZitadelSession` /
`ZitadelLogout` widgets and secure token storage. Built on the headless
[`zitadel_client`](../sdk-dart) package, which it re-exports.

## Quick start

```dart
import 'package:zitadel_flutter/zitadel_flutter.dart';

final project = configureZitadel(
  projectId: 'proj_123',
  baseUrl: Uri.parse('https://myapp.example/__nextgen'),
  tokenStore: SecureTokenStore(),   // keychain/keystore persistence
  cookieStore: SecureCookieStore(), // lets a killed app resume a flow
);

// Sign-in page:
ZitadelLogin(
  project: project,
  purpose: FlowPurpose.login, // or register / recovery / …
  onComplete: (completion) => Navigator.of(context).pushReplacementNamed('/'),
  onError: (error) => log('auth error', error: error),
);

// Signed-in card with sign-out:
ZitadelSession(project: project, onSignedOut: () => ...);
```

The server decides which fields, actions, and gates each step carries —
the widget renders them in server order. There is no client-side
"email then password" logic to configure or get out of sync.

## Base URL

> **Warning**
> Point `baseUrl` at your application's credentialed proxy (the
> `/__nextgen` middleware from `@zitadel/sdk-next` / `sdk-nuxt`). The
> final handoff→session exchange requires a project service key that must
> **never** ship inside the app binary; the proxy injects it server-side.
> A direct server URL works for development against
> `npx @zitadel/cli start` or the repo's mock server (from the Android
> emulator, use `http://10.0.2.2:<port>`).

## Callbacks (web-component event parity)

| Web component event    | Widget callback             |
| ---------------------- | --------------------------- |
| `zitadel-flow-step`     | `onStep(step)`              |
| `zitadel-flow-input`    | `onInput(name, value)`      |
| `zitadel-flow-complete` | `onComplete(completion)`    |
| `zitadel-flow-error`    | `onError(error)`            |
| `zitadel-signout`       | `onSignedOut()`             |

`completion.behavior` tells you what to do: `show` means the widget is
displaying a success screen (with `autoExchange`, the session is already
established); `redirect` means navigate to `completion.redirectUri`
yourself (the SDK deliberately has no `url_launcher` dependency).

## Headless usage

`FlowController` is the widgetless state machine behind `ZitadelLogin` —
use it with your own UI. For no Flutter dependency at all, use
`zitadel_client` directly.

## Capability support in v1

Rendered natively: all field types and submit/navigate/back actions.
Not yet driven natively — surfaced via `onUnsupportedCapability` and
omitted from the UI: passkey actions/ceremonies, SSO providers, and all
captcha gates. An altcha proof-of-work solver ships in the package
(pure computation, runs in a background isolate) but is **disabled by
default** because the current server rejects `gate_proofs` as reserved;
opt in with `enableAltchaGates: true` once server-side gate verification
lands (or against the mock server). See the plan's deferred milestone in
`docs/design/sdk-flutter/PLAN.md`.

## Localization

Labels resolve from the server's `text_key`s against built-in en/de/it
dictionaries; pass `languageCode` and/or `localeOverrides` to customize.
Missing keys fall back to the raw key.

## License

MIT
