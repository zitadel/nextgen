package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowCreateUserHandler implements the `create_user` on_success:
// persist a new user from validated identifier + password fields.
type FlowCreateUserHandler struct {
	userRepo     domain.UserRepository
	passwordRepo domain.UserPasswordRepository
	hasher       crypto.Hasher
	userService  *UserService
	schemaRepo   domain.JSONSchemaRepository
}

func NewFlowCreateUserHandler(
	userRepo domain.UserRepository,
	passwordRepo domain.UserPasswordRepository,
	hasher crypto.Hasher,
	userService *UserService,
	schemaRepo domain.JSONSchemaRepository,
) *FlowCreateUserHandler {
	return &FlowCreateUserHandler{
		userService:  userService,
		userRepo:     userRepo,
		schemaRepo:   schemaRepo,
		hasher:       hasher,
		passwordRepo: passwordRepo,
	}
}

var _ domain.FlowOnSuccessHandler = (*FlowCreateUserHandler)(nil)

func (h *FlowCreateUserHandler) Handle(ctx context.Context, in domain.FlowOnSuccessInput) (domain.FlowOnSuccessResult, error) {
	createUserAction := NewCreateUserAction(
		CreateUserInput{
			ProjectID: in.ProjectID,
			User:      collectedDataToUserData(in.State.CollectedData, in.State.UserSchemaURL),
		},
		h.userRepo,
		h.schemaRepo,
	)

	_, _, passwordValue, hasPassword := findCollectedFieldByChallenge(in.Resolved.Fields, in.State.CollectedData, domain.FlowFieldChallengePassword)
	if !hasPassword {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no password in collected data", ErrIntegrity)
	}

	setPasswordAction := NewLazyUserAction(func(ctx context.Context, db database.QueryExecutor) (UserAction, error) {
		return NewSetUserPasswordAction(
			SetPasswordInput{
				ProjectID: in.ProjectID,
				UserID:    createUserAction.User[domain.UserIDFieldName].(string),
				Password:  passwordValue.(string),
			},
			h.hasher,
			h.passwordRepo,
		), nil
	})

	err := h.userService.ApplyActions(ctx, createUserAction, setPasswordAction)
	if err != nil {
		return domain.FlowOnSuccessResult{}, err
	}

	return domain.FlowOnSuccessResult{
		UserID: createUserAction.User[domain.UserIDFieldName].(string),
	}, nil
}

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
	_, err := h.userService.CreateUser(ctx, CreateUserInput{
		ProjectID: state.ProjectID,
		User:      collectedDataToUserData(state.CollectedData, state.UserSchemaURL),
	})
	if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
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
