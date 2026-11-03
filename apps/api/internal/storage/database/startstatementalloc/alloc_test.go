// Package startstatementalloc pins the cost of a statement nobody observes.
// It is its own package so that no test in it installs a tracer or meter
// provider: the global delegates stay unset for the whole binary.
package startstatementalloc_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// With no span recording and no meter collecting, StartStatement neither
// names the statement nor allocates.
func TestStartStatement_unobservedAllocatesNothing(t *testing.T) {
	ctx := t.Context()
	allocs := testing.AllocsPerRun(100, func() {
		got, end := database.StartStatement(ctx, metrics.DBSystemPostgreSQL)
		end(nil)
		if got != ctx {
			t.Error("a span was started")
		}
	})
	assert.Zero(t, allocs)
}
