package metrics

import (
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
)

// Every instrument the server creates is declared here, with the attributes
// it may carry. This is the single list the documentation, the tests and the
// metric views in zotel read: the views drop any attribute an instrument did
// not declare, a test fails when the documentation and the list disagree, and
// another when an instrument is recorded that the list does not know.
//
// The rule behind the list is that no attribute may identify a user, a
// project, a session, a token or a request. A series is created per distinct
// attribute combination and lives for the life of the process, so one
// attribute that follows a resource id turns a load test into an
// out-of-memory. Each attribute is therefore one of two kinds:
//
//   - a closed set, whose values are typed constants declared below and
//     listed in the catalogue, so a dashboard can be written against them;
//   - an open set, whose values come from names fixed in code (a statement
//     method, an event type), never from data.
//
// The SDK's per-instrument cardinality limit (set in zotel) is the hard bound
// behind both: past it, new attribute combinations land on one overflow
// series instead of becoming series of their own.
//
// Changing a name or an attribute key is a breaking change for whatever is
// graphing it.

// Instrument names. The database instruments take the OpenTelemetry semantic
// convention names, so a dashboard built for any other database client reads
// them; everything the server measures about itself is under `zitadel.`.
const (
	DBOperationDuration = "db.client.operation.duration"
	DBConnectionCount   = "db.client.connection.count"
	DBConnectionMax     = "db.client.connection.max"

	CredentialValidationDuration = "zitadel.auth.credential.validation.duration"
	TokenRevocationChecks        = "zitadel.auth.token.revocation_checks"
	PasswordVerificationDuration = "zitadel.auth.password.verification.duration"
	AuthAttemptOutcomes          = "zitadel.auth.attempt.outcomes"

	KeyChainResolutionDuration = "zitadel.crypto.key_chain.resolution.duration"

	FlowStepTransitions = "zitadel.flow.step.transitions"

	AuditInsertDuration = "zitadel.audit.insert.duration"
	AuditEventsWritten  = "zitadel.audit.events.written"
)

// Attribute keys. The database keys are the semantic convention's; CacheNameKey
// and ResultKey, which the cache instruments already use, are declared with
// them in cache.go.
const (
	DBSystemNameKey      = semconv.DBSystemNameKey
	DBQuerySummaryKey    = semconv.DBQuerySummaryKey
	DBConnectionPoolKey  = semconv.DBClientConnectionPoolNameKey
	DBConnectionStateKey = semconv.DBClientConnectionStateKey

	CheckKey     = attribute.Key("check")
	KeyKindKey   = attribute.Key("key.kind")
	OperationKey = attribute.Key("operation")
	SourceKey    = attribute.Key("source")
	EventTypeKey = attribute.Key("type")
)

// Kind is the OpenTelemetry instrument type of an instrument.
type Kind string

const (
	KindCounter       Kind = "counter"
	KindHistogram     Kind = "histogram"
	KindUpDownCounter Kind = "updowncounter"
	KindGauge         Kind = "gauge"
)

// Attribute describes one attribute an instrument may carry.
type Attribute struct {
	Key         attribute.Key
	Description string
	// Values is the complete value set of a closed attribute. It is empty for
	// an open one, whose values are fixed in code.
	Values []string
}

// Closed reports whether the attribute has a fixed value set.
func (a Attribute) Closed() bool { return len(a.Values) > 0 }

// Instrument describes one instrument: what it measures and every attribute
// it may carry.
type Instrument struct {
	Name        string
	Kind        Kind
	Unit        string
	Description string
	Attributes  []Attribute
}

// AttributeKeys returns the keys the instrument may carry.
func (i Instrument) AttributeKeys() []attribute.Key {
	keys := make([]attribute.Key, len(i.Attributes))
	for n, a := range i.Attributes {
		keys[n] = a.Key
	}
	return keys
}

// DBSystem names a database product, with the semantic convention's values.
type DBSystem string

const (
	DBSystemPostgreSQL DBSystem = "postgresql"
	DBSystemSQLite     DBSystem = "sqlite"
	DBSystemSpanner    DBSystem = "gcp.spanner"
)

// PoolName names a connection pool. There is one per dialect that pools
// connections; Spanner's client manages sessions itself and reports nothing
// here.
type PoolName string

const (
	PoolPostgres PoolName = "postgres"
	PoolSQLite   PoolName = "sqlite"
)

// PoolState is the state a pooled connection is in, with the semantic
// convention's values.
type PoolState string

const (
	PoolIdle PoolState = "idle"
	PoolUsed PoolState = "used"
)

// CredentialResult is the outcome of validating a bearer credential.
type CredentialResult string

