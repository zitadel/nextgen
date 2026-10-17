package sqlite_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/sqlite"
)

// Not run in parallel: it replaces the process-wide default Application.
func TestStatementAndPoolMetrics(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	app, err := metrics.NewApplication(metrics.WithMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))))
	require.NoError(t, err)
	metrics.SetDefault(app)
	t.Cleanup(func() { metrics.SetDefault(nil) })

	pool, err := sqlite.Config{Path: filepath.Join(t.TempDir(), "zitadel.db")}.Connect(t.Context())
	require.NoError(t, err)
	require.NoError(t, pool.Migrate(t.Context()))
	p := pool.(*sqlite.Pool)

	ctx := t.Context()
	// One statement on the pool, one inside a transaction.
	require.NoError(t, p.CreateProject(ctx, &domain.Project{ID: "proj-metrics", Name: "Metrics", PreviewOrigins: []string{}}))
	require.NoError(t, p.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		_, err := tx.Statements().GetProjectByID(ctx, "proj-metrics")
		return err
	}))

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(ctx, &rm))
	statements := map[string]bool{}
	pool0 := map[string]int64{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			switch data := m.Data.(type) {
			case metricdata.Histogram[float64]:
				for _, point := range data.DataPoints {
					dialect, _ := point.Attributes.Value(metrics.DialectKey)
					assert.Equal(t, "sqlite", dialect.AsString())
					name, _ := point.Attributes.Value(metrics.StatementKey)
					statements[name.AsString()] = true
				}
			case metricdata.Sum[int64]:
				for _, point := range data.DataPoints {
					state, _ := point.Attributes.Value(metrics.StateKey)
					pool0[state.AsString()] = point.Value
				}
			}
		}
	}
	assert.True(t, statements["projectStatements.CreateProject"], "got %v", statements)
	assert.True(t, statements["projectStatements.GetProjectByID"], "the transaction's statement is timed too: %v", statements)
	assert.NotContains(t, statements, "unknown")
	assert.Contains(t, pool0, "in_use")
	assert.Contains(t, pool0, "idle")

	// Closing the pool stops the gauge from reading it.
	require.NoError(t, pool.Close(ctx))
	require.NoError(t, reader.Collect(ctx, &rm))
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name == metrics.DBPoolConnections {
				assert.Empty(t, m.Data.(metricdata.Sum[int64]).DataPoints)
			}
		}
	}
}
