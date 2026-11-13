//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

// knownSpecMismatches are the server's answers that do not match the OpenAPI
// spec yet: an operation, the status it answers with, and why. Fix the server
// or the spec, then delete the entry; CheckSpecConformance fails on an entry
// the run sees answer to the spec. Never add one to make a new mismatch pass.
var knownSpecMismatches = []KnownSpecMismatch{}
