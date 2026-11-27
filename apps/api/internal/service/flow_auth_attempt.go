package service

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"

	"github.com/zitadel/nextgen/internal/flowengine"
)

// FlowAuthAttempts implements [flowengine.AuthAttemptService] over the
// broader [AuthAttemptService]. Each Submit* collapses the underlying
// issue-then-verify cycle so the state machine never deals with challenge IDs.
type FlowAuthAttempts struct {
	attempts AuthAttemptService
	// db backs the reads that only inspect the attempt.
	db StatementPool
	// schemaStore backs the create-user action a provisional passkey
	// registration applies inside its verify transaction.
	schemaStore domain.JSONSchemaStore
	// protection spends the sign-up proof a provisional passkey registration
	// needs before it creates its user, as a password sign-up does.
	protection SignupProtection
}

func NewFlowAuthAttempts(attempts AuthAttemptService, db StatementPool, schemaStore domain.JSONSchemaStore, protection SignupProtection) *FlowAuthAttempts {
	return &FlowAuthAttempts{attempts: attempts, db: db, schemaStore: schemaStore, protection: protection}
}

var _ flowengine.AuthAttemptService = (*FlowAuthAttempts)(nil)

func (a *FlowAuthAttempts) Start(ctx context.Context, in flowengine.CreateAttemptInput) (string, error) {
	attempt, err := a.attempts.Create(ctx, CreateAuthAttemptInput{
		ProjectID:      in.ProjectID,
		SessionID:      in.SessionID,
		RequiredChecks: in.RequiredChecks,
		FlowID:         in.FlowID,
	})
	if err != nil {
		return "", err
	}
	return attempt.ID, nil
}

func (a *FlowAuthAttempts) Usable(ctx context.Context, projectID, attemptID string) (bool, error) {
	attempt, err := a.db.Statements().GetAuthAttemptByID(ctx, projectID, attemptID)
	if err != nil {
		return false, fmt.Errorf("flow auth attempts: read auth attempt: %w", err)
	}
	return !attempt.IsExpired() && !attempt.IsHandedOff(), nil
}

func (a *FlowAuthAttempts) SubmitIdentifier(ctx context.Context, in flowengine.SubmitIdentifierInput) (string, error) {
	challengeID, err := a.issueChallengeID(ctx, in.ProjectID, in.AttemptID, UserChallenge{}, domain.AuthCheckTypeUser)
	if err != nil {
		return "", err
	}
	attempt, err := a.attempts.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: challengeID,
		Proof: UserProof{
			AttributeName: in.AttributeName,
			LoginName:     in.Value,
			UserSchemaURL: in.UserSchemaURL,
			Register:      in.Register,
		},
	})
	if err != nil {
		return "", err
	}
	factor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	if !ok {
		return "", fmt.Errorf("flow auth attempts: user factor missing after verify")
	}
	return factor.UserID, nil
}

func (a *FlowAuthAttempts) Handoff(ctx context.Context, in flowengine.HandoffInput) (flowengine.HandoffOutput, error) {
	attempt, err := a.attempts.Handoff(ctx, HandoffInput{
		ProjectID: in.ProjectID,
		AttemptID: in.AttemptID,
	})
	if err != nil {
		return flowengine.HandoffOutput{}, err
	}
	if attempt.HandoffToken == nil {
		return flowengine.HandoffOutput{}, fmt.Errorf("flow auth attempts: handoff token missing after handoff")
	}
	return flowengine.HandoffOutput{
		Token:     attempt.HandoffToken.Plain(),
		ExpiresAt: attempt.HandoffToken.ExpiresAt(attempt.HandedOffAt),
	}, nil
}

func (a *FlowAuthAttempts) SubmitPassword(ctx context.Context, in flowengine.SubmitPasswordInput) error {
	challengeID, err := a.issueChallengeID(ctx, in.ProjectID, in.AttemptID, PasswordChallenge{}, domain.AuthCheckTypePassword)
	if err != nil {
		return err
	}
	_, err = a.attempts.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: challengeID,
		Proof:       PasswordProof{Password: in.Plain},
	})
	return err
}

func (a *FlowAuthAttempts) issueChallengeID(ctx context.Context, projectID, attemptID string, challenge Challenge, typ domain.AuthCheckType) (string, error) {
	attempt, err := a.attempts.IssueChallenge(ctx, IssueChallengeInput{
		ProjectID: projectID,
		AttemptID: attemptID,
		Challenge: challenge,
	})
	if err != nil {
		return "", err
	}
	ch, ok := attempt.ChallengeByType(typ)
	if !ok {
		return "", fmt.Errorf("flow auth attempts: challenge %d missing after issue", typ)
	}
	return ch.GetID(), nil
}

// IssueChallenge issues the challenge its params describe and returns its id
// plus the options the client runs the ceremony with. Unlike the Submit*
// methods it does not verify — the proof arrives on a later submit (see
// [FlowAuthAttempts.VerifyChallenge]).
func (a *FlowAuthAttempts) IssueChallenge(ctx context.Context, in flowengine.IssueChallengeInput) (flowengine.IssuedChallenge, error) {
	switch params := in.Params.(type) {
	case flowengine.PasskeyChallengeParams:
		return a.issuePasskeyChallenge(ctx, in, params)
	case flowengine.PasskeyRegistrationChallengeParams:
		return a.issuePasskeyRegistrationChallenge(ctx, in, params)
	default:
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: unsupported challenge params %T", in.Params)
	}
}

