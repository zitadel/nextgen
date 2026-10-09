package metrics

import (
	"go.opentelemetry.io/otel/attribute"
)

// Every instrument the server creates is declared here, with the attributes it
// may carry. This is the single list the documentation, the tests and the
// metric view in zotel read, so an instrument that is not in it does not
// ship: the view drops any attribute an instrument did not declare, and a test
// fails when an instrument is recorded that the catalogue does not know.
//
// The rule behind the list is that no attribute may identify a user, a project
// or a request. A series is created per distinct attribute combination and
// lives for the life of the process, so one attribute that follows a resource
// id turns a load test into an out-of-memory. Each attribute is therefore one
// of two kinds:
//
//   - a closed set, whose values are listed below and checked on every record:
//     a value outside the list is reported as OtherValue, never as itself;
//   - an open set, whose values come from names fixed in code (a statement
//     method, an event type) and are capped at MaxOpenValues distinct values
//     per attribute, after which further values are reported as OtherValue.
//
// Changing a name or an attribute key is a breaking change for whatever is
// graphing it.

const (
	// MaxOpenValues caps the distinct values of an open attribute.
	MaxOpenValues = 512

	// OtherValue stands in for any value outside a closed set, or beyond the cap
	// of an open one.
	OtherValue = "other"
)

// Instrument names.
const (
	DBStatementDuration = "zitadel.db.statement.duration"
	DBPoolConnections   = "zitadel.db.pool.connections"

	CredentialValidationDuration = "zitadel.auth.credential.validation.duration"
	PasswordVerificationDuration = "zitadel.auth.password.verification.duration"
	AuthAttemptOutcomes          = "zitadel.auth.attempt.outcomes"
	TokenRevocationChecks        = "zitadel.auth.token.revocation_checks"

	KeyChainResolutionDuration = "zitadel.crypto.key_chain.resolution.duration"

	FlowStepTransitions = "zitadel.flow.step.transitions"

	AuditInsertDuration = "zitadel.audit.insert.duration"
	AuditEventsWritten  = "zitadel.audit.events.written"
)

// Attribute keys. CacheNameKey and ResultKey, which the cache instruments
// already use, are declared with them in cache.go.
const (
	DialectKey   = attribute.Key("dialect")
	StatementKey = attribute.Key("statement")
	StateKey     = attribute.Key("state")
	CheckKey     = attribute.Key("check")
	KEKKey       = attribute.Key("kek")
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
	// an open one, which is capped at MaxOpenValues instead.
	Values []string
}

// Closed reports whether the attribute has a fixed value set.
func (a Attribute) Closed() bool { return len(a.Values) > 0 }

// Instrument describes one instrument: what it measures and every attribute it
// may carry.
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

// Dialect names a storage dialect.
type Dialect string

const (
	DialectPostgres Dialect = "postgres"
	DialectSQLite   Dialect = "sqlite"
	DialectSpanner  Dialect = "spanner"
)

// PoolState is the state a pooled connection is in.
type PoolState string

