# demo-flutter

Reference Flutter app for the Zitadel NextGen Flutter SDK
([`zitadel_flutter`](../../packages/sdk-flutter) /
[`zitadel_client`](../../packages/sdk-dart)) — the Flutter counterpart of
[`apps/demo-next`](../demo-next).

Screens: **Home** (signed-out → sign-in/create-account buttons;
signed-in → `ZitadelSession` card with sign-out), **Login** (full-screen
`ZitadelLogin` with automatic handoff exchange), **Settings** (base URL +
project id, persisted with `shared_preferences`).

## Run modes

Configure the base URL under Settings (gear icon). From the Android
emulator, reach the host machine via `http://10.0.2.2:<port>` (the
default); on other targets use `http://localhost:<port>`.

1. **Mock server** — deterministic happy-path flows, no backend needed:

   ```sh
   corepack pnpm --filter @zitadel/mock-zitadel dev   # :8080
   flutter run
   ```

2. **Local Zitadel** — the real server via the CLI's npm runtime:

   ```sh
   npx @zitadel/cli@alpha start
   flutter run
   ```

   The embedded flow works end to end; the final handoff→session
   exchange requires project credentials (see mode 3).

3. **Deployed proxy** — point the base URL at a running Next.js/Nuxt app's
   `/__nextgen` proxy (e.g. a demo-next deployment). The proxy injects the
   project service key, so the full journey including
   `POST /sessions/exchange` and `GET /sessions/me` works.

## Notes

- The Android manifest enables cleartext HTTP **for this demo only**, so
  the emulator can reach the plain-HTTP dev servers.
- Session token and flow cookie persist in the platform keychain
  (`SecureTokenStore` / `SecureCookieStore`) on Android/iOS/macOS.
