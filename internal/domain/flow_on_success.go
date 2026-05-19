package domain

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowOnSuccessHandler runs a step's side effect after field validation
// and before the state machine advances on the submitted action. The
// handler reports which outcome the state machine should advance on, or
// surfaces a step-level failure that keeps the user on the current step.
//
// Each handler is registered under a [FlowOnSuccess] value;
// [FlowDefinitionStep.OnSuccess] references it. The registry is the
// only public seam — new handlers slot in without the state machine
// knowing about them.
type FlowOnSuccessHandler interface {
	// Handle runs the side effect and reports the outcome.
	Handle(ctx context.Context, client database.QueryExecutor, in FlowOnSuccessInput) (FlowOnSuccessResult, error)
}

// FlowOnSuccessInput is the per-call context the state machine threads
// into a handler. Fields carries the values the resolver already
// validated; Resolved is the per-field metadata for the current step
// (challenge classification, validation rules) — handlers use it to
// pick out which field is the identifier, which is the credential,
// and so on. State is the current flow state; handlers may read it,
// and may surface state-level changes (resolved user id) through the
// returned [FlowOnSuccessResult].
type FlowOnSuccessInput struct {
	ProjectID     string
	UserSchemaURL string
	Fields        map[string]any
	Resolved      FlowResolvedFields
	State         *FlowState
	ResolvedFlow  *FlowDefinition
}

// FlowOnSuccessResult is what a handler returns. Exactly one of Outcome
// or StepError is meaningful per call:
//
//   - Outcome empty + StepError nil  → success; the state machine
//     advances on the action the client submitted.
//   - Outcome non-empty + StepError nil → success-with-routing; the
//     state machine advances on the named outcome instead of the
//     submitted action. The outcome must match a transition declared
//     on the current step.
//   - StepError non-nil → recoverable failure; the state machine keeps
//     the user on the current step and surfaces StepError on
//     [FlowStep.Error]. Outcome is ignored.
type FlowOnSuccessResult struct {
	// Outcome overrides the transition key the state machine advances
	// on. Empty means "use the submitted action".
	Outcome string

	// StepError carries a localization key for a step-level error to
	// render to the user. Non-nil signals a recoverable failure that
	// stops the advance.
	StepError *string

	// UserID, when set, is recorded on [FlowState] as the resolved
	// user identifier (e.g. after a successful create_user).
	UserID string
}

// FlowOnSuccessRegistry resolves a handler by its [FlowOnSuccess] value.
// The state machine calls [Lookup] for every step that declares an
// [FlowDefinitionStep.OnSuccess]; an unknown value surfaces as
// [ErrUnknownOnSuccessHandler].
type FlowOnSuccessRegistry struct {
	handlers map[FlowOnSuccess]FlowOnSuccessHandler
}

// NewFlowOnSuccessRegistry returns an empty registry. Register
// handlers with [FlowOnSuccessRegistry.Register].
func NewFlowOnSuccessRegistry() *FlowOnSuccessRegistry {
	return &FlowOnSuccessRegistry{handlers: map[FlowOnSuccess]FlowOnSuccessHandler{}}
}

// Register associates a handler with a [FlowOnSuccess] value.
// Re-registering the same value returns an error rather than silently
// overriding — production wiring happens at bootstrap and a duplicate
// is almost always a bug.
func (r *FlowOnSuccessRegistry) Register(kind FlowOnSuccess, h FlowOnSuccessHandler) error {
	if h == nil {
		return fmt.Errorf("flow on_success registry: handler for %q is nil", kind)
	}
	if _, exists := r.handlers[kind]; exists {
		return fmt.Errorf("flow on_success registry: handler %q already registered", kind)
	}
	r.handlers[kind] = h
	return nil
}

// Lookup returns the handler registered under kind. Returns
// [ErrUnknownOnSuccessHandler] if no such handler exists.
func (r *FlowOnSuccessRegistry) Lookup(kind FlowOnSuccess) (FlowOnSuccessHandler, error) {
	h, ok := r.handlers[kind]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownOnSuccessHandler, kind)
	}
	return h, nil
}

// ErrUnknownOnSuccessHandler is returned by
// [FlowOnSuccessRegistry.Lookup] for a name that has never been
// registered. The state machine maps it to [ErrIntegrity] — referring
// to an unknown handler means the definition was activated against a
// registry it isn't compatible with.
var ErrUnknownOnSuccessHandler = errors.New("flow on_success registry: handler not registered")

// FlowPasswordHasher is the seam the flow engine's on_success handlers
// use to produce password hashes. The encoded form is the PHC string
// (`$argon2id$...`) stored on [UserPassword.EncodedHash]; callers
// never see plaintext after Hash returns.
type FlowPasswordHasher interface {
	// Hash derives an encoded PHC string from the plaintext password.
	Hash(plain string) (encoded string, err error)
}

// flowUserWriter is the narrow write seam [FlowCreateUserHandler] uses
// to persist a new user. [UserRepository] satisfies it.
type flowUserWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, user *CreateUser) error
}

