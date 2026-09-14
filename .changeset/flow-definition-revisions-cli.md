---
"@zitadel/cli": minor
"@zitadel/config": patch
---

Flow definitions sync as revisions. An edited flow file plans as a `revise` and `apply` publishes a new immutable revision instead of updating in place. A schema revise re-publishes the flows pinned to it with the new `user_schema` in the same run. Removing a flow file no longer deletes the flow on the platform; `apply` fails with `E_NOT_IMPLEMENTED` instead.
