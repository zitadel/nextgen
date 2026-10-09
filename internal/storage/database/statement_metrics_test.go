package database

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

func TestMethodName(t *testing.T) {
	t.Parallel()
	const pkg = "github.com/zitadel/nextgen/internal/storage/dialect/postgres."
	tests := []struct {
		function string
		want     string
	}{
		{pkg + "(*tokenStatements).GetTokenByID", "tokenStatements.GetTokenByID"},
		{pkg + "tokenStatements.GetTokenByID", "tokenStatements.GetTokenByID"},
		{pkg + "(*tokenStatements).GetTokenByID.func1", "tokenStatements.GetTokenByID"},
		{pkg + "(*userStatements).CreateUser.func1.2", "userStatements.CreateUser"},
		// A closure of an inlined method carries the name of the function it was inlined into.
		{pkg + "Caller.(*userStatements).CreateUser.func1", "userStatements.CreateUser"},
		{pkg + "execAffected", ""},
		{pkg + "tracedExecutor.Exec", ""},
		{pkg + "db.Exec", ""},
		{"database/sql.(*DB).ExecContext", ""},
		{"runtime.goexit", ""},
		{"main", ""},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, methodName(tt.function), tt.function)
	}
}

type fakeStatements struct{}

func (fakeStatements) GetThing(ctx context.Context, exec func(context.Context)) { exec(ctx) }

//go:noinline
func (s *fakeStatements) Closure(ctx context.Context, exec func(context.Context)) {
	func() { exec(ctx) }()
}

// helper has no receiver, as the dialects' execAffected does: the statement is
// the method that called it.
func helper(ctx context.Context, exec func(context.Context)) { exec(ctx) }

func (fakeStatements) ViaHelper(ctx context.Context, exec func(context.Context)) {
	helper(ctx, exec)
}

// leaf stands for an executor: it is the code that calls ObserveStatement.
func leaf(ctx context.Context) {
	defer ObserveStatement(ctx, metrics.DialectSQLite).Done()
}

// Not run in parallel: it replaces the process-wide default Application.
func TestObserveStatement(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	app, err := metrics.NewApplication(metrics.WithMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))))
	require.NoError(t, err)
	metrics.SetDefault(app)
	t.Cleanup(func() { metrics.SetDefault(nil) })

	ctx := t.Context()
	var s fakeStatements
	s.GetThing(ctx, leaf)
	s.GetThing(ctx, leaf)
	s.Closure(ctx, leaf)
	s.ViaHelper(ctx, leaf)
	leaf(ctx) // issued by no statement method

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(ctx, &rm))
	counts := map[string]uint64{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			require.Equal(t, metrics.DBStatementDuration, m.Name)
			for _, p := range m.Data.(metricdata.Histogram[float64]).DataPoints {
				name, _ := p.Attributes.Value(metrics.StatementKey)
				dialect, _ := p.Attributes.Value(metrics.DialectKey)
				assert.Equal(t, "sqlite", dialect.AsString())
				counts[name.AsString()] += p.Count
			}
		}
	}
	assert.Equal(t, map[string]uint64{
		"fakeStatements.GetThing":  2,
		"fakeStatements.Closure":   1,
		"fakeStatements.ViaHelper": 1,
		unknownStatement:           1,
	}, counts)
}

func TestObserveStatement_inertByDefault(t *testing.T) {
	// The default Application records nothing, so the timer is the zero value
	// and walks no stack.
	assert.Equal(t, StatementTimer{}, ObserveStatement(t.Context(), metrics.DialectSQLite))
	StatementTimer{}.Done()
}

// The cost a statement pays for being measured: the stack capture and name
// lookup (after the first call from a site), and the record.
func BenchmarkObserveStatement(b *testing.B) {
	run := func(b *testing.B) {
		var s fakeStatements
		ctx := b.Context()
		for b.Loop() {
			s.GetThing(ctx, leaf)
		}
	}
	b.Run("inert", run)
	// What a server with no metric exporter configured pays: a provider
	// without a reader, which the Application cannot tell from a real one.
	b.Run("no reader", func(b *testing.B) {
		app, err := metrics.NewApplication(metrics.WithMeterProvider(sdkmetric.NewMeterProvider()))
		require.NoError(b, err)
		metrics.SetDefault(app)
		b.Cleanup(func() { metrics.SetDefault(nil) })
		run(b)
	})
	b.Run("recording", func(b *testing.B) {
		app, err := metrics.NewApplication(metrics.WithMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewManualReader()))))
		require.NoError(b, err)
		metrics.SetDefault(app)
		b.Cleanup(func() { metrics.SetDefault(nil) })
		run(b)
	})
}