// VerifyChallenge verifies the proof against the challenge identified by
// ChallengeID, by the check it was issued as.
func (a *FlowAuthAttempts) VerifyChallenge(ctx context.Context, in flowengine.VerifyChallengeInput) (string, error) {
	switch in.Check {
	case domain.AuthCheckTypePasskey:
		return a.verifyPasskey(ctx, in)
	case domain.AuthCheckTypePasskeyRegistration:
		return "", a.verifyPasskeyRegistration(ctx, in)
	default:
		return "", fmt.Errorf("flow auth attempts: unsupported challenge check %s", in.Check)
	}
}

// issuePasskeyChallenge issues a WebAuthn assertion challenge; its options are
// the PublicKeyCredentialRequestOptions the browser hands to
// navigator.credentials.get().
func (a *FlowAuthAttempts) issuePasskeyChallenge(ctx context.Context, in flowengine.IssueChallengeInput, params flowengine.PasskeyChallengeParams) (flowengine.IssuedChallenge, error) {
	origins, err := parseOrigins(params.RPOrigins)
	if err != nil {
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: %w", err)
	}

	attempt, err := a.attempts.IssueChallenge(ctx, IssueChallengeInput{
		ProjectID: in.ProjectID,
		AttemptID: in.AttemptID,
		Challenge: PasskeyChallenge{
			UserVerification: params.UserVerification,
			RPID:             params.RPID,
			RPOrigins:        origins,
		},
	})
	if err != nil {
		return flowengine.IssuedChallenge{}, err
	}

	ch, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskey)
	if !ok {
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: passkey challenge missing after issue")
	}
	passkeyCh, ok := ch.(*domain.AuthChallengePasskey)
	if !ok {
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: unexpected passkey challenge type %T", ch)
	}
	options, err := domain.BuildPasskeyRequestOptions(passkeyCh)
	if err != nil {
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: build passkey options: %w", err)
	}
	return flowengine.IssuedChallenge{ChallengeID: ch.GetID(), Options: options}, nil
}

// verifyPasskey verifies the assertion and returns the authenticated user id
// (resolved from the assertion for a discoverable login, or the
// already-pinned user otherwise).
func (a *FlowAuthAttempts) verifyPasskey(ctx context.Context, in flowengine.VerifyChallengeInput) (string, error) {
	attempt, err := a.attempts.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: in.ChallengeID,
		Proof:       PasskeyProof{AssertionResponse: in.Proof},
	})
	if err != nil {
		return "", err
	}
	factor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	if !ok {
		return "", fmt.Errorf("flow auth attempts: user factor missing after passkey verify")
	}
	return factor.UserID, nil
}

// issuePasskeyRegistrationChallenge issues a WebAuthn registration challenge;
// it returns the (possibly minted) user handle, and its options are the
// PublicKeyCredentialCreationOptions the browser hands to
// navigator.credentials.create().
func (a *FlowAuthAttempts) issuePasskeyRegistrationChallenge(ctx context.Context, in flowengine.IssueChallengeInput, params flowengine.PasskeyRegistrationChallengeParams) (flowengine.IssuedChallenge, error) {
	origins, err := parseOrigins(params.RPOrigins)
	if err != nil {
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: %w", err)
	}

	attempt, err := a.attempts.IssueChallenge(ctx, IssueChallengeInput{
		ProjectID: in.ProjectID,
		AttemptID: in.AttemptID,
		Challenge: PasskeyRegistrationChallenge{
			UserID:      params.UserID,
			Username:    params.Username,
			DisplayName: params.DisplayName,
			RPID:        params.RPID,
			RPOrigins:   origins,
		},
	})
	if err != nil {
		return flowengine.IssuedChallenge{}, err
	}

	ch, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
	if !ok {
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: registration challenge missing after issue")
	}
	registrationCh, ok := ch.(*domain.AuthChallengePasskeyRegistration)
	if !ok {
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: unexpected registration challenge type %T", ch)
	}
	options, err := domain.BuildPasskeyCreationOptions(registrationCh)
	if err != nil {
		return flowengine.IssuedChallenge{}, fmt.Errorf("flow auth attempts: build creation options: %w", err)
	}
	return flowengine.IssuedChallenge{
		ChallengeID: ch.GetID(),
		UserID:      registrationCh.UserID,
		Options:     options,
		Provisional: registrationCh.Provisional,
	}, nil
}

// verifyPasskeyRegistration verifies the attestation. The create-user factory
// rides along; the attempt service invokes it with the persisted challenge's
// authoritative user handle, and only when that challenge is provisional.
// That makes it a sign-up, so the factory spends the flow's sign-up proof
// before it builds the user.
func (a *FlowAuthAttempts) verifyPasskeyRegistration(ctx context.Context, in flowengine.VerifyChallengeInput) error {
	_, err := a.attempts.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: in.ChallengeID,
		Proof: PasskeyRegistrationProof{
			AttestationResponse: in.Proof,
			CreateUser: func(ctx context.Context, userID string) ([]UserAction, error) {
				// Spent once, before the user exists: a registration that
				// fails after this still costs the proof, as a password
				// sign-up's does.
				signUp := in.SignUp
				if a.protection == nil || signUp == nil || signUp.State == nil || signUp.State.ProjectID != in.ProjectID {
					return nil, domain.ErrFlowIntegrity()
				}
				if err := a.protection.Consume(ctx, signUp.State, signUp.GateProofs[domain.SignupGate]); err != nil {
					return nil, err
				}
				return []UserAction{NewCreateUserAction(
					CreateUserInput{
						ProjectID:  in.ProjectID,
						SchemaURL:  signUp.UserSchemaURL,
						Attributes: signUp.UserAttributes,
						ID:         userID,
					},
					a.schemaStore,
				)}, nil
			},
		},
	})
	return err
}
