package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowCreateUserForPasskeyHandler creates the user row on the passkey-register
// verify leg using the userID bound to the WebAuthn challenge at issue time.
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

// resolved is accepted for interface symmetry; attributes are derived from
// the schema, not the resolved fields.
func (h *FlowCreateUserForPasskeyHandler) CreateProvisionalUser(ctx context.Context, userID string, state *domain.FlowState, _ domain.FlowResolvedFields) error {
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
