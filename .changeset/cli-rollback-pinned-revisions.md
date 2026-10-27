---
"@zitadel/cli": minor
---

`zitadel deployment rollback` now shows the revisions the restored release pins, so you can see which schema revision new registrations use again. `--json` carries them in `data.pointers` as `{kind, handle, revision_id}`. The output also says that users keep the schema revision and attributes they have: a rollback restores configuration and does not migrate users back. When the release can't be read after the rollback, the command still succeeds and reports a warning without `data.pointers`.
