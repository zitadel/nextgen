package metrics_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// series is what one instrument produced: the attribute sets of its data points.
type series struct {
	unit string
	kind metrics.Kind
	sets []attribute.Set
}

func (s series) keys() map[attribute.Key]bool {
	keys := map[attribute.Key]bool{}
	for _, set := range s.sets {
		for _, kv := range set.ToSlice() {
			keys[kv.Key] = true
		}
	}
	return keys
}

func (s series) values(key attribute.Key) []string {
	var out []string
	for _, set := range s.sets {
		if v, ok := set.Value(key); ok {
			out = append(out, v.AsString())
		}
	}
	return out
}

// collect reads every instrument back through a real SDK reader. That is what
// proves an instrument was registered and recorded with the attributes it
// claims, rather than that a call compiled.
func collectSeries(t *testing.T, reader sdkmetric.Reader) map[string]series {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))

	out := map[string]series{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			s := series{unit: m.Unit}
			switch data := m.Data.(type) {
			case metricdata.Histogram[float64]:
				s.kind = metrics.KindHistogram
				for _, p := range data.DataPoints {
					s.sets = append(s.sets, p.Attributes)
				}
			case metricdata.Sum[int64]:
				s.kind = metrics.KindCounter
				if !data.IsMonotonic {
					s.kind = metrics.KindUpDownCounter
				}
				for _, p := range data.DataPoints {
					s.sets = append(s.sets, p.Attributes)
				}
			case metricdata.Gauge[int64]:
				s.kind = metrics.KindGauge
				for _, p := range data.DataPoints {
					s.sets = append(s.sets, p.Attributes)
				}
			default:
				t.Fatalf("instrument %s: unexpected data %T", m.Name, m.Data)
			}
			out[m.Name] = s
		}
	}
	return out
}

func newApplication(t *testing.T) (*metrics.Application, sdkmetric.Reader) {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	app, err := metrics.NewApplication(metrics.WithMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))))
	require.NoError(t, err)
	return app, reader
}

// recordOne drives every method of the Application once.
func recordOne(t *testing.T, app *metrics.Application) {
	t.Helper()
	ctx := t.Context()
	app.RecordStatement(ctx, metrics.DialectSQLite, "tokenStatements.GetTokenByID", time.Millisecond)
	app.RecordCredentialValidation(ctx, metrics.CredentialValid, time.Millisecond)
	app.RecordPasswordVerification(ctx, metrics.PasswordMatch, time.Millisecond)
	app.RecordKeyChainResolution(ctx, metrics.KEKMaster, time.Millisecond)
	app.RecordAuditInsert(ctx, metrics.AuditEvent, time.Millisecond)
	app.RecordAuthOutcome(ctx, metrics.CheckPassword, metrics.AuthSuccess)
	app.RecordRevocationCheck(ctx, metrics.RevocationActive)
	app.RecordFlowTransition(ctx, metrics.FlowSubmit, metrics.FlowStep)
	app.RecordAuditEvents(ctx, "auth.token.revoked", 1)
	t.Cleanup(app.RegisterPool(metrics.DialectSQLite, func() metrics.PoolStats { return metrics.PoolStats{InUse: 1, Idle: 2} }))
}

// Every instrument an Application creates is in the catalogue, with the unit,
// kind and attribute keys the catalogue documents, and nothing in the
// catalogue is missing -- the cache instruments excepted, which NewCache owns.
// The documentation is generated from the catalogue, so this is also what
// keeps the documentation true.
func TestApplication_MatchesCatalogue(t *testing.T) {
	app, reader := newApplication(t)
	recordOne(t, app)
	got := collectSeries(t, reader)

	catalogued := map[string]metrics.Instrument{}
	for _, in := range metrics.Catalogue() {
		catalogued[in.Name] = in
	}

	for name, s := range got {
		in, ok := catalogued[name]
		require.True(t, ok, "instrument %s is not in the catalogue", name)
		assert.Equal(t, in.Unit, s.unit, "%s unit", name)
		assert.Equal(t, in.Kind, s.kind, "%s kind", name)

		var declared []string
		for _, k := range in.AttributeKeys() {
			declared = append(declared, string(k))
		}
		for key := range s.keys() {
			assert.Contains(t, declared, string(key), "%s carries attribute %q that the catalogue does not declare", name, key)
		}
	}
	for name := range catalogued {
		if strings.HasPrefix(name, "zitadel.cache.") {
			continue
		}
		assert.Contains(t, got, name, "catalogued instrument %s was never created", name)
	}
}

