---
"@zitadel/server": minor
"@zitadel/api": minor
---

`submitFlowStep` (`POST /flow/{id}/submit`) is now documented to answer `400` with an error (`req.invalid`, `flow.invalid_action`, `flow.unsupported`) when it refuses a request before the step runs, as well as with the step and its `error` field. The generated clients now decode both shapes.

**Breaking:** in the Go client, a submit's `200` is now `*api.FlowResponseHeaders` instead of `*api.SubmitFlowStepOK`. Its `400` is `*api.SubmitFlowStepBadRequestHeaders`, whose `Response` holds either the step (`GetFlowResponse`) or the error (`GetErrorDetails`). In `@zitadel/api`, `SubmitFlowStep400` is now a union of the step and the error: check for `step` before reading it.
