package postgres

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// scannedRow is a pgx.Row that has no database behind it.
type scannedRow struct{ scans int }

func (r *scannedRow) Scan(...any) error {
	r.scans++
	return nil
}

// rowExecutor returns row from QueryRow.
type rowTx struct {
	*stubTx
	row pgx.Row
}

func (t rowTx) QueryRow(context.Context, string, ...any) pgx.Row { return t.row }

// fixtureStatements stands for a statements type: the executor names the
// statement after the method that called it.
type fixtureStatements struct{ client queryExecutor }

func (s fixtureStatements) GetThing(ctx context.Context) error {
	return s.client.QueryRow(ctx, "SELECT 1").Scan()
}

func (s fixtureStatements) UpdateThing(ctx context.Context) error {
	_, err := s.client.Exec(ctx, "UPDATE")
	return err
}

func useMetrics(t *testing.T) sdkmetric.Reader {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	app, err := metrics.NewApplication(metrics.WithMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))))
	require.NoError(t, err)
	metrics.SetDefault(app)
	t.Cleanup(func() { metrics.SetDefault(nil) })
	return reader
}

func statementCounts(t *testing.T, reader sdkmetric.Reader) map[string]uint64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))
	out := map[string]uint64{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name != metrics.DBStatementDuration {
				continue
			}
			for _, p := range m.Data.(metricdata.Histogram[float64]).DataPoints {
				dialect, _ := p.Attributes.Value(metrics.DialectKey)
				assert.Equal(t, "postgres", dialect.AsString())
				name, _ := p.Attributes.Value(metrics.StatementKey)
				out[name.AsString()] += p.Count
			}
		}
	}
	return out
}

// Not run in parallel: it replaces the process-wide default Application.
func TestMeteredExecutor_namesTheStatement(t *testing.T) {
	reader := useMetrics(t)
	row := &scannedRow{}
	tx := meteredTx{rowTx{stubTx: &stubTx{}, row: row}}
	s := fixtureStatements{client: tx}

	require.NoError(t, s.UpdateThing(t.Context()))
	require.NoError(t, s.GetThing(t.Context()))
	assert.Equal(t, 1, row.scans)

	assert.Equal(t, map[string]uint64{
		"fixtureStatements.UpdateThing": 1,
		"fixtureStatements.GetThing":    1,
	}, statementCounts(t, reader))
}

// A QueryRow is only measured once its Scan has returned, because pgx reports
// the row's error there; a row that is never scanned is never measured.
func TestMeteredExecutor_queryRowEndsOnScan(t *testing.T) {
	reader := useMetrics(t)
	row := &scannedRow{}
	got := fixtureStatements{client: meteredTx{rowTx{stubTx: &stubTx{}, row: row}}}.client.QueryRow(t.Context(), "SELECT 1")

	assert.Empty(t, statementCounts(t, reader), "not yet scanned")
	require.NoError(t, got.Scan())
	assert.Equal(t, map[string]uint64{"unknown": 1}, statementCounts(t, reader))
}

// The statements of a transaction opened through the pool, and through a
// savepoint inside it, are measured as well: withTransaction hands them the tx
// that Begin returned.
func TestMeteredExecutor_beginReturnsMeteredTx(t *testing.T) {
	outer := meteredTx{&stubTx{}}

	nested, err := outer.Begin(t.Context())
	require.NoError(t, err)
	assert.IsType(t, meteredTx{}, nested)

	err = withTransaction(t.Context(), outer, func(ctx context.Context, tx queryExecutor) error {
		assert.IsType(t, meteredTx{}, tx)
		return nil
	})
	require.NoError(t, err)
}

// A pool connects lazily, so one that points nowhere still reports its
// connections, and stops when it is closed.
func TestPool_reportsConnections(t *testing.T) {
	reader := useMetrics(t)
	dialect, err := DecodeConfig("postgres://user:pass@localhost:1/dbname?sslmode=disable")
	require.NoError(t, err)
	pool, err := dialect.Connect(t.Context())
	require.NoError(t, err)

	states := func() map[string]int64 {
		var rm metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(t.Context(), &rm))
		out := map[string]int64{}
		for _, scope := range rm.ScopeMetrics {
			for _, m := range scope.Metrics {
				if m.Name != metrics.DBPoolConnections {
					continue
				}
				for _, p := range m.Data.(metricdata.Sum[int64]).DataPoints {
					dialect, _ := p.Attributes.Value(metrics.DialectKey)
					assert.Equal(t, "postgres", dialect.AsString())
					state, _ := p.Attributes.Value(metrics.StateKey)
					out[state.AsString()] = p.Value
				}
			}
		}
		return out
	}

	assert.Equal(t, map[string]int64{"in_use": 0, "idle": 0}, states())
	require.NoError(t, pool.Close(t.Context()))
	assert.Empty(t, states())
}
