package metrics

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// durationBuckets are the histogram boundaries every duration instrument
// uses, in seconds: from a cached lookup to a hung statement.
var durationBuckets = []float64{
	0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
}

// The catalogue's instruments are created once, from the global meter, the
// way the tracers are: the global delegate binds them to whatever provider
// the server installs, and until one is installed (or when none has a
// reader) each instrument reports itself disabled and records nothing. That
// is what lets a storage statement or a service method record without being
// handed a provider, and what keeps a test free of a meter it never asked
// for.
var global = mustInstruments(otel.Meter(ScopeName))

// instruments is one set of the catalogue's instruments on one meter.
type instruments struct {
	meter metric.Meter

	operationDuration metric.Float64Histogram
	connectionCount   metric.Int64ObservableUpDownCounter
	connectionMax     metric.Int64ObservableUpDownCounter

	credentialDuration metric.Float64Histogram
	revocationChecks   metric.Int64Counter
	passwordDuration   metric.Float64Histogram
	authOutcomes       metric.Int64Counter
	keyChainDuration   metric.Float64Histogram
	flowTransitions    metric.Int64Counter
	auditDuration      metric.Float64Histogram
	auditEvents        metric.Int64Counter
}

func mustInstruments(m metric.Meter) *instruments {
	in, err := newInstruments(m)
	if err != nil {
		// Names and units are constants, so this is a programming error a
		// test catches before it ships, not a condition to handle.
		panic(fmt.Sprintf("metrics: create instruments: %v", err))
	}
	return in
}

// newInstruments creates the catalogue's instruments on m, described as the
// catalogue describes them, so the catalogue stays the one place a
// description is written.
func newInstruments(m metric.Meter) (*instruments, error) {
	described := map[string]string{}
	for _, in := range Catalogue() {
		described[in.Name] = in.Description
	}
	var err error
	duration := func(name string) metric.Float64Histogram {
		var h metric.Float64Histogram
		if err != nil {
			return h
		}
		h, err = m.Float64Histogram(name,
			metric.WithUnit("s"),
			metric.WithDescription(described[name]),
			metric.WithExplicitBucketBoundaries(durationBuckets...))
		return h
	}
	counter := func(name, unit string) metric.Int64Counter {
		var c metric.Int64Counter
		if err != nil {
			return c
		}
		c, err = m.Int64Counter(name, metric.WithUnit(unit), metric.WithDescription(described[name]))
		return c
	}
	observable := func(name, unit string) metric.Int64ObservableUpDownCounter {
		var c metric.Int64ObservableUpDownCounter
		if err != nil {
			return c
		}
		c, err = m.Int64ObservableUpDownCounter(name, metric.WithUnit(unit), metric.WithDescription(described[name]))
		return c
	}

	in := &instruments{
		meter:              m,
		operationDuration:  duration(DBOperationDuration),
		connectionCount:    observable(DBConnectionCount, "{connection}"),
		connectionMax:      observable(DBConnectionMax, "{connection}"),
		credentialDuration: duration(CredentialValidationDuration),
		revocationChecks:   counter(TokenRevocationChecks, "{check}"),
		passwordDuration:   duration(PasswordVerificationDuration),
		authOutcomes:       counter(AuthAttemptOutcomes, "{proof}"),
		keyChainDuration:   duration(KeyChainResolutionDuration),
		flowTransitions:    counter(FlowStepTransitions, "{transition}"),
		auditDuration:      duration(AuditInsertDuration),
		auditEvents:        counter(AuditEventsWritten, "{event}"),
	}
	if err != nil {
		return nil, err
	}
	return in, nil
}

// closedOptions holds one prebuilt measurement option per value of a closed
// set, so recording a closed value allocates nothing. A value outside the set
// is still recorded as itself: the set is a typed constant, so a stray value
// is a programming error, and the SDK's cardinality limit bounds the damage.
type closedOptions[T ~string] struct {
	key   attribute.Key
	built map[T]metric.MeasurementOption
}

func closed[T ~string](key attribute.Key, vals ...T) closedOptions[T] {
	built := make(map[T]metric.MeasurementOption, len(vals))
	for _, v := range vals {
		built[v] = metric.WithAttributes(key.String(string(v)))
	}
	return closedOptions[T]{key: key, built: built}
}

func (o closedOptions[T]) of(v T) metric.MeasurementOption {
	if opt, ok := o.built[v]; ok {
		return opt
	}
	return metric.WithAttributes(o.key.String(string(v)))
}

var (
	credentialResults = closed(ResultKey, CredentialValid, CredentialRevoked, CredentialInvalid, CredentialError)
	revocationResults = closed(ResultKey, RevocationActive, RevocationRevoked, RevocationError)
	passwordResults   = closed(ResultKey, PasswordMatch, PasswordMismatch, PasswordError)
	keyKinds          = closed(KeyKindKey, KeyKindMaster, KeyKindProject)
	auditSources      = closed(SourceKey, AuditRequest, AuditEvent)
)

