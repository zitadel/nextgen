---
"@zitadel/cli": patch
---

Every command now checks its flags, their combinations and what it needs from the project before it runs, so a bad value or a missing precondition is refused up front rather than part way through. Each refusal keeps the code that says what went wrong — `E_VALIDATION` for a bad flag, and the code the precondition already used, such as `E_LOCAL_SERVER_NOT_RUNNING` or `E_CONFLICT` — so a caller that branches on the code still can. The wording of some refusals changed.

Colour is decided once for a run, by where its output goes rather than by what is piped into it, so `--color`, `--no-color`, `NO_COLOR` and `FORCE_COLOR` now mean the same thing in every command: `deploy`, `logs`, `preview` and `release` honour `FORCE_COLOR` as their `--color` flag already promised, and output stays coloured when input is redirected but the terminal is still the destination.