const (
	// CredentialValid is a credential that decrypted, parsed and, when it can
	// be revoked, was still active.
	CredentialValid CredentialResult = "valid"
	// CredentialRevoked is an authentic credential whose token record is gone
	// or no longer active.
	CredentialRevoked CredentialResult = "revoked"
	// CredentialInvalid is a credential that could not be decrypted, parsed or
	// validated: malformed, forged, expired or encrypted under an unknown key.
	CredentialInvalid CredentialResult = "invalid"
	// CredentialError is a failure of the server, not of the credential.
	CredentialError CredentialResult = "error"
)

// RevocationResult is the outcome of checking a token record.
type RevocationResult string

const (
	RevocationActive  RevocationResult = "active"
	RevocationRevoked RevocationResult = "revoked"
	RevocationError   RevocationResult = "error"
)

// PasswordResult is the outcome of verifying a password against its hash.
type PasswordResult string

const (
	PasswordMatch    PasswordResult = "match"
	PasswordMismatch PasswordResult = "mismatch"
	// PasswordError is a hash that could not be verified at all, such as one
	// in an algorithm the server no longer carries.
	PasswordError PasswordResult = "error"
)

// AuthCheck is the kind of proof that was verified.
type AuthCheck string

const (
	CheckUser                AuthCheck = "user"
	CheckPassword            AuthCheck = "password"
	CheckPasskey             AuthCheck = "passkey"
	CheckPasskeyRegistration AuthCheck = "passkey_registration"
)

// AuthResult is the outcome of verifying one authentication proof.
type AuthResult string

const (
	AuthSuccess AuthResult = "success"
	// AuthRejected is a refusal of the client's doing: a wrong password, an
	// unknown login name, a failed assertion, or a challenge or attempt that is
	// unknown, stale or in the wrong state.
	AuthRejected AuthResult = "rejected"
	// AuthError is a failure of the server, or a system it depends on, while
	// verifying or persisting: the errors that give the response a 5xx. A
	// storage failure that was wrapped as a rejection still counts here.
	AuthError AuthResult = "error"
)

// KeyKind is the kind of key being resolved, with the values the
// `KeyService.unwrapKey` span puts under the same key.
type KeyKind string

const (
	// KeyKindMaster is a key wrapped by a master key: the RSA private-key
	// unwrap.
	KeyKindMaster KeyKind = "master"
	// KeyKindProject is a key wrapped by a project KEK, which is itself
	// resolved first when it is not cached.
	KeyKindProject KeyKind = "project"
)

// FlowOperation is the flow engine entry point a transition went through.
type FlowOperation string

const (
	FlowStart  FlowOperation = "start"
	FlowSubmit FlowOperation = "submit"
	FlowRender FlowOperation = "render"
)

// FlowResult is where a flow operation left the flow.
type FlowResult string

const (
	// FlowStep is an ordinary step the client has to act on.
	FlowStep FlowResult = "step"
	// FlowComplete is a terminal step: the flow has finished.
	FlowComplete FlowResult = "complete"
	// FlowFailed is an operation that returned an error and left the flow
	// where it was.
	FlowFailed FlowResult = "error"
)

// AuditSource is the route an audit event took into storage.
type AuditSource string

const (
	// AuditRequest is the buffered request.api batch, written off the request.
	AuditRequest AuditSource = "request"
	// AuditEvent is a single event inserted inside the transaction of the
	// operation that produced it.
	AuditEvent AuditSource = "event"
)

func values[T ~string](vs ...T) []string {
	out := make([]string, len(vs))
	for i, v := range vs {
		out[i] = string(v)
	}
	return out
}