const (
	PoolInUse PoolState = "in_use"
	PoolIdle  PoolState = "idle"
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

// PasswordResult is the outcome of verifying a password against its hash.
type PasswordResult string

const (
	PasswordMatch    PasswordResult = "match"
	PasswordMismatch PasswordResult = "mismatch"
	// PasswordError is a hash that could not be verified at all, such as one in
	// an algorithm the server no longer carries.
	PasswordError PasswordResult = "error"
)

// AuthResult is the outcome of verifying one authentication proof.
type AuthResult string

const (
	AuthSuccess AuthResult = "success"
	// AuthRejected is a proof that was checked and refused: a wrong password,
	// an unknown login name, a failed assertion.
	AuthRejected AuthResult = "rejected"
	// AuthError is a verification that could not be completed: a challenge in
	// the wrong state, or a failure of the server while verifying or persisting.
	AuthError AuthResult = "error"
)

// AuthCheck is the kind of proof that was verified.
type AuthCheck string

const (
	CheckUser                AuthCheck = "user"
	CheckPassword            AuthCheck = "password"
	CheckPasskey             AuthCheck = "passkey"
	CheckPasskeyRegistration AuthCheck = "passkey_registration"
)

// RevocationResult is the outcome of checking a token record.
type RevocationResult string

const (
	RevocationActive  RevocationResult = "active"
	RevocationRevoked RevocationResult = "revoked"
	RevocationError   RevocationResult = "error"
)

// KEK is the kind of key that wraps the key being resolved.
type KEK string

const (
	// KEKMaster is a key wrapped by a master key: the RSA private-key unwrap.
	KEKMaster KEK = "master"
	// KEKProject is a key wrapped by a project KEK, which is itself resolved
	// first when it is not cached.
	KEKProject KEK = "project"
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
	// FlowFailed is an operation that returned an error and left the flow where
	// it was.
	FlowFailed FlowResult = "error"
)

// AuditSource is the route an audit event took into storage (ADR 048).
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

// Catalogue returns every instrument the server creates. The result is a fresh
// copy: callers may keep or sort it.
func Catalogue() []Instrument {
	dialect := Attribute{
		Key:         DialectKey,
		Description: "Storage dialect.",
		Values:      values(DialectPostgres, DialectSQLite, DialectSpanner),
	}
	return []Instrument{
		{
			Name: DBStatementDuration, Kind: KindHistogram, Unit: "s",
			Description: "Duration of one storage statement call, including any wait for a pooled connection.",
			Attributes: []Attribute{
				dialect,
				{Key: StatementKey, Description: "Statement method, as `type.Method` (for example `tokenStatements.GetTokenByID`). Fixed in code; capped at 512 values."},
			},
		},
		{
			Name: DBPoolConnections, Kind: KindUpDownCounter, Unit: "{connection}",
			Description: "Connections of the database pool, by state. Not reported for Spanner, which has no connection pool.",
			Attributes: []Attribute{
				dialect,
				{Key: StateKey, Description: "Connection state.", Values: values(PoolInUse, PoolIdle)},
			},
		},
		{
			Name: CredentialValidationDuration, Kind: KindHistogram, Unit: "s",
			Description: "Duration of validating a bearer credential: decrypting it, checking its claims and, for a revocable one, reading its token record.",
			Attributes: []Attribute{
				{Key: ResultKey, Description: "Outcome.", Values: values(CredentialValid, CredentialRevoked, CredentialInvalid, CredentialError)},
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
				{Key: ResultKey, Description: "Outcome.", Values: values(AuthSuccess, AuthRejected, AuthError)},
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
			Name: KeyChainResolutionDuration, Kind: KindHistogram, Unit: "s",
			Description: "Duration of unwrapping an encryption key that was not in the crypter cache, including resolving any wrapping key that is not cached either. Reading the key row is a storage statement and is part of zitadel.db.statement.duration.",
			Attributes: []Attribute{
				{Key: KEKKey, Description: "What wraps the key. A project-wrapped resolution includes the time spent resolving its project KEK, which is recorded again as its own master-wrapped resolution.", Values: values(KEKMaster, KEKProject)},
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
			Description: "Duration of one audit insert: a single event in its transaction, or one flush of the buffered request events.",
			Attributes: []Attribute{
				{Key: SourceKey, Description: "Route into storage.", Values: values(AuditRequest, AuditEvent)},
			},
		},
		{
			Name: AuditEventsWritten, Kind: KindCounter, Unit: "{event}",
			Description: "Audit events handed to storage successfully, by event type. An event written inside a transaction that later rolls back is still counted.",
			Attributes: []Attribute{
				{Key: EventTypeKey, Description: "Event type, such as `auth.token.revoked`. Fixed in code; capped at 512 values."},
			},
		},
		{
			Name: CacheLookups, Kind: KindCounter,
			Description: "Cache lookups, split into hits and misses.",
			Attributes: []Attribute{
				cacheAttribute,
				{Key: ResultKey, Description: "Outcome.", Values: []string{"hit", "miss"}},
			},
		},
		{
			Name: CacheEvictions, Kind: KindCounter,
			Description: "Entries dropped from a cache because it was full.",
			Attributes:  []Attribute{cacheAttribute},
		},
		{
			Name: CacheEntries, Kind: KindGauge,
			Description: "Entries currently held in a cache.",
			Attributes:  []Attribute{cacheAttribute},
		},
	}
}

var cacheAttribute = Attribute{
	Key:         CacheNameKey,
	Description: "Name of the cache, fixed in code (`crypter`, `signing_key`).",
}
