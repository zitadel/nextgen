---
title: A passkey sign-up says an email is taken before the browser saves a passkey
summary: A passkey sign-up with an email that already has an account shows that the account exists before the browser asks to save a passkey, instead of leaving an unusable passkey in the password manager.
date: 2026-11-24T15:17Z
cloud: true
pulls: [3026]
---

A passkey sign-up with an email that already has an account now shows that the account exists before the browser asks to save a passkey. Before, the browser saved the passkey first and the server then refused it, which left an unusable entry in the password manager.

- The server checks every unique value the sign-up collected when passkey setup starts, not only the email.
- A signed-in user who adds a passkey is not affected.
- A value that someone else takes while the browser prompt is open is still refused when the passkey is verified.
