package domain

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type flowUserWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, user *CreateUser) error
}

type flowUserPasswordWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, password *CreateUserPassword) error
}

// FlowCreateUserHandler implements the `create_user` on_success:
// persist a new user from validated identifier + password fields.
type FlowCreateUserHandler struct {
	ids       idgen.Generator
	users     flowUserWriter
	passwords flowUserPasswordWriter
	hasher    FlowPasswordHasher
}

func NewFlowCreateUserHandler(ids idgen.Generator, users flowUserWriter, passwords flowUserPasswordWriter, hasher FlowPasswordHasher) *FlowCreateUserHandler {
	return &FlowCreateUserHandler{ids: ids, users: users, passwords: passwords, hasher: hasher}
}

var _ FlowOnSuccessHandler = (*FlowCreateUserHandler)(nil)

func (h *FlowCreateUserHandler) Handle(ctx context.Context, client database.QueryExecutor, in FlowOnSuccessInput) (FlowOnSuccessResult, error) {
	collected := map[string]any{}
	if in.State != nil {
		collected = in.State.CollectedData
	}
	identifierName, _, ok := findCollectedFieldByChallenge(in.Resolved.Fields, collected, FlowFieldChallengeIdentifier)
	if !ok {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no identifier in collected data", ErrIntegrity)
	}
	_, passwordValue, hasPassword := findCollectedFieldByChallenge(in.Resolved.Fields, collected, FlowFieldChallengePassword)
	if !hasPassword {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no password in collected data", ErrIntegrity)
	}

	userID, err := h.ids.New("user")
	if err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success create_user: generate id: %w", err)
	}

	attrs := make([]*CreateAttribute, 0, len(collected))
	for name, value := range collected {
		field, known := in.Resolved.Fields[name]
		if !known || field.Challenge == FlowFieldChallengePassword {
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

// findCollectedFieldByChallenge looks up a field whose resolved Challenge
// matches target and whose name is present in collected. Returns the
// field name and its collected value.
func findCollectedFieldByChallenge(resolved map[string]FlowField, collected map[string]any, target FlowFieldChallenge) (name string, value any, ok bool) {
	for n, f := range resolved {
		if f.Challenge != target {
			continue
		}
		if v, present := collected[n]; present {
			return n, v, true
		}
	}
	return "", nil, false
}

// attributeUniquenessFor picks the [AttributeUniqueness] the user
// repository writes for a given field. The field's own scope passes
// through; the identifier field falls back to team-level when the
// schema didn't pin it, so two users can't share the same login.
func attributeUniquenessFor(name, identifierName string, scope AttributeUniqueness) AttributeUniqueness {
	if scope != AttributeUniquenessUnspecified {
		return scope
	}
	if name == identifierName {
		return AttributeUniquenessTeam
	}
	return AttributeUniquenessUnspecified
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}
