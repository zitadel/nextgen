package service_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

// BenchmarkPasswordPolicy_Check measures the gate a password set goes
// through, end to end except for the slow parts that are there by design:
// resolving the instance (here in memory, a storage read once the policy
// resource exists), binding it, normalizing and counting the candidate,
// building the context and evaluating the rules. History is off, so no hash
// is verified, and the candidate is not hashed.
func BenchmarkPasswordPolicy_Check(b *testing.B) {
	gate := newGate(b, fixedPolicy{config: map[string]any{"min_length": 15, "max_length": 64}}, nil, nil)
	in := service.SetPasswordInput{ProjectID: "p", UserID: "u", Password: "correct horse battery staple"}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := gate.CheckPassword(b.Context(), in); err != nil {
			b.Fatal(err)
		}
	}
}
