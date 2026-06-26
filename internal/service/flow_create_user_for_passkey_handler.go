package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type flowUserWriter interface {
	Create(ctx context.Context, client database.QueryExecutor, user *domain.CreateUser) error
}

type FlowCreateUserForPasskeyHandler struct {
	users flowUserWriter
}

func NewFlowCreateUserForPasskeyHandler(
	users flowUserWriter,
) *FlowCreateUserForPasskeyHandler {
	// TODO: streamline the passkey registration process like passwords
	return &FlowCreateUserForPasskeyHandler{users: users}
}

// CreateProvisionalUser creates a passwordless user with a pre-assigned ID from
// state.CollectedData. Every schema-known collected field is written as an
// attribute; the identifier field falls back to team-level uniqueness when the
// schema didn't pin it. If the user already exists (UniqueError from a prior
// on_success handler), the call succeeds silently. Intended to be called
// within the passkey verify phase, sharing the same client transaction as
// the passkey save for atomicity.
func (h *FlowCreateUserForPasskeyHandler) CreateProvisionalUser(ctx context.Context, client database.QueryExecutor, userID string, state *domain.FlowState, resolved domain.FlowResolvedFields) error {
	identifierName, _, _, ok := domain.FindCollectedFieldByChallenge(resolved.Fields, state.CollectedData.UserData, domain.FlowFieldChallengeIdentifier)
	if !ok {
		return fmt.Errorf("%w: provisional passkey user has no identifier in collected data", domain.ErrIntegrity)
	}

	byName := make(map[string]domain.FlowField, len(resolved.Fields))
	for _, f := range resolved.Fields {
		byName[f.Name] = f
	}
	attrs := make([]*domain.CreateAttribute, 0, len(state.CollectedData.UserData))
	for name, value := range state.CollectedData.UserData {
		field, known := byName[name]
		if !known || field.Challenge == domain.FlowFieldChallengePassword {
			continue
		}
		uniqueScope := attributeUniquenessFor(name, identifierName, field.Unique)
		attr, err := domain.NewCreateAttribute(name, value, uniqueScope)
		if err != nil {
			return fmt.Errorf("flow create provisional user: build attribute %q: %w", name, err)
		}
		attrs = append(attrs, attr)
	}

	// TODO: use UserService to create users.
	err := h.users.Create(ctx, client, &domain.CreateUser{
		ProjectID:  state.ProjectID,
		SchemaURL:  state.UserSchemaURL,
		ID:         userID,
		Attributes: attrs,
	})
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		return nil
	}
	return err
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
