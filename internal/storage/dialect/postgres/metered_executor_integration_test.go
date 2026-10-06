//go:build postgres_integration

package postgres

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/service"
)

// Against a real server: statements on the pool, in a transaction opened by
// the pool, and in a savepoint, are all measured under their own names; a
// QueryRow ends on its Scan; and the pool reports its connections.
func TestMetered_realPool(t *testing.T) {
	reader := useMetrics(t)
	// newPool registers the gauge with the default Application, so the pool
	// under test is a second handle on the shared pgxpool, built after it.
	p := newPool(testPool.pool)
	t.Cleanup(p.unregisterStats)

	id := uniqueProjectID(t)
	require.NoError(t, p.CreateProject(t.Context(), newTestProject(id)))
	t.Cleanup(func() { _, _ = p.DeleteProjectByID(context.Background(), id) })

	_, err := p.GetProjectByID(t.Context(), id)
	require.NoError(t, err)
	require.NoError(t, p.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		_, err := tx.Statements().GetProjectByID(ctx, id)
		return err
	}))

	got := statementCounts(t, reader)
	assert.Contains(t, got, "projectStatements.CreateProject")
	assert.Contains(t, got, "projectStatements.GetProjectByID")
	assert.EqualValues(t, 2, got["projectStatements.GetProjectByID"], "once on the pool, once in the transaction")
	assert.NotContains(t, got, "unknown")

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))
	states := map[string]int64{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name != metrics.DBPoolConnections {
				continue
			}
			for _, point := range m.Data.(metricdata.Sum[int64]).DataPoints {
				state, _ := point.Attributes.Value(metrics.StateKey)
				states[state.AsString()] = point.Value
			}
		}
	}
	assert.Contains(t, states, "in_use")
	assert.Positive(t, states["idle"], "a pool that has just served statements holds idle connections")
}
