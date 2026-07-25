package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowCreateUserWithPasswordHandler implements the `create_user` on_success:
// persist a new user from validated identifier + password fields.
type FlowCreateUserWithPasswordHandler struct {
	userRepo     domain.UserRepository
	passwordRepo domain.UserPasswordRepository
	hasher       crypto.Hasher
	userService  *UserService
	schemaStore  domain.JSONSchemaStore
}

func NewFlowCreateUserHandler(
	userRepo domain.UserRepository,
	passwordRepo domain.UserPasswordRepository,
	hasher crypto.Hasher,
	userService *UserService,
	schemaStore domain.JSONSchemaStore,
) *FlowCreateUserWithPasswordHandler {
	return &FlowCreateUserWithPasswordHandler{
		userService:  userService,
		userRepo:     userRepo,
		schemaStore:  schemaStore,
		hasher:       hasher,
		passwordRepo: passwordRepo,
	}
}

var _ domain.FlowOnSuccessHandler = (*FlowCreateUserWithPasswordHandler)(nil)

func (h *FlowCreateUserWithPasswordHandler) Handle(ctx context.Context, in domain.FlowOnSuccessInput) (domain.FlowOnSuccessResult, error) {
	in.State.CollectedData.UserData["$schema"] = in.UserSchemaURL
	createUserAction := NewCreateUserAction(
		CreateUserInput{
			ProjectID: in.ProjectID,
			User:      in.State.CollectedData.UserData,
		},
		h.userRepo,
		h.schemaStore,
	)

	if in.State.CollectedData.AuthMethods.Password == "" {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no password in collected data", domain.ErrFlowIntegrity())
	}

	setPasswordAction := NewLazyUserAction(func(ctx context.Context, db database.QueryExecutor) (UserAction, error) {
		return NewSetUserPasswordAction(
			SetPasswordInput{
				ProjectID: in.ProjectID,
				UserID:    createUserAction.CreateUser.ID,
				Password:  in.State.CollectedData.AuthMethods.Password,
			},
			h.hasher,
			h.passwordRepo,
		), nil
	})

	err := h.userService.ApplyActions(ctx, createUserAction, setPasswordAction)
	if err != nil {
		if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
			return domain.FlowOnSuccessResult{StepError: new("user_already_exists")}, nil
		}
		return domain.FlowOnSuccessResult{}, err
	}

	return domain.FlowOnSuccessResult{
		UserID:       createUserAction.CreateUser.ID,
		Irreversible: true,
	}, nil
}
