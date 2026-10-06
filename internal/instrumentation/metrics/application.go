package metrics

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/metric"
)

// durationBuckets are explicit bucket boundaries, in seconds, for every
// duration histogram. The SDK default tops out at 10000 and starts at 0, which
// is shaped for milliseconds and would put a whole load test in its first
// bucket. These span a fast indexed read (100 us) to a stalled one (10 s).
var durationBuckets = []float64{
	0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
}

// Application is the instrument set that explains an application's behaviour
// rather than one component's: where a request's time went (storage, key
// resolution, credential and password checks, audit writes) and what its
// authentication and flow traffic looks like. Cache instruments are a separate
// set, built per cache by NewCache.
//
// The zero value is not usable; build it with NewApplication. An Application
// built without a meter provider, and the one Default returns before the server
// has set its own, are safe to call and record nothing.
//
// Every method takes only the closed types declared in catalogue.go, or a name
// that is fixed in code, and never an id: that is how the series count stays
// bounded. The catalogue lists what each instrument carries.
type Application struct {
	enabled bool

	statementDuration  metric.Float64Histogram
	credentialDuration metric.Float64Histogram
	passwordDuration   metric.Float64Histogram
	keyChainDuration   metric.Float64Histogram
	auditDuration      metric.Float64Histogram
	authOutcomes       metric.Int64Counter
	revocationChecks   metric.Int64Counter
	flowTransitions    metric.Int64Counter
	auditEvents        metric.Int64Counter
	poolConnections    metric.Int64ObservableUpDownCounter

	statements *openValues
	eventTypes *openValues

	poolsMu sync.Mutex
	pools   map[*poolRegistration]struct{}
}

// NewApplication builds the instruments. Without WithMeterProvider the result
// records nothing and Enabled reports false.
func NewApplication(opts ...Option) (*Application, error) {
	var resolved options
	for _, opt := range opts {
		opt(&resolved)
	}
	a := &Application{
		enabled:    resolved.provider != nil,
		statements: newOpenValues(MaxOpenValues),
		eventTypes: newOpenValues(MaxOpenValues),
		pools:      map[*poolRegistration]struct{}{},
	}
	if !a.enabled {
		return a, nil
	}
	m := meter(opts)

	// duration builds one histogram. The unit is what makes an exporter append
	// `_seconds` to the name, so it is not optional.
	duration := func(name, desc string) (metric.Float64Histogram, error) {
		return m.Float64Histogram(name,
			metric.WithUnit("s"),
			metric.WithDescription(desc),
			metric.WithExplicitBucketBoundaries(durationBuckets...))
	}
	counter := func(name, unit, desc string) (metric.Int64Counter, error) {
		return m.Int64Counter(name, metric.WithUnit(unit), metric.WithDescription(desc))
	}

	var err error
	described := descriptions()
	if a.statementDuration, err = duration(DBStatementDuration, described[DBStatementDuration]); err != nil {
		return nil, err
	}
	if a.credentialDuration, err = duration(CredentialValidationDuration, described[CredentialValidationDuration]); err != nil {
		return nil, err
	}
	if a.passwordDuration, err = duration(PasswordVerificationDuration, described[PasswordVerificationDuration]); err != nil {
		return nil, err
	}
	if a.keyChainDuration, err = duration(KeyChainResolutionDuration, described[KeyChainResolutionDuration]); err != nil {
		return nil, err
	}
	if a.auditDuration, err = duration(AuditInsertDuration, described[AuditInsertDuration]); err != nil {
		return nil, err
	}
	if a.authOutcomes, err = counter(AuthAttemptOutcomes, "{proof}", described[AuthAttemptOutcomes]); err != nil {
		return nil, err
	}
	if a.revocationChecks, err = counter(TokenRevocationChecks, "{check}", described[TokenRevocationChecks]); err != nil {
		return nil, err
	}
	if a.flowTransitions, err = counter(FlowStepTransitions, "{transition}", described[FlowStepTransitions]); err != nil {
		return nil, err
	}
	if a.auditEvents, err = counter(AuditEventsWritten, "{event}", described[AuditEventsWritten]); err != nil {
		return nil, err
	}
	if a.poolConnections, err = m.Int64ObservableUpDownCounter(DBPoolConnections,
		metric.WithUnit("{connection}"),
		metric.WithDescription(described[DBPoolConnections])); err != nil {
		return nil, err
	}
	if _, err = m.RegisterCallback(a.observePools, a.poolConnections); err != nil {
		return nil, err
	}
	return a, nil
}

