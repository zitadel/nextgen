package metrics_test

import (
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics/metricstest"
)

// recorded is one instrument as the reader returned it.
type recorded struct {
	description string
	unit        string
	kind        metrics.Kind
	keys        []attribute.Key
}

// collectRecorded reads every instrument in the metrics scope back through
// the SDK, which is what proves the instruments were registered with the
// names, units and descriptions the catalogue promises.
func collectRecorded(t *testing.T, reader *metricstest.Reader) map[string]recorded {
	t.Helper()
	out := map[string]recorded{}
	for _, scope := range reader.Collect(t).ScopeMetrics {
		if scope.Scope.Name != metrics.ScopeName {
			continue
		}
		for _, m := range scope.Metrics {
			r := recorded{description: m.Description, unit: m.Unit}
			var sets []attribute.Set
			switch data := m.Data.(type) {
			case metricdata.Histogram[float64]:
				r.kind = metrics.KindHistogram
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			case metricdata.Sum[int64]:
				r.kind = metrics.KindCounter
				if !data.IsMonotonic {
					r.kind = metrics.KindUpDownCounter
				}
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			case metricdata.Gauge[int64]:
				r.kind = metrics.KindGauge
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			default:
				t.Fatalf("instrument %s: unexpected data %T", m.Name, m.Data)
			}
			for _, set := range sets {
				for _, kv := range set.ToSlice() {
					if !slices.Contains(r.keys, kv.Key) {
						r.keys = append(r.keys, kv.Key)
					}
				}
			}
			out[m.Name] = r
		}
	}
	return out
}

// Every instrument the package records is in the catalogue, and the catalogue
// describes it as recorded: same name, unit, kind and attribute keys. The
// documentation and the metric views are built from the catalogue, so an
// instrument that drifts from it is one nobody can find or that loses its
// attributes.
func TestCatalogue_MatchesWhatIsRecorded(t *testing.T) {
	reader := metricstest.Install()
	ctx := t.Context()

	metrics.RecordStatement(ctx, metrics.DBSystemSQLite, "tokenStatements.GetTokenByID", time.Millisecond)
	metrics.RecordCredentialValidation(ctx, metrics.CredentialValid, time.Millisecond)
	metrics.RecordRevocationCheck(ctx, metrics.RevocationActive)
	metrics.RecordPasswordVerification(ctx, metrics.PasswordMatch, time.Millisecond)
	metrics.RecordAuthOutcome(ctx, metrics.CheckPassword, metrics.AuthSuccess)
	metrics.RecordKeyChainResolution(ctx, metrics.KeyKindMaster, time.Millisecond)
	metrics.RecordFlowTransition(ctx, metrics.FlowSubmit, metrics.FlowStep)
	metrics.RecordAuditInsert(ctx, metrics.AuditEvent, time.Millisecond)
	metrics.RecordAuditEvents(ctx, "auth.token.revoked", 1)
	unregister, err := metrics.RegisterPool(metrics.PoolSQLite, func() metrics.PoolStats {
		return metrics.PoolStats{Used: 1, Idle: 2, Max: 3}
	})
	require.NoError(t, err)
	defer func() { require.NoError(t, unregister()) }()

	// The cache instruments are injected rather than global; report them on
	// the same provider so the whole catalogue is read back at once.
	cache, err := metrics.NewCache("probe", func() int { return 1 },
		metrics.WithMeterProvider(otel.GetMeterProvider()))
	require.NoError(t, err)
	cache.RecordLookup(true)
	cache.RecordAdd(true)

	got := collectRecorded(t, reader)
	catalogued := map[string]bool{}
	for _, in := range metrics.Catalogue() {
		catalogued[in.Name] = true
		r, ok := got[in.Name]
		if !assert.True(t, ok, "%s is catalogued but was not recorded", in.Name) {
			continue
		}
		assert.Equal(t, in.Description, r.description, "%s: description", in.Name)
		assert.Equal(t, in.Unit, r.unit, "%s: unit", in.Name)
		assert.Equal(t, in.Kind, r.kind, "%s: kind", in.Name)
		assert.ElementsMatch(t, in.AttributeKeys(), r.keys, "%s: attribute keys", in.Name)
	}
	for name := range got {
		assert.True(t, catalogued[name], "%s was recorded but is not in the catalogue", name)
	}
}

// A pool reports its reading when the collector asks and stops when it is
// unregistered, so a closed pool does not keep reporting its last reading.
func TestRegisterPool_ReportsUntilUnregistered(t *testing.T) {
	reader := metricstest.Install()
	stats := metrics.PoolStats{Used: 4, Idle: 6, Max: 10}
	unregister, err := metrics.RegisterPool(metrics.PoolPostgres, func() metrics.PoolStats { return stats })
	require.NoError(t, err)

	pool := metrics.DBConnectionPoolKey.String(string(metrics.PoolPostgres))
	used := metrics.DBConnectionStateKey.String(string(metrics.PoolUsed))
	idle := metrics.DBConnectionStateKey.String(string(metrics.PoolIdle))
	assert.Equal(t, int64(4), reader.CounterSum(t, metrics.DBConnectionCount, pool, used))
	assert.Equal(t, int64(6), reader.CounterSum(t, metrics.DBConnectionCount, pool, idle))
	assert.Equal(t, int64(10), reader.CounterSum(t, metrics.DBConnectionMax, pool))

	stats = metrics.PoolStats{Used: 1, Idle: 9, Max: 10}
	assert.Equal(t, int64(1), reader.CounterSum(t, metrics.DBConnectionCount, pool, used),
		"the reading is taken at collection, not at registration")

	require.NoError(t, unregister())
	assert.Equal(t, int64(0), reader.CounterSum(t, metrics.DBConnectionCount, pool, used))
	assert.Equal(t, int64(0), reader.CounterSum(t, metrics.DBConnectionMax, pool))
}

