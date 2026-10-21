---
"@zitadel/cli": patch
"@zitadel/config": patch
---

`zitadel plan` shows an edit inside a list as the lines that changed. A flow's
steps and a step's actions are matched by `name`, so adding a field to one step
prints that one line under the step, with the untouched steps summarized as
hidden, instead of the whole `steps` list removed and added again. Lists of
values such as `fields` mark the items added or removed.

`zitadel apply` and `zitadel setup` no longer rewrite your `.zitadel/` files
with what the server stored: after applying a connection, `.zitadel/idps/*.json`
no longer gains `pkce_enabled`, `token_endpoint_auth_method` and
`id_token_mapping`. A field you leave out reads as the server's default, so
`plan` reports no change after an `apply`. The one file `apply` still rewrites,
and lists in `files_updated`, is a flow whose `user_schema` pins a schema
revision id the apply superseded.