// Catalogue returns every instrument the server creates. The result is a
// fresh copy: callers may keep or sort it.
func Catalogue() []Instrument {
	cacheName := Attribute{
		Key:         CacheNameKey,
		Description: "Name of the cache, fixed in code (`crypter`, `signing_key`).",
	}
	poolName := Attribute{
		Key:         DBConnectionPoolKey,
		Description: "The connection pool. Spanner has no pool and reports neither instrument.",
		Values:      values(PoolPostgres, PoolSQLite),
	}
	return []Instrument{
		{
			Name: DBOperationDuration, Kind: KindHistogram, Unit: "s",
			Description: "Duration of one storage statement call, including any wait for a pooled connection. PostgreSQL and SQLite time a query until it returns, before its rows are read, and PostgreSQL a single-row read until it is scanned; Spanner times a statement including the callback that reads its rows.",
			Attributes: []Attribute{
				{Key: DBSystemNameKey, Description: "Database product.", Values: values(DBSystemPostgreSQL, DBSystemSQLite, DBSystemSpanner)},
				{Key: DBQuerySummaryKey, Description: "The statement method that issued the call, as `type.Method` (for example `tokenStatements.GetTokenByID`). Fixed in code."},
			},
		},
		{
			Name: DBConnectionCount, Kind: KindUpDownCounter, Unit: "{connection}",
			Description: "Connections of a database pool, by state.",
			Attributes: []Attribute{
				poolName,
				{Key: DBConnectionStateKey, Description: "Connection state.", Values: values(PoolIdle, PoolUsed)},
			},
		},
		{
			Name: DBConnectionMax, Kind: KindUpDownCounter, Unit: "{connection}",
			Description: "The most connections a database pool will open.",
			Attributes:  []Attribute{poolName},
		},
		{
			Name: CredentialValidationDuration, Kind: KindHistogram, Unit: "s",
			Description: "Duration of validating a bearer credential: decrypting it, checking its claims and, for a revocable one, reading its token record.",
			Attributes: []Attribute{
				{Key: ResultKey, Description: "Outcome.", Values: values(CredentialValid, CredentialRevoked, CredentialInvalid, CredentialError)},
			},
		},
		{
			Name: TokenRevocationChecks, Kind: KindCounter, Unit: "{check}",
			Description: "Token record lookups made to see whether a credential was revoked. Credentials that cannot be revoked are not checked and not counted.",
			Attributes: []Attribute{
				{Key: ResultKey, Description: "Outcome.", Values: values(RevocationActive, RevocationRevoked, RevocationError)},
			},
		},
		{
			Name: PasswordVerificationDuration, Kind: KindHistogram, Unit: "s",
			Description: "Duration of verifying a password against its stored hash.",
			Attributes: []Attribute{
				{Key: ResultKey, Description: "Outcome.", Values: values(PasswordMatch, PasswordMismatch, PasswordError)},
			},
		},
		{
			Name: AuthAttemptOutcomes, Kind: KindCounter, Unit: "{proof}",
			Description: "Authentication proofs verified, by kind of proof and outcome.",
			Attributes: []Attribute{
				{Key: CheckKey, Description: "Kind of proof.", Values: values(CheckUser, CheckPassword, CheckPasskey, CheckPasskeyRegistration)},
				{Key: ResultKey, Description: "Outcome: `rejected` is refused by the client's doing, `error` is a failure of the server.", Values: values(AuthSuccess, AuthRejected, AuthError)},
			},
		},
		{
			Name: KeyChainResolutionDuration, Kind: KindHistogram, Unit: "s",
			Description: "Duration of unwrapping an encryption key that was not in the crypter cache, including resolving any wrapping key that is not cached either. Reading the key row is a storage statement and is part of db.client.operation.duration.",
			Attributes: []Attribute{
				{Key: KeyKindKey, Description: "What wraps the key. A project-wrapped resolution includes the time spent resolving its project KEK, which is recorded again as its own master-wrapped resolution.", Values: values(KeyKindMaster, KeyKindProject)},
			},
		},
		{
			Name: FlowStepTransitions, Kind: KindCounter, Unit: "{transition}",
			Description: "Flow engine operations, by entry point and where they left the flow. Step names are defined per project and are deliberately not an attribute.",
			Attributes: []Attribute{
				{Key: OperationKey, Description: "Flow engine entry point.", Values: values(FlowStart, FlowSubmit, FlowRender)},
				{Key: ResultKey, Description: "Where the flow was left.", Values: values(FlowStep, FlowComplete, FlowFailed)},
			},
		},
		{
			Name: AuditInsertDuration, Kind: KindHistogram, Unit: "s",
			Description: "Duration of one audit insert: a single event in its transaction, or one attempt to write a batch of buffered request events (a retried batch is timed per attempt).",
			Attributes: []Attribute{
				{Key: SourceKey, Description: "Route into storage.", Values: values(AuditRequest, AuditEvent)},
			},
		},
		{
			Name: AuditEventsWritten, Kind: KindCounter, Unit: "{event}",
			Description: "Audit events handed to storage successfully, by event type. An event written inside a transaction that later rolls back is still counted.",
			Attributes: []Attribute{
				{Key: EventTypeKey, Description: "Event type, such as `auth.token.revoked`. Fixed in code."},
			},
		},
		{
			Name: CacheLookups, Kind: KindCounter,
			Description: "Cache lookups, split into hits and misses.",
			Attributes: []Attribute{
				cacheName,
				{Key: ResultKey, Description: "Outcome.", Values: []string{"hit", "miss"}},
			},
		},
		{
			Name: CacheEvictions, Kind: KindCounter,
			Description: "Entries dropped from a cache because it was full.",
			Attributes:  []Attribute{cacheName},
		},
		{
			Name: CacheEntries, Kind: KindGauge,
			Description: "Entries currently held in a cache.",
			Attributes:  []Attribute{cacheName},
		},
	}
}
