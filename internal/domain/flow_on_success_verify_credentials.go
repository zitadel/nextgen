package domain

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// isNoRows reports whether err is the storage layer's no-rows error.
// Centralised so verify_credentials does not depend on the dialect
// packages.
func isNoRows(err error) bool {
	var nrfe *database.NoRowFoundError
	return errors.As(err, &nrfe)
}

// flowUserReader is the narrow read seam [FlowVerifyCredentialsHandler]
// depends on. [UserRepository] satisfies it; tests can swap in a
// minimal fake without implementing the repository's full surface.
type flowUserReader interface {
	ProjectIDCondition(projectID string) database.Condition
	AttributesCondition(attributes []Attribute) database.Condition
	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*User, error)
}

// flowUserPasswordReader is the narrow read seam for
// [FlowVerifyCredentialsHandler]'s password lookup. [UserPasswordRepository]
// satisfies it.
type flowUserPasswordReader interface {
	UniqueCondition(projectID, userID string) database.Condition
	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*UserPassword, error)
}

// FlowVerifyCredentialsHandler is the MVP `verify_credentials`
// [FlowOnSuccessHandler]. It resolves the identifier to a user, fetches
// the stored password hash, and compares it against the submitted
// password. Outcomes:
//
//   - identifier resolves and password matches: returns
//     [FlowOnSuccessResult.UserID] set; the state machine advances on
//     the submitted action.
//   - identifier does not resolve: returns Outcome =
//     [FlowImplicitOutcomeUserNotFound]; the state machine advances on
//     the user_not_found transition declared by the step.
//   - identifier resolves but password mismatches: returns
//     StepError = [FlowImplicitOutcomeInvalidCredentials]; the state
//     machine keeps the user on the current step and surfaces the
//     error.
//
// When the eventual auth-attempt domain lands, this handler's body
// moves behind that service.
type FlowVerifyCredentialsHandler struct {
	users     flowUserReader
	passwords flowUserPasswordReader
	hasher    FlowPasswordHasher
}

// NewFlowVerifyCredentialsHandler wires the handler's dependencies.
// In production the seams are satisfied by [UserRepository] and
// [UserPasswordRepository].
func NewFlowVerifyCredentialsHandler(users flowUserReader, passwords flowUserPasswordReader, hasher FlowPasswordHasher) *FlowVerifyCredentialsHandler {
	return &FlowVerifyCredentialsHandler{users: users, passwords: passwords, hasher: hasher}
}

var _ FlowOnSuccessHandler = (*FlowVerifyCredentialsHandler)(nil)

func (h *FlowVerifyCredentialsHandler) Handle(ctx context.Context, client database.QueryExecutor, in FlowOnSuccessInput) (FlowOnSuccessResult, error) {
	identifierName, identifierValue, hasID := findIdentifierField(in.Resolved.Fields, in.Fields)
	if !hasID {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: verify_credentials step has no identifier field", ErrIntegrity)
	}
	_, passwordValue, hasPassword := findPasswordField(in.Resolved.Fields, in.Fields)
	if !hasPassword {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: verify_credentials step has no password field", ErrIntegrity)
	}

	cond := database.And(
		h.users.ProjectIDCondition(in.ProjectID),
		h.users.AttributesCondition([]Attribute{{Key: identifierName, Value: identifierValue}}),
	)
	user, err := h.users.Get(ctx, client, database.WithCondition(cond))
	if err != nil {
		if isNoRows(err) {
			return FlowOnSuccessResult{Outcome: FlowImplicitOutcomeUserNotFound}, nil
		}
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success verify_credentials: lookup user: %w", err)
	}

	pw, err := h.passwords.Get(ctx, client,
		database.WithCondition(h.passwords.UniqueCondition(in.ProjectID, user.ID)),
	)
	if err != nil {
		if isNoRows(err) {
			msg := FlowImplicitOutcomeInvalidCredentials
			return FlowOnSuccessResult{StepError: &msg}, nil
		}
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success verify_credentials: fetch password: %w", err)
	}

	ok, err := h.hasher.Verify(asString(passwordValue), pw.EncodedHash)
	if err != nil {
		return FlowOnSuccessResult{}, fmt.Errorf("flow on_success verify_credentials: verify password: %w", err)
	}
	if !ok {
		msg := FlowImplicitOutcomeInvalidCredentials
		return FlowOnSuccessResult{StepError: &msg}, nil
	}

	return FlowOnSuccessResult{UserID: user.ID}, nil
}