// The cache instruments are catalogued too, so they must say what they carry.
func TestCatalogue_CoversCacheInstruments(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	size := func() int { return 1 }
	c, err := metrics.NewCache("probe", size, metrics.WithMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))))
	require.NoError(t, err)
	c.RecordLookup(true)
	c.RecordAdd(true)

	catalogued := map[string]metrics.Instrument{}
	for _, in := range metrics.Catalogue() {
		catalogued[in.Name] = in
	}
	got := collectSeries(t, reader)
	require.Len(t, got, 3)
	for name, s := range got {
		in, ok := catalogued[name]
		require.True(t, ok, "instrument %s is not in the catalogue", name)
		assert.Equal(t, in.Unit, s.unit, "%s unit", name)
		assert.Equal(t, in.Kind, s.kind, "%s kind", name)
		for key := range s.keys() {
			assert.Contains(t, in.AttributeKeys(), key, "%s", name)
		}
	}
}

// The attributes themselves are the safety property: none may name a user, a
// project or a request, and a closed attribute must list its values.
func TestCatalogue_AttributesAreBounded(t *testing.T) {
	forbidden := []string{"id", "user", "project", "session", "token", "flow", "request", "email", "ip", "agent", "url", "target", "path", "name"}
	seen := map[string]bool{}
	for _, in := range metrics.Catalogue() {
		assert.True(t, strings.HasPrefix(in.Name, "zitadel."), "%s", in.Name)
		assert.False(t, seen[in.Name], "%s is declared twice", in.Name)
		seen[in.Name] = true
		assert.NotEmpty(t, in.Description, "%s", in.Name)

		for _, a := range in.Attributes {
			assert.NotEmpty(t, a.Description, "%s %s", in.Name, a.Key)
			for _, f := range forbidden {
				for part := range strings.SplitSeq(string(a.Key), "_") {
					assert.NotEqual(t, f, part, "%s: attribute %q looks like it identifies a resource", in.Name, a.Key)
				}
			}
			assert.False(t, slices.Contains(a.Values, metrics.OtherValue), "%s %s: %q is reserved", in.Name, a.Key, metrics.OtherValue)
		}
	}
}

// A value that is not in a closed set is reported as "other", whatever type it
// travelled in. The conversions below are what a caller feeding an id into one
// of these parameters would write.
func TestApplication_ClosedAttributesRejectUnknownValues(t *testing.T) {
	app, reader := newApplication(t)
	ctx := t.Context()

	for i := range 5000 {
		id := fmt.Sprintf("usr_%d", i)
		app.RecordStatement(ctx, metrics.Dialect(id), "tokenStatements.GetTokenByID", time.Millisecond)
		app.RecordCredentialValidation(ctx, metrics.CredentialResult(id), time.Millisecond)
		app.RecordPasswordVerification(ctx, metrics.PasswordResult(id), time.Millisecond)
		app.RecordKeyChainResolution(ctx, metrics.KEK(id), time.Millisecond)
		app.RecordAuditInsert(ctx, metrics.AuditSource(id), time.Millisecond)
		app.RecordAuthOutcome(ctx, metrics.AuthCheck(id), metrics.AuthResult(id))
		app.RecordRevocationCheck(ctx, metrics.RevocationResult(id))
		app.RecordFlowTransition(ctx, metrics.FlowOperation(id), metrics.FlowResult(id))
	}
	unregister := app.RegisterPool(metrics.Dialect("usr_1"), func() metrics.PoolStats { return metrics.PoolStats{} })
	defer unregister()

	got := collectSeries(t, reader)
	catalogued := map[string]metrics.Instrument{}
	for _, in := range metrics.Catalogue() {
		catalogued[in.Name] = in
	}
	for name, s := range got {
		for _, a := range catalogued[name].Attributes {
			if !a.Closed() {
				continue
			}
			for _, v := range s.values(a.Key) {
				assert.Contains(t, append(slices.Clone(a.Values), metrics.OtherValue), v, "%s %s", name, a.Key)
			}
		}
		// One value per closed attribute, plus "other": at most
		// (|values|+1) per attribute, multiplied out.
		bound := 1
		for _, a := range catalogued[name].Attributes {
			if a.Closed() {
				bound *= len(a.Values) + 1
			} else {
				bound *= metrics.MaxOpenValues + 1
			}
		}
		assert.LessOrEqual(t, len(s.sets), bound, "%s series", name)
		want := 1
		if name == metrics.DBPoolConnections {
			want = 2 // the dialect is "other", and in_use and idle are both valid states
		}
		assert.Len(t, s.sets, want, "%s: every invalid value must land in the same series", name)
	}
}

