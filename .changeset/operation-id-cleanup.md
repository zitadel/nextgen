---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": minor
---

API operation names now follow one scheme: a camelCase verb and the resource
they act on, with no `ById` suffix, and every path parameter names its
resource (`{schema_id}` instead of `{id}`). No URL or request changes on the
wire ([API reference](https://preview.zitadel.com/docs/reference/api)).

**Breaking:** 34 operations are renamed, and with them the `@zitadel/api`
functions and types, the Go client's methods (`go.zitadel.com/zitadel/v5`),
the names `zitadel api` takes and the API reference page URLs (the old pages
redirect). `GetUserByID`, `PatchUserByID` and `DeleteUserByID` are `getUser`,
`updateUser` and `deleteUser`; the other `…ById` reads drop the suffix;
`getVariables` and `updateVariables` are `listVariables` and `setVariables`,
`getDeploymentVariables` is `listDeploymentVariables`; `deleteTeam` is
`deactivateTeam`; `patchMyUser` and `patchProject` are `updateMyUser` and
`updateProject`; passkey registration is `createUserPasskeyRegistration` and
`completeUserPasskeyRegistration`; the claim operations are
`createProjectClaim`, `getProjectClaimStatus`, `completeProjectClaim` and
`getProjectClaimWindow`; `addOrigin`, `removeOrigin`, `listPreviews` and
`removePreview` are `addProjectOrigin`, `removeProjectOrigin`,
`listProjectPreviews` and `removeProjectPreview`; `issueChallenge`,
`verifyChallengeProof` and `createHandoff` are `createAuthAttemptChallenge`,
`verifyAuthAttemptChallenge` and `createAuthAttemptHandoff`; and the writes
that publish a revision are `publishSchema`, `publishFlowDefinition`,
`publishBranding`, `publishIdp` and `publishApplication`. Rename the calls in
your code; `zitadel api ls` lists the current names.