// flowUserPasswordWriter is the narrow write seam for the password row.
// [UserPasswordRepository] satisfies it.
type flowUserPasswordWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, password *CreateUserPassword) error
}

// FlowCreateUserHandler is the MVP `create_user` [FlowOnSuccessHandler].
// It produces a new user from validated identifier + password fields:
// generates the user id, persists the user with one attribute per
// submitted field, hashes the password, and writes the password row.
//
// When the eventual auth-attempt domain lands the handler's body moves
// behind that service; the state machine's call site does not move.
type FlowCreateUserHandler struct {
	ids       idgen.Generator
	users     flowUserWriter
	passwords flowUserPasswordWriter
	hasher    FlowPasswordHasher
}

// NewFlowCreateUserHandler wires the dependencies the handler needs to
// run. In production the seams are satisfied by [UserRepository] and
// [UserPasswordRepository].
func NewFlowCreateUserHandler(ids idgen.Generator, users flowUserWriter, passwords flowUserPasswordWriter, hasher FlowPasswordHasher) *FlowCreateUserHandler {
	return &FlowCreateUserHandler{
		ids:       ids,
		users:     users,
		passwords: passwords,
		hasher:    hasher,
	}
}

var _ FlowOnSuccessHandler = (*FlowCreateUserHandler)(nil)

func (h *FlowCreateUserHandler) Handle(ctx context.Context, client database.QueryExecutor, in FlowOnSuccessInput) (FlowOnSuccessResult, error) {
	identifierName, _, ok := findIdentifierField(in.Resolved.Fields, in.Fields)
	if !ok {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: create_user step has no identifier field", ErrIntegrity)
	}
	_, passwordValue, hasPassword := findPasswordField(in.Resolved.Fields, in.Fields)
	if !hasPassword {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: create_user step has no password field", ErrIntegrity)
	}

	userID, err := h.ids.New("user")
	if err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: generate id: %w", err)
	}

	attrs := make([]*CreateAttribute, 0, len(in.Fields))
	for name, value := range in.Fields {
		field, known := in.Resolved.Fields[name]
		if !known || field.Challenge == FlowFieldChallengePassword {
			// Skip password — it lives in user_passwords, not as an
			// attribute. Unknown fields shouldn't appear here (the
			// resolver validates the catalog) but we drop them defensively.
			continue
		}
		uniqueScope := attributeUniquenessFor(name, identifierName, field.Unique)
		attr, err := NewCreateAttribute(name, value, uniqueScope)
		if err != nil {
			return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: build attribute %q: %w", name, err)
		}
		attrs = append(attrs, attr)
	}

	encodedHash, err := h.hasher.Hash(asString(passwordValue))
	if err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: hash password: %w", err)
	}

	if err := h.users.Create(ctx, client, &CreateUser{
		ProjectID:  in.ProjectID,
		SchemaURL:  in.UserSchemaURL,
		ID:         userID,
		Attributes: attrs,
	}); err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: insert user: %w", err)
	}

	if err := h.passwords.Create(ctx, client, &CreateUserPassword{
		ProjectID:   in.ProjectID,
		UserID:      userID,
		EncodedHash: encodedHash,
	}); err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: insert password: %w", err)
	}

	return FlowOnSuccessResult{UserID: userID}, nil
}

// findIdentifierField returns the property name and submitted value of
// the field tagged [FlowFieldChallengeIdentifier]. Resolver contract
// guarantees at most one such field per step.
func findIdentifierField(resolved map[string]FlowField, submitted map[string]any) (name string, value any, ok bool) {
	for n, f := range resolved {
		if f.Challenge == FlowFieldChallengeIdentifier {
			return n, submitted[n], true
		}
	}
	return "", nil, false
}

// findPasswordField mirrors [findIdentifierField] for the
// [FlowFieldChallengePassword] field.
func findPasswordField(resolved map[string]FlowField, submitted map[string]any) (name string, value any, ok bool) {
	for n, f := range resolved {
		if f.Challenge == FlowFieldChallengePassword {
			return n, submitted[n], true
		}
	}
	return "", nil, false
}

// attributeUniquenessFor maps a [FlowFieldUniqueScope] to the
// [AttributeUniqueness] enum the user repository understands. The
// identifier field is always uniqueness-scoped at minimum to the team
// level so two users can't share the same login.
func attributeUniquenessFor(name, identifierName string, scope FlowFieldUniqueScope) AttributeUniqueness {
	switch scope {
	case FlowFieldUniqueScopeInstance:
		return AttributeUniquenessGlobal
	case FlowFieldUniqueScopeOrganization:
		return AttributeUniquenessTeam
	}
	if name == identifierName {
		return AttributeUniquenessTeam
	}
	return AttributeUniquenessUnspecified
}

// asString coerces a submitted field value to a string. Field
// validation has already rejected non-string credentials by the time we
// get here, so a non-string at this point is a programmer error in the
// resolver — we surface "" rather than panicking.
func asString(v any) string {
	s, _ := v.(string)
	return s
}
