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

	var passwordValue string
	for _, f := range in.Resolved.Fields {
		if f.Challenge != domain.FlowFieldChallengePassword {
			continue
		}
		if v, present := in.State.CollectedData[f.Name]; present {
			passwordValue, _ = v.(string)
			break
		}
	}
	if passwordValue == "" {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no password in collected data", ErrIntegrity)
	}

	setPasswordAction := NewLazyUserAction(func(ctx context.Context, db database.QueryExecutor) (UserAction, error) {
		return NewSetUserPasswordAction(
			SetPasswordInput{
				ProjectID: in.ProjectID,
				UserID:    createUserAction.User[domain.UserIDFieldName].(string),
				Password:  passwordValue,
			},
			h.hasher,
			h.passwordRepo,
		), nil
	})

	err := h.userService.ApplyActions(ctx, createUserAction, setPasswordAction)
	if err != nil {
		if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
			msg := "user_already_exists"
			return domain.FlowOnSuccessResult{StepError: &msg}, nil
		}
		return domain.FlowOnSuccessResult{}, err
	}

	return domain.FlowOnSuccessResult{
		UserID: createUserAction.User[domain.UserIDFieldName].(string),
	}, nil
}
