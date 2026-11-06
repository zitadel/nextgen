---
title: zitadel setup says what sign-in will do
summary: Every zitadel setup run now reports the sign-in it configured, with the methods, the registration fields, the minimum password length and the external providers, in its summary and in --json.
date: 2026-11-06T23:31Z
pulls: [2747, 2749, 2774, 2771]
---

`zitadel setup` now reports what sign-in is configured to do in every mode, not only in the wizard. Its summary box has a *Sign-in* section, and `--json` carries `data.sign_in`:

- the method the login starts with, and every method the user schema enables (`password-first` enables passkeys too, and `sso` is listed when you choose an external provider);
- each registration field and whether it is required;
- the minimum password length;
- the external providers.

The wizard is clearer too. It asks "Which sign-in method would you like your users to see first?" and words its answers by what users see first and what comes second. Its note names the optional fields as well as the required ones, and when you skip social sign-in it tells you how to add it later.

[The quickstart](https://preview.zitadel.com/docs/get-started/quickstart)
