package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
)

// FlowCreateUserWithPasswordHandler implements the `create_user` on_success:
// persist a new user from validated identifier + password fields.
type FlowCreateUserWithPasswordHandler struct {
	hasher      crypto.Hasher
	userService *UserService
	schemaStore domain.JSONSchemaStore
}

func NewFlowCreateUserHandler(
	hasher crypto.Hasher,
	userService *UserService,
	schemaStore domain.JSONSchemaStore,
) *FlowCreateUserWithPasswordHandler {
	return &FlowCreateUserWithPasswordHandler{
		userService: userService,
		schemaStore: schemaStore,
		hasher:      hasher,
	}
}

var _ domain.FlowOnSuccessHandler = (*FlowCreateUserWithPasswordHandler)(nil)

func (h *FlowCreateUserWithPasswordHandler) Handle(ctx context.Context, in domain.FlowOnSuccessInput) (domain.FlowOnSuccessResult, error) {
	in.State.CollectedData.UserData["$schema"] = in.UserSchemaURL

	password := in.State.CollectedData.AuthMethods.Password
	if password == "" {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no password in collected data", domain.ErrFlowIntegrity())
	}

	userID, err := h.userService.v2Pool.Statements().NewManagedID(string(domain.PrefixUser))
	if err != nil {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("create_user: mint user id: %w", err)
	}

	createUserAction := NewCreateUserAction(
		CreateUserInput{
			ProjectID: in.ProjectID,
			User:      in.State.CollectedData.UserData,
			ID:        userID,
		},
		h.schemaStore,
	)
	setPasswordAction := NewSetUserPasswordAction(
		SetPasswordInput{
			ProjectID: in.ProjectID,
			UserID:    userID,
			Password:  password,
		},
		h.hasher,
	)

	err = h.userService.ApplyActions(ctx, createUserAction, setPasswordAction)
	if err != nil {
		if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
			return domain.FlowOnSuccessResult{StepError: new("user_already_exists")}, nil
		}
		return domain.FlowOnSuccessResult{}, err
	}

	return domain.FlowOnSuccessResult{
		UserID:       userID,
		Irreversible: true,
	}, nil
}