// StatementEnabled reports whether a statement duration recorded now would
// go anywhere. It is false until the server installs a meter provider with a
// reader, so the caller can skip the work of naming the statement when nobody
// is collecting.
func StatementEnabled(ctx context.Context) bool {
	return global.operationDuration.Enabled(ctx)
}

// RecordStatement records the duration of one storage statement call. The
// summary is the statement method that issued it, as `type.Method`; it is a
// name fixed in code, never anything from the statement's arguments.
func RecordStatement(ctx context.Context, system DBSystem, summary string, d time.Duration) {
	global.operationDuration.Record(ctx, d.Seconds(), metric.WithAttributes(
		DBSystemNameKey.String(string(system)),
		DBQuerySummaryKey.String(summary),
	))
}

// PoolStats is one reading of a connection pool: the connections handed out,
// the ones open but idle, and the most the pool will open.
type PoolStats struct {
	Used int
	Idle int
	Max  int
}

// RegisterPool reports the pool called name through the connection
// instruments, reading stats when the collector asks rather than on every
// acquire. The returned func stops the reporting; call it when the pool
// closes, so a pool that is gone does not keep reporting its last reading.
func RegisterPool(name PoolName, stats func() PoolStats) (unregister func() error, err error) {
	pool := DBConnectionPoolKey.String(string(name))
	idle := metric.WithAttributes(pool, DBConnectionStateKey.String(string(PoolIdle)))
	used := metric.WithAttributes(pool, DBConnectionStateKey.String(string(PoolUsed)))
	limit := metric.WithAttributes(pool)

	registration, err := global.meter.RegisterCallback(
		func(_ context.Context, observer metric.Observer) error {
			s := stats()
			observer.ObserveInt64(global.connectionCount, int64(s.Idle), idle)
			observer.ObserveInt64(global.connectionCount, int64(s.Used), used)
			observer.ObserveInt64(global.connectionMax, int64(s.Max), limit)
			return nil
		},
		global.connectionCount, global.connectionMax,
	)
	if err != nil {
		return nil, err
	}
	return registration.Unregister, nil
}

// RecordCredentialValidation records the duration of validating one bearer
// credential, with its outcome.
func RecordCredentialValidation(ctx context.Context, result CredentialResult, d time.Duration) {
	global.credentialDuration.Record(ctx, d.Seconds(), credentialResults.of(result))
}

// RecordRevocationCheck counts one token record lookup, with its outcome.
func RecordRevocationCheck(ctx context.Context, result RevocationResult) {
	global.revocationChecks.Add(ctx, 1, revocationResults.of(result))
}

// RecordPasswordVerification records the duration of verifying one password
// against its hash, with its outcome.
func RecordPasswordVerification(ctx context.Context, result PasswordResult, d time.Duration) {
	global.passwordDuration.Record(ctx, d.Seconds(), passwordResults.of(result))
}

// RecordAuthOutcome counts one verified authentication proof, by the kind of
// proof and its outcome.
func RecordAuthOutcome(ctx context.Context, check AuthCheck, result AuthResult) {
	global.authOutcomes.Add(ctx, 1, metric.WithAttributes(
		CheckKey.String(string(check)),
		ResultKey.String(string(result)),
	))
}

// RecordKeyChainResolution records the duration of unwrapping one key that
// was not cached, by what wraps it.
func RecordKeyChainResolution(ctx context.Context, kind KeyKind, d time.Duration) {
	global.keyChainDuration.Record(ctx, d.Seconds(), keyKinds.of(kind))
}

// RecordFlowTransition counts one flow engine operation and where it left
// the flow.
func RecordFlowTransition(ctx context.Context, op FlowOperation, result FlowResult) {
	global.flowTransitions.Add(ctx, 1, metric.WithAttributes(
		OperationKey.String(string(op)),
		ResultKey.String(string(result)),
	))
}

// RecordAuditInsert records the duration of one audit insert, by the route
// it took into storage.
func RecordAuditInsert(ctx context.Context, source AuditSource, d time.Duration) {
	global.auditDuration.Record(ctx, d.Seconds(), auditSources.of(source))
}

// RecordAuditEvents counts n audit events of one type handed to storage. A
// count of zero or less records nothing, so a caller can pass what a batch
// held without checking.
func RecordAuditEvents(ctx context.Context, eventType string, n int) {
	if n <= 0 {
		return
	}
	global.auditEvents.Add(ctx, int64(n), metric.WithAttributes(EventTypeKey.String(eventType)))
}
