package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowCreateUserForPasskeyHandler creates the user row on the passkey-register
// verify leg. The user id was bound to the WebAuthn registration challenge at
// issue time, so the row is created with that pre-assigned id rather than a
// freshly-minted one. A prior on_success handler having already created the
// row is treated as success so the racing handler-then-ceremony order stays
// safe.
type FlowCreateUserForPasskeyHandler struct {
	userRepo    domain.UserRepository
	userService *UserService
	schemaRepo  domain.JSONSchemaRepository
}

func NewFlowCreateUserForPasskeyHandler(
	userRepo domain.UserRepository,
	userService *UserService,
	schemaRepo domain.JSONSchemaRepository,
) *FlowCreateUserForPasskeyHandler {
	return &FlowCreateUserForPasskeyHandler{
		userRepo:    userRepo,
		userService: userService,
		schemaRepo:  schemaRepo,
	}
}

// CreateProvisionalUser creates a passwordless user with the caller-supplied
// userID through [UserService.ApplyActions], the same path the password
// handler drives. The client and resolved arguments are accepted to satisfy
// the [domain.FlowPasskeyUserCreater] contract and are intentionally unused:
// the transaction lifecycle is owned by the user service, and the attribute
// set is derived from the schema rather than the resolved fields.
func (h *FlowCreateUserForPasskeyHandler) CreateProvisionalUser(ctx context.Context, _ database.QueryExecutor, userID string, state *domain.FlowState, _ domain.FlowResolvedFields) error {
	state.CollectedData.UserData["$schema"] = state.UserSchemaURL
	action := NewCreateUserAction(
		CreateUserInput{
			ProjectID: state.ProjectID,
			User:      state.CollectedData.UserData,
			ID:        userID,
		},
		h.userRepo,
		h.schemaRepo,
	)
	err := h.userService.ApplyActions(ctx, action)
	if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
		return nil
	}
	return err
}