// A batch that held no events of a type records nothing, so a caller can
// pass counts straight from a tally.
func TestRecordAuditEvents_IgnoresNothing(t *testing.T) {
	reader := metricstest.Install()
	eventType := metrics.EventTypeKey.String("probe.nothing")
	metrics.RecordAuditEvents(t.Context(), "probe.nothing", 0)
	metrics.RecordAuditEvents(t.Context(), "probe.nothing", -1)
	assert.Equal(t, int64(0), reader.CounterSum(t, metrics.AuditEventsWritten, eventType))
	metrics.RecordAuditEvents(t.Context(), "probe.nothing", 3)
	assert.Equal(t, int64(3), reader.CounterSum(t, metrics.AuditEventsWritten, eventType))
}

// identifierLike matches an attribute key that would carry a user, project,
// session, token or request identity, or a request path.
var identifierLike = regexp.MustCompile(`(^|[._])id$|_id([._]|$)|user|project|session|token|path|target|^url\.`)

// No attribute may follow the data: a series is created per distinct value
// and lives for the life of the process.
func TestCatalogue_AttributesNeverIdentify(t *testing.T) {
	t.Parallel()
	for _, in := range metrics.Catalogue() {
		assert.NotEmpty(t, in.Description, "%s has no description", in.Name)
		for _, a := range in.Attributes {
			assert.NotEmpty(t, a.Description, "%s: attribute %s has no description", in.Name, a.Key)
			assert.False(t, identifierLike.MatchString(strings.ToLower(string(a.Key))),
				"%s: attribute %s looks like an identifier", in.Name, a.Key)
		}
	}
}

// The closed sets a dashboard is written against are the typed constants the
// recording API takes, so a value the code can record is one the catalogue
// (and so the documentation) lists.
func TestCatalogue_ClosedValuesAreTheConstants(t *testing.T) {
	t.Parallel()
	want := map[string]map[attribute.Key][]string{
		metrics.DBOperationDuration: {
			metrics.DBSystemNameKey: {string(metrics.DBSystemPostgreSQL), string(metrics.DBSystemSQLite), string(metrics.DBSystemSpanner)},
		},
		metrics.DBConnectionCount: {
			metrics.DBConnectionPoolKey:  {string(metrics.PoolPostgres), string(metrics.PoolSQLite)},
			metrics.DBConnectionStateKey: {string(metrics.PoolIdle), string(metrics.PoolUsed)},
		},
		metrics.DBConnectionMax: {
			metrics.DBConnectionPoolKey: {string(metrics.PoolPostgres), string(metrics.PoolSQLite)},
		},
		metrics.CredentialValidationDuration: {
			metrics.ResultKey: {string(metrics.CredentialValid), string(metrics.CredentialRevoked), string(metrics.CredentialInvalid), string(metrics.CredentialError)},
		},
		metrics.TokenRevocationChecks: {
			metrics.ResultKey: {string(metrics.RevocationActive), string(metrics.RevocationRevoked), string(metrics.RevocationError)},
		},
		metrics.PasswordVerificationDuration: {
			metrics.ResultKey: {string(metrics.PasswordMatch), string(metrics.PasswordMismatch), string(metrics.PasswordError)},
		},
		metrics.AuthAttemptOutcomes: {
			metrics.CheckKey:  {string(metrics.CheckUser), string(metrics.CheckPassword), string(metrics.CheckPasskey), string(metrics.CheckPasskeyRegistration)},
			metrics.ResultKey: {string(metrics.AuthSuccess), string(metrics.AuthRejected), string(metrics.AuthError)},
		},
		metrics.KeyChainResolutionDuration: {
			metrics.KeyKindKey: {string(metrics.KeyKindMaster), string(metrics.KeyKindProject)},
		},
		metrics.FlowStepTransitions: {
			metrics.OperationKey: {string(metrics.FlowStart), string(metrics.FlowSubmit), string(metrics.FlowRender)},
			metrics.ResultKey:    {string(metrics.FlowStep), string(metrics.FlowComplete), string(metrics.FlowFailed)},
		},
		metrics.AuditInsertDuration: {
			metrics.SourceKey: {string(metrics.AuditRequest), string(metrics.AuditEvent)},
		},
		metrics.CacheLookups: {
			metrics.ResultKey: {"hit", "miss"},
		},
	}
	for _, in := range metrics.Catalogue() {
		for _, a := range in.Attributes {
			values := want[in.Name][a.Key]
			assert.Equal(t, values, a.Values, "%s: values of %s", in.Name, a.Key)
			assert.Equal(t, len(values) > 0, a.Closed(), "%s: %s closed", in.Name, a.Key)
		}
	}
}