// descriptions indexes the catalogue's descriptions, so an instrument and the
// documentation generated from the catalogue cannot say different things.
func descriptions() map[string]string {
	out := map[string]string{}
	for _, i := range Catalogue() {
		out[i.Name] = i.Description
	}
	return out
}

var defaultApplication atomic.Pointer[Application]

func init() {
	// The inert one, so Default never returns nil.
	a, _ := NewApplication()
	defaultApplication.Store(a)
}

// Default is the Application the server reports through. It is inert until
// SetDefault is called, which the server does once its meter provider exists.
// It is read on every call rather than captured, so a component built before
// the server finished starting up still reports once it has.
func Default() *Application { return defaultApplication.Load() }

// SetDefault replaces the Application that Default returns. A nil a restores
// the inert one.
func SetDefault(a *Application) {
	if a == nil {
		a, _ = NewApplication()
	}
	defaultApplication.Store(a)
}

// Enabled reports whether anything is recorded. Callers use it to skip work
// that exists only to build a measurement, such as resolving a statement name.
func (a *Application) Enabled() bool { return a != nil && a.enabled }

// RecordStatement records one storage statement call. statement is the
// statement method as `type.Method`.
func (a *Application) RecordStatement(ctx context.Context, dialect Dialect, statement string, d time.Duration) {
	if !a.Enabled() {
		return
	}
	a.statementDuration.Record(ctx, d.Seconds(), metric.WithAttributes(
		DialectKey.String(closed(dialect, DialectPostgres, DialectSQLite, DialectSpanner)),
		StatementKey.String(a.statements.value(statement)),
	))
}

// RecordCredentialValidation records one bearer credential validation.
func (a *Application) RecordCredentialValidation(ctx context.Context, result CredentialResult, d time.Duration) {
	if !a.Enabled() {
		return
	}
	a.credentialDuration.Record(ctx, d.Seconds(), metric.WithAttributes(
		ResultKey.String(closed(result, CredentialValid, CredentialRevoked, CredentialInvalid, CredentialError)),
	))
}

// RecordPasswordVerification records one password hash verification.
func (a *Application) RecordPasswordVerification(ctx context.Context, result PasswordResult, d time.Duration) {
	if !a.Enabled() {
		return
	}
	a.passwordDuration.Record(ctx, d.Seconds(), metric.WithAttributes(
		ResultKey.String(closed(result, PasswordMatch, PasswordMismatch, PasswordError)),
	))
}

// RecordKeyChainResolution records resolving one encryption key that was not
// cached.
func (a *Application) RecordKeyChainResolution(ctx context.Context, kek KEK, d time.Duration) {
	if !a.Enabled() {
		return
	}
	a.keyChainDuration.Record(ctx, d.Seconds(), metric.WithAttributes(
		KEKKey.String(closed(kek, KEKMaster, KEKProject)),
	))
}

// RecordAuditInsert records one audit insert.
func (a *Application) RecordAuditInsert(ctx context.Context, source AuditSource, d time.Duration) {
	if !a.Enabled() {
		return
	}
	a.auditDuration.Record(ctx, d.Seconds(), metric.WithAttributes(
		SourceKey.String(closed(source, AuditRequest, AuditEvent)),
	))
}

// RecordAuthOutcome counts one verified authentication proof.
func (a *Application) RecordAuthOutcome(ctx context.Context, check AuthCheck, result AuthResult) {
	if !a.Enabled() {
		return
	}
	a.authOutcomes.Add(ctx, 1, metric.WithAttributes(
		CheckKey.String(closed(check, CheckUser, CheckPassword, CheckPasskey, CheckPasskeyRegistration)),
		ResultKey.String(closed(result, AuthSuccess, AuthRejected, AuthError)),
	))
}

