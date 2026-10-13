# SSO validation fixtures

Each rule in `packages/config/src/validate-sso.ts` has two files here: `<rule>.fail.json`, a tree that
breaks it, and `<rule>.pass.json`, a tree that sits on its boundary and must be accepted. They are the
contract the server mirror (#1014) replays to show it reaches the same verdicts. `validate-sso.test.ts`
replays them against the TypeScript validator.

```jsonc
{
  "rule": "sso/provider-id",
  "description": "What the tree gets wrong, or what boundary it shows is fine.",
  "tree": {
    "schemas": { "<path>": { /* a user schema */ } },
    "flows": { "<path>": { "schemaPath": "<path of the schema it pins>", "body": { /* a flow */ } } },
    "connections": { "<path>": { /* a connection file */ } }
  },
  "expect": [
    { "rule": "sso/provider-id", "file": "<path>", "steps": ["identifier"], "includes": ["google"] }
  ]
}
```

- **`schemaPath` is an input.** Working out which local schema a flow's `user_schema` pins (by id, by the id the
  platform assigned, by a re-pin, or by file name) is the CLI's job, so a replay is handed the answer. A flow
  with no `schemaPath` gets only the rules that need no schema.
- **Compare issues as a set** of `rule`, `file` and `steps`. The order the validator emits them in is not part of
  the contract.
- **`includes` are English hints** for the TypeScript tests. Another implementation need not match the wording.
- **A failing tree may list several issues** when its rules overlap by construction: a mapped key a schema does not
  define is both an orphaned mapping target and an orphaned verification key, and a provider with no
  connection file is reported once for the schema that lists it and once for the steps that name it.
- An empty `expect` means the tree is valid.
