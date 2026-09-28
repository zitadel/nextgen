package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowCreateUserWithSsoHandler implements the `create_user_with_sso`
// on_success: persist the account an external identity arrived without.
//
// It is the password handler minus the password. The provider answered for
// this email, so no secret is collected and none is set -- which is exactly
// why a separate handler exists rather than a flag on the other one: a user
// created here has no password credential at all, and setting an empty one
// would leave a login method nobody can use.
//
// Stub, in the sense of #1042: the external identity is not linked to the new
// user, because nothing stores that link yet (#1033). The consequence is that
// the same provider account returning later is a new identity again and lands
// back on `register-sso`, which then reports `user_already_exists` and routes
// to `sso-conflict`. That is the honest behaviour for a server that has not
// remembered the link, not a silent failure.
type FlowCreateUserWithSsoHandler struct {
	userService UserService
	schemaStore domain.JSONSchemaStore
	db          StatementPool
}

func NewFlowCreateUserWithSsoHandler(
	userService UserService,
	schemaStore domain.JSONSchemaStore,
	db StatementPool,
) *FlowCreateUserWithSsoHandler {
	return &FlowCreateUserWithSsoHandler{
		userService: userService,
		schemaStore: schemaStore,
		db:          db,
	}
}

var _ domain.FlowOnSuccessHandler = (*FlowCreateUserWithSsoHandler)(nil)

func (h *FlowCreateUserWithSsoHandler) Handle(
	ctx context.Context,
	in domain.FlowOnSuccessInput,
) (domain.FlowOnSuccessResult, error) {
	// Guard: this mutation mints a user with no password, so it must only run
	// when a provider callback actually verified an identity in this flow.
	// Without it, a submit-only flow could route here and create an account
	// with no proof of identity at all.
	if !in.State.VerifiedIdentity.Valid() {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user_with_sso without a verified identity", domain.ErrFlowIntegrity())
	}

	userID, err := h.db.Statements().NewManagedID(string(domain.PrefixUser))
	if err != nil {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("create_user_with_sso: mint user id: %w", err)
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
	// The provider proved who this is, so the user factor is recorded in the
	// same transaction -- otherwise the session exchanged at the end of the
	// flow would be bound to a user with no factors at all. Only the user
	// factor is recorded: there is no dedicated "external sign-in" check type
	// yet, so the fact that the proof came from a provider is not captured as
	// a factor. (#1033 stores the identity link, not an auth factor.)
	recordFactorsAction := &recordAttemptFactorsAction{
		projectID: in.ProjectID,
		attemptID: in.State.AuthAttemptID,
		factors:   []domain.AuthFactor{&domain.AuthFactorUser{UserID: userID}},
	}

	if err := h.userService.ApplyActions(ctx, createUserAction, recordFactorsAction); err != nil {
		if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
			return domain.FlowOnSuccessResult{StepError: new("user_already_exists")}, nil
		}
		return domain.FlowOnSuccessResult{}, err
	}

	return domain.FlowOnSuccessResult{UserID: userID, Irreversible: true}, nil
}
