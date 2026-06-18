package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type flowUserWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, user *domain.CreateUser) error
}

type flowUserPasswordWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, password *domain.CreateUserPassword) error
}

// FlowCreateUserHandler implements the `create_user` on_success:
// persist a new user from validated identifier + password fields.
type FlowCreateUserHandler struct {
	ids       idgen.Generator
	users     flowUserWriter
	passwords flowUserPasswordWriter
	hasher    domain.FlowPasswordHasher
}

func NewFlowCreateUserHandler(ids idgen.Generator, users flowUserWriter, passwords flowUserPasswordWriter, hasher domain.FlowPasswordHasher) *FlowCreateUserHandler {
	return &FlowCreateUserHandler{ids: ids, users: users, passwords: passwords, hasher: hasher}
}

var _ domain.FlowOnSuccessHandler = (*FlowCreateUserHandler)(nil)

func (h *FlowCreateUserHandler) Handle(ctx context.Context, client database.QueryExecutor, in domain.FlowOnSuccessInput) (domain.FlowOnSuccessResult, error) {
	collected := map[string]any{}
	if in.State != nil {
		collected = in.State.CollectedData
	}
	identifierName, _, _, ok := findCollectedFieldByChallenge(in.Resolved.Fields, collected, domain.FlowFieldChallengeIdentifier)
	if !ok {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no identifier in collected data", ErrIntegrity)
	}
	_, _, passwordValue, hasPassword := findCollectedFieldByChallenge(in.Resolved.Fields, collected, domain.FlowFieldChallengePassword)
	if !hasPassword {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no password in collected data", ErrIntegrity)
	}

	userID, err := h.ids.New("user")
	if err != nil {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: generate id: %w", err)
	}

	byName := make(map[string]domain.FlowField, len(in.Resolved.Fields))
	for _, f := range in.Resolved.Fields {
		byName[f.Name] = f
	}
	attrs := make([]*domain.CreateAttribute, 0, len(collected))
	for name, value := range collected {
		field, known := byName[name]
		if !known || field.Challenge == domain.FlowFieldChallengePassword {
			continue
		}
		uniqueScope := attributeUniquenessFor(name, identifierName, field.Unique)
		attr, err := domain.NewCreateAttribute(name, value, uniqueScope)
		if err != nil {
			return domain.FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: build attribute %q: %w", name, err)
		}
		attrs = append(attrs, attr)
	}

	encodedHash, err := h.hasher.Hash(asString(passwordValue))
	if err != nil {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: hash password: %w", err)
	}

	if err := h.users.Create(ctx, client, &domain.CreateUser{
		ProjectID:  in.ProjectID,
		SchemaURL:  in.UserSchemaURL,
		ID:         userID,
		Attributes: attrs,
	}); err != nil {
		var uniqueErr *database.UniqueError
		if errors.As(err, &uniqueErr) {
			msg := "user_already_exists"
			return domain.FlowOnSuccessResult{StepError: &msg}, nil
		}
		return domain.FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: insert user: %w", err)
	}

	if err := h.passwords.Create(ctx, client, &domain.CreateUserPassword{
		ProjectID:   in.ProjectID,
		UserID:      userID,
		EncodedHash: encodedHash,
	}); err != nil {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: insert password: %w", err)
	}

	return domain.FlowOnSuccessResult{UserID: userID}, nil
}

// GenerateUserID mints a new user ID. Used by the state machine to assign an
// ID before a passkey registration challenge is issued for a new user.
func (h *FlowCreateUserHandler) GenerateUserID() (string, error) {
	return h.ids.New("user")
}

// HandleProvisional creates a passwordless user with a pre-assigned ID from
// state.CollectedData. If the user already exists (UniqueError from a prior
// on_success handler), the call succeeds silently. Intended to be called
// within the passkey verify phase, sharing the same client transaction as
// the passkey save for atomicity.
func (h *FlowCreateUserHandler) HandleProvisional(ctx context.Context, client database.QueryExecutor, userID string, state *domain.FlowState, resolved domain.FlowResolvedFields) error {
	var attrs []*domain.CreateAttribute
	if name, field, value, ok := findCollectedFieldByChallenge(resolved.Fields, state.CollectedData, domain.FlowFieldChallengeIdentifier); ok {
		uniqueScope := attributeUniquenessFor(name, name, field.Unique)
		attr, err := domain.NewCreateAttribute(name, value, uniqueScope)
		if err != nil {
			return fmt.Errorf("flow create provisional user: build attribute: %w", err)
		}
		attrs = append(attrs, attr)
	}
	err := h.users.Create(ctx, client, &domain.CreateUser{
		ProjectID:  state.ProjectID,
		SchemaURL:  state.UserSchemaURL,
		ID:         userID,
		Attributes: attrs,
	})
	var uniqueErr *database.UniqueError
	if errors.As(err, &uniqueErr) {
		return nil
	}
	return err
}

// findCollectedFieldByChallenge looks up a field whose resolved Challenge
// matches target and whose name is present in collected. Returns the field
// name, the matched [FlowField], and its collected value. Callers that don't
// need the FlowField discard it.
func findCollectedFieldByChallenge(resolved []domain.FlowField, collected map[string]any, target domain.FlowFieldChallenge) (name string, field domain.FlowField, value any, ok bool) {
	for _, f := range resolved {
		if f.Challenge != target {
			continue
		}
		if v, present := collected[f.Name]; present {
			return f.Name, f, v, true
		}
	}
	return "", domain.FlowField{}, nil, false
}

// attributeUniquenessFor picks the [AttributeUniqueness] the user
// repository writes for a given field. The field's own scope passes
// through; the identifier field falls back to team-level when the
// schema didn't pin it, so two users can't share the same login.
func attributeUniquenessFor(name, identifierName string, scope domain.AttributeUniqueness) domain.AttributeUniqueness {
	if scope != domain.AttributeUniquenessUnspecified {
		return scope
	}
	if name == identifierName {
		return domain.AttributeUniquenessTeam
	}
	return domain.AttributeUniquenessUnspecified
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}
