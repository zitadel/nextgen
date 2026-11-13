//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import "net/http"

// knownSpecMismatches are the server's answers that do not match the OpenAPI
// spec yet: an operation, the status it answers with, and why. Fix the server
// or the spec, then delete the entry; CheckSpecConformance fails on an entry
// the run sees answer to the spec. Never add one to make a new mismatch pass.
var knownSpecMismatches = []KnownSpecMismatch{
	{
		Operation: "submitFlowStep",
		Status:    http.StatusBadRequest,
		Codes:     []string{"req.invalid", "flow.invalid_action", "flow.unsupported", "flow.invalid_purpose"},
		Reason:    "the spec's 400 is a flow-response only; a refused submission (req.invalid, flow.invalid_action) answers 400 with the error envelope",
	},
}
