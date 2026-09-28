package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/maputil"
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
	// when a provider callback verified an identity in this flow. Without it, a
	// flow that routes a plain submit into create_user_with_sso would create an
	// account with no proof of identity at all.
	if !in.State.VerifiedIdentity.Valid() {
		return domain.FlowOnSuccessResult{}, fmt.Errorf("%w: create_user_with_sso without a verified identity", domain.ErrFlowIntegrity())
	}

	// The account is created from the identifier the provider vouched for, never
	// from CollectedData as submitted: a later submit merges over the callback's
	// prefilled value, so trusting the form would let a real callback for one
	// address mint an account for another. Writing it back into CollectedData
	// (rather than only into the create attributes) also means a uniqueness
	// collision rebinds on the verified address, not the submitted one.
	if err := h.bindVerifiedIdentifier(ctx, in); err != nil {
		return domain.FlowOnSuccessResult{}, err
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
	// The provider proved who this is, so the factors are recorded in the same
	// transaction -- otherwise the session exchanged at the end of the flow
	// would be bound to a user with no factors at all. Two factors are written:
	// the user factor binds the session to the new user, and the SSO factor
	// captures which provider vouched and for whom, so the attempt keeps a
	// durable record of the external proof independent of the sealed flow
	// cookie. The SSO factor is internal bookkeeping -- it has no wire method
	// and is filtered from API responses -- not the identity link itself, which
	// #1033 stores as (connection, subject) -> user.
	recordFactorsAction := &recordAttemptFactorsAction{
		projectID: in.ProjectID,
		attemptID: in.State.AuthAttemptID,
		factors: []domain.AuthFactor{
			&domain.AuthFactorUser{UserID: userID},
			&domain.AuthFactorSso{
				Provider: in.State.VerifiedIdentity.Provider,
				Subject:  in.State.VerifiedIdentity.Subject,
			},
		},
	}

	if err := h.userService.ApplyActions(ctx, createUserAction, recordFactorsAction); err != nil {
		// The identifier pre-check passed but the insert lost the unique
		// race: the provider's email already has an account. Route the
		// user_already_exists outcome (to the conflict step) rather than
		// re-rendering -- the user cannot change the address the provider gave.
		if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
			return domain.FlowOnSuccessResult{Outcome: domain.FlowImplicitOutcomeUserAlreadyExists}, nil
		}
		return domain.FlowOnSuccessResult{}, err
	}

	return domain.FlowOnSuccessResult{UserID: userID, Irreversible: true}, nil
}

// bindVerifiedIdentifier forces the collected identifier to the address the
// provider vouched for, so a submitted value cannot displace it. The value is
// written through the attribute key's path, because collected data nests a
// dotted attribute (`account.email` lives at UserData["account"]["email"]).
//
// The destination comes from the user schema's `x-identifier` designation
// rather than the step's resolved fields: this handler runs both from the
// engine (a submit on the collection step) and directly from a provider
// callback, and only the first has resolved fields to read. Refuses when the
// schema designates none -- there would be nowhere to anchor the verified
// address, and creating from the form alone is the hole this closes.
func (h *FlowCreateUserWithSsoHandler) bindVerifiedIdentifier(ctx context.Context, in domain.FlowOnSuccessInput) error {
	schema, err := h.schemaStore.GetJSONSchemaByID(ctx, in.ProjectID, in.UserSchemaURL)
	if err != nil {
		return fmt.Errorf("create_user_with_sso: read user schema: %w", err)
	}
	name := domain.DesignatedIdentifier(schema.Schema)
	if name == "" {
		return fmt.Errorf("%w: create_user_with_sso needs a designated identifier to bind the verified address to", domain.ErrFlowIntegrity())
	}
	if in.State.CollectedData.UserData == nil {
		in.State.CollectedData.UserData = map[string]any{}
	}
	if err := maputil.SetNested(in.State.CollectedData.UserData, domain.AttributeKey(name).Nodes(), in.State.VerifiedIdentity.Email); err != nil {
		return fmt.Errorf("create_user_with_sso: bind verified identifier %q: %w", name, err)
	}
	return nil
}
