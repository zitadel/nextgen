package violations

import "net/http"

// No want comment: test files are skipped unless -check-tests is set, and
// TestViolations runs with the default flags.
func inTest() {
	_ = &http.Client{}
}
