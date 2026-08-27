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
	userService UserService
	schemaStore domain.JSONSchemaStore
	db          StatementPool
}

func NewFlowCreateUserHandler(
	hasher crypto.Hasher,
	userService UserService,
	schemaStore domain.JSONSchemaStore,
	db StatementPool,
) *FlowCreateUserWithPasswordHandler {
	return &FlowCreateUserWithPasswordHandler{
		userService: userService,
		schemaStore: schemaStore,
		hasher:      hasher,
		db:          db,
	}
}

var _ domain.FlowOnSuccessHandler = (*FlowCreateUserWithPasswordHandler)(nil)

func (h *FlowCreateUserWithPasswordHandler) Handle(ctx context.Context, in domain.FlowOnSuccessInput) (domain.FlowOnSuccessResult, error) {
	password := in.State.CollectedData.AuthMethods.Password
	if password == "" {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user has no password in collected data", domain.ErrFlowIntegrity())
	}

	userID, err := h.db.Statements().NewManagedID(string(domain.PrefixUser))
	if err != nil {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("create_user: mint user id: %w", err)
	}

	createUserAction := NewCreateUserAction(
		CreateUserInput{
			ProjectID:  in.ProjectID,
			SchemaURL:  in.UserSchemaURL,
			Attributes: in.State.CollectedData.UserData,
			ID:         userID,
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
	// The user just chose this password, so knowledge is proven: record real
	// user + password factors on the attempt in the same transaction, so the
	// exchanged session reflects how the user authenticated.
	recordFactorsAction := &recordAttemptFactorsAction{
		projectID: in.ProjectID,
		attemptID: in.State.AuthAttemptID,
		factors: []domain.AuthFactor{
			&domain.AuthFactorUser{UserID: userID},
			&domain.AuthFactorPassword{},
		},
	}

	err = h.userService.ApplyActions(ctx, createUserAction, setPasswordAction, recordFactorsAction)
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

// recordAttemptFactorsAction upserts verified factors on the auth attempt as
// part of a user-mutation transaction, emitting the same auth.check.succeeded
// events a challenge/proof cycle would.
type recordAttemptFactorsAction struct {
	projectID string
	attemptID string
	factors   []domain.AuthFactor
}

func (a *recordAttemptFactorsAction) Prepare(context.Context) error { return nil }

func (a *recordAttemptFactorsAction) Apply(ctx context.Context, stmts AllStatements) error {
	attempt, err := stmts.GetAuthAttemptByID(ctx, a.projectID, a.attemptID)
	if err != nil {
		return fmt.Errorf("record attempt factors: %w", err)
	}
	for _, factor := range a.factors {
		if _, err := recordDirectAuthFactor(ctx, stmts, attempt, factor); err != nil {
			return fmt.Errorf("record attempt factors: %w", err)
		}
	}
	return nil
}

var _ UserAction = (*recordAttemptFactorsAction)(nil)