// RecordRevocationCheck counts one token record lookup.
func (a *Application) RecordRevocationCheck(ctx context.Context, result RevocationResult) {
	if !a.Enabled() {
		return
	}
	a.revocationChecks.Add(ctx, 1, metric.WithAttributes(
		ResultKey.String(closed(result, RevocationActive, RevocationRevoked, RevocationError)),
	))
}

// RecordFlowTransition counts one flow engine operation. Step names are
// defined per project, so they are not a parameter here.
func (a *Application) RecordFlowTransition(ctx context.Context, op FlowOperation, result FlowResult) {
	if !a.Enabled() {
		return
	}
	a.flowTransitions.Add(ctx, 1, metric.WithAttributes(
		OperationKey.String(closed(op, FlowStart, FlowSubmit, FlowRender)),
		ResultKey.String(closed(result, FlowStep, FlowComplete, FlowFailed)),
	))
}

// RecordAuditEvents counts n audit events of one type handed to storage.
func (a *Application) RecordAuditEvents(ctx context.Context, eventType string, n int) {
	if !a.Enabled() || n <= 0 {
		return
	}
	a.auditEvents.Add(ctx, int64(n), metric.WithAttributes(
		EventTypeKey.String(a.eventTypes.value(eventType)),
	))
}

// PoolStats is a snapshot of a connection pool.
type PoolStats struct {
	InUse int
	Idle  int
}

type poolRegistration struct {
	dialect Dialect
	stats   func() PoolStats
}

// RegisterPool reports a connection pool, reading its stats when the collector
// asks rather than on every checkout. Pools of one dialect add up. The returned
// func stops reporting the pool; call it when the pool closes.
func (a *Application) RegisterPool(dialect Dialect, stats func() PoolStats) (unregister func()) {
	if !a.Enabled() {
		return func() {}
	}
	reg := &poolRegistration{dialect: dialect, stats: stats}
	a.poolsMu.Lock()
	a.pools[reg] = struct{}{}
	a.poolsMu.Unlock()
	return func() {
		a.poolsMu.Lock()
		delete(a.pools, reg)
		a.poolsMu.Unlock()
	}
}

func (a *Application) observePools(_ context.Context, observer metric.Observer) error {
	type total struct{ inUse, idle int64 }
	totals := map[Dialect]total{}

	a.poolsMu.Lock()
	for reg := range a.pools {
		s := reg.stats()
		t := totals[reg.dialect]
		t.inUse += int64(s.InUse)
		t.idle += int64(s.Idle)
		totals[reg.dialect] = t
	}
	a.poolsMu.Unlock()

	for dialect, t := range totals {
		d := DialectKey.String(closed(dialect, DialectPostgres, DialectSQLite, DialectSpanner))
		observer.ObserveInt64(a.poolConnections, t.inUse, metric.WithAttributes(d, StateKey.String(string(PoolInUse))))
		observer.ObserveInt64(a.poolConnections, t.idle, metric.WithAttributes(d, StateKey.String(string(PoolIdle))))
	}
	return nil
}

// closed returns v when it is one of allowed, and OtherValue otherwise. This
// is what keeps a value that slipped past the type system (a conversion from
// a string) from becoming a series of its own.
func closed[T ~string](v T, allowed ...T) string {
	for _, a := range allowed {
		if v == a {
			return string(v)
		}
	}
	return OtherValue
}

// openValues admits the first limit distinct values it sees and maps every later
// one to OtherValue. The values it is given come from names fixed in code, so
// the cap is never reached in practice; it exists so that a bug that feeds it
// something request-shaped costs one series, not one per request.
type openValues struct {
	limit int
	seen  sync.Map // string -> struct{}
	n     atomic.Int64
}

func newOpenValues(limit int) *openValues { return &openValues{limit: limit} }

func (o *openValues) value(v string) string {
	if _, ok := o.seen.Load(v); ok {
		return v
	}
	if o.n.Load() >= int64(o.limit) {
		return OtherValue
	}
	// Two goroutines can both pass the check above for different values and
	// overshoot by the number of racing goroutines. Bounded, so harmless.
	if _, loaded := o.seen.LoadOrStore(v, struct{}{}); !loaded {
		o.n.Add(1)
	}
	return v
}