// Open attributes take names fixed in code. If one ever receives something
// request-shaped, it costs a bounded number of series.
func TestApplication_OpenAttributesAreCapped(t *testing.T) {
	app, reader := newApplication(t)
	ctx := t.Context()

	for i := range 20_000 {
		app.RecordStatement(ctx, metrics.DialectPostgres, fmt.Sprintf("userStatements.Get_%d", i), time.Microsecond)
		app.RecordAuditEvents(ctx, fmt.Sprintf("user.%d.created", i), 1)
	}
	// A name admitted before the cap keeps being reported as itself.
	app.RecordStatement(ctx, metrics.DialectPostgres, "userStatements.Get_0", time.Microsecond)

	got := collectSeries(t, reader)
	for _, name := range []string{metrics.DBStatementDuration, metrics.AuditEventsWritten} {
		assert.Len(t, got[name].sets, metrics.MaxOpenValues+1, "%s: the cap plus the %q overflow", name, metrics.OtherValue)
	}
	assert.Contains(t, got[metrics.DBStatementDuration].values(metrics.StatementKey), "userStatements.Get_0")
	assert.Contains(t, got[metrics.DBStatementDuration].values(metrics.StatementKey), metrics.OtherValue)
	assert.NotContains(t, got[metrics.DBStatementDuration].values(metrics.StatementKey), "userStatements.Get_19999")
}

func TestApplication_PoolConnections(t *testing.T) {
	app, reader := newApplication(t)

	stats := metrics.PoolStats{InUse: 3, Idle: 4}
	unregister := app.RegisterPool(metrics.DialectPostgres, func() metrics.PoolStats { return stats })
	// A second pool of the same dialect adds to the first.
	other := app.RegisterPool(metrics.DialectPostgres, func() metrics.PoolStats { return metrics.PoolStats{InUse: 1} })

	read := func() map[string]int64 {
		out := map[string]int64{}
		var rm metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(t.Context(), &rm))
		for _, scope := range rm.ScopeMetrics {
			for _, m := range scope.Metrics {
				if m.Name != metrics.DBPoolConnections {
					continue
				}
				for _, p := range m.Data.(metricdata.Sum[int64]).DataPoints {
					d, _ := p.Attributes.Value(metrics.DialectKey)
					s, _ := p.Attributes.Value(metrics.StateKey)
					out[d.AsString()+"/"+s.AsString()] = p.Value
				}
			}
		}
		return out
	}

	assert.Equal(t, map[string]int64{"postgres/in_use": 4, "postgres/idle": 4}, read())

	stats = metrics.PoolStats{InUse: 0, Idle: 7}
	other()
	assert.Equal(t, map[string]int64{"postgres/in_use": 0, "postgres/idle": 7}, read(), "polled at collection, and an unregistered pool is gone")

	unregister()
	assert.Empty(t, read(), "no pool, no series")
}

// An Application nobody configured records nothing and never panics, which is
// what the default one is until the server sets its own.
func TestApplication_InertWithoutProvider(t *testing.T) {
	app, err := metrics.NewApplication()
	require.NoError(t, err)
	assert.False(t, app.Enabled())
	recordOne(t, app)

	var nilApp *metrics.Application
	assert.False(t, nilApp.Enabled())
	nilApp.RecordAuditEvents(t.Context(), "x", 1)

	assert.False(t, metrics.Default().Enabled())
}

func TestSetDefault(t *testing.T) {
	app, reader := newApplication(t)
	metrics.SetDefault(app)
	t.Cleanup(func() { metrics.SetDefault(nil) })

	require.True(t, metrics.Default().Enabled())
	metrics.Default().RecordRevocationCheck(t.Context(), metrics.RevocationRevoked)
	assert.Contains(t, collectSeries(t, reader), metrics.TokenRevocationChecks)

	metrics.SetDefault(nil)
	assert.False(t, metrics.Default().Enabled())
}
