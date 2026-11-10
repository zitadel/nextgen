package metrics_test

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics/metricstest"
)

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
	metrics.RecordPasswordVerification(ctx, metrics.PasswordLogin, metrics.PasswordMatch, time.Millisecond)
	metrics.RecordAuthOutcome(ctx, metrics.CheckPassword, metrics.AuthSuccess)
	metrics.RecordKeyChainResolution(ctx, metrics.KeyKindMaster, time.Millisecond)
	metrics.RecordFlowTransition(ctx, metrics.FlowSubmit, metrics.FlowStep)
	metrics.RecordAuditInsert(ctx, metrics.AuditEvent, time.Millisecond)
	metrics.RecordAuditEvents(ctx, "auth.token.revoked", 1)
	unregister := metrics.RegisterPool(metrics.PoolSQLite, func() metrics.PoolStats {
		return metrics.PoolStats{Used: 1, Idle: 2, Max: 3}
	})
	defer func() { require.NoError(t, unregister()) }()

	// The cache instruments are injected rather than global; report them on
	// the same provider so the whole catalogue is read back at once.
	cache, err := metrics.NewCache("probe", func() int { return 1 },
		metrics.WithMeterProvider(otel.GetMeterProvider()))
	require.NoError(t, err)
	cache.RecordLookup(true)
	cache.RecordAdd(true)

	got := metricstest.Instruments(reader.Collect(t))
	catalogued := map[string]bool{}
	for _, in := range metrics.Catalogue() {
		catalogued[in.Name] = true
		r, ok := got[in.Name]
		if !assert.True(t, ok, "%s is catalogued but was not recorded", in.Name) {
			continue
		}
		assert.Equal(t, metrics.ScopeName, r.Scope, "%s: scope", in.Name)
		assert.Equal(t, in.Description, r.Description, "%s: description", in.Name)
		assert.Equal(t, in.Unit, r.Unit, "%s: unit", in.Name)
		assert.Equal(t, in.Kind, r.Kind, "%s: kind", in.Name)
		assert.ElementsMatch(t, in.AttributeKeys(), r.Keys, "%s: attribute keys", in.Name)
	}
	for name, r := range got {
		if r.Scope == metrics.ScopeName {
			assert.True(t, catalogued[name], "%s was recorded but is not in the catalogue", name)
		}
	}
}

// A pool reports its reading when the collector asks and stops when it is
// unregistered, so a closed pool does not keep reporting its last reading.
func TestRegisterPool_ReportsUntilUnregistered(t *testing.T) {
	reader := metricstest.Install()
	stats := metrics.PoolStats{Used: 4, Idle: 6, Max: 10}
	unregister := metrics.RegisterPool(metrics.PoolPostgres, func() metrics.PoolStats { return stats })

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
	before := reader.CounterSum(t, metrics.AuditEventsWritten, eventType)
	metrics.RecordAuditEvents(t.Context(), "probe.nothing", 0)
	metrics.RecordAuditEvents(t.Context(), "probe.nothing", -1)
	assert.Equal(t, before, reader.CounterSum(t, metrics.AuditEventsWritten, eventType))
	metrics.RecordAuditEvents(t.Context(), "probe.nothing", 3)
	assert.Equal(t, before+3, reader.CounterSum(t, metrics.AuditEventsWritten, eventType))
}

// A closed-set record lands on exactly the value it was given, on a counter
// and on a histogram alike; this is also what proves the GrewOnly check the
// layers above test with.
func TestRecord_GrowsOnlyTheGivenValue(t *testing.T) {
	reader := metricstest.Install()

	revocations := metricstest.GrewOnly(t, reader, metrics.TokenRevocationChecks, nil,
		metrics.ResultKey, metrics.RevocationActive, metrics.RevocationRevoked, metrics.RevocationError)
	metrics.RecordRevocationCheck(t.Context(), metrics.RevocationRevoked)
	revocations(metrics.RevocationRevoked)

	login := metrics.PurposeKey.String(string(metrics.PasswordLogin))
	passwords := metricstest.GrewOnly(t, reader, metrics.PasswordVerificationDuration, []attribute.KeyValue{login},
		metrics.ResultKey, metrics.PasswordMatch, metrics.PasswordUpdated, metrics.PasswordMismatch, metrics.PasswordError)
	metrics.RecordPasswordVerification(t.Context(), metrics.PasswordHistory, metrics.PasswordMismatch, time.Millisecond)
	passwords("")
	metrics.RecordPasswordVerification(t.Context(), metrics.PasswordLogin, metrics.PasswordUpdated, time.Millisecond)
	passwords(metrics.PasswordUpdated)
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
