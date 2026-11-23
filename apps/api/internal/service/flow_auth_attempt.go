package service

import (
	"context"
	"fmt"
	"net/url"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowAuthAttemptAdapter adapts the broad [AuthAttemptService] surface
// to the narrow [domain.FlowAuthAttemptService] the flow state machine
// consumes. Each Submit* collapses the underlying issue-then-verify
// cycle so the state machine never deals with challenge IDs.
type FlowAuthAttemptAdapter struct {
	attempts AuthAttemptService
	// schemaStore backs the create-user action a provisional passkey
	// registration applies inside its verify transaction.
	schemaStore domain.JSONSchemaStore
	// protection spends the sign-up proof a provisional passkey registration
	// needs before it creates its user, as a password sign-up does.
	protection SignupProtection
}

func NewFlowAuthAttemptAdapter(attempts AuthAttemptService, schemaStore domain.JSONSchemaStore, protection SignupProtection) *FlowAuthAttemptAdapter {
	return &FlowAuthAttemptAdapter{attempts: attempts, schemaStore: schemaStore, protection: protection}
}

var _ domain.FlowAuthAttemptService = (*FlowAuthAttemptAdapter)(nil)

func (a *FlowAuthAttemptAdapter) Start(ctx context.Context, in domain.FlowCreateAttemptInput) (string, error) {
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

func (a *FlowAuthAttemptAdapter) SubmitIdentifier(ctx context.Context, in domain.FlowSubmitIdentifierInput) (string, error) {
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
		return "", fmt.Errorf("flow auth-attempt adapter: user factor missing after verify")
	}
	return factor.UserID, nil
}

func (a *FlowAuthAttemptAdapter) Handoff(ctx context.Context, in domain.FlowHandoffInput) (domain.FlowHandoffOutput, error) {
	attempt, err := a.attempts.Handoff(ctx, HandoffInput{
		ProjectID: in.ProjectID,
		AttemptID: in.AttemptID,
	})
	if err != nil {
		return domain.FlowHandoffOutput{}, err
	}
	if attempt.HandoffToken == nil {
		return domain.FlowHandoffOutput{}, fmt.Errorf("flow auth-attempt adapter: handoff token missing after handoff")
	}
	return domain.FlowHandoffOutput{
		Token:     attempt.HandoffToken.Plain(),
		ExpiresAt: attempt.HandoffToken.ExpiresAt(attempt.HandedOffAt),
	}, nil
}

func (a *FlowAuthAttemptAdapter) SubmitPassword(ctx context.Context, in domain.FlowSubmitPasswordInput) error {
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

func (a *FlowAuthAttemptAdapter) issueChallengeID(ctx context.Context, projectID, attemptID string, challenge Challenge, typ domain.AuthCheckType) (string, error) {
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
		return "", fmt.Errorf("flow auth-attempt adapter: challenge %d missing after issue", typ)
	}
	return ch.GetID(), nil
}

// IssueChallenge issues the challenge its params describe and returns its id
// plus the options the client runs the ceremony with. Unlike the Submit*
// methods it does not verify — the proof arrives on a later submit (see
// [FlowAuthAttemptAdapter.VerifyChallenge]).
func (a *FlowAuthAttemptAdapter) IssueChallenge(ctx context.Context, in domain.FlowIssueChallengeInput) (domain.FlowIssuedChallenge, error) {
	switch params := in.Params.(type) {
	case domain.FlowPasskeyChallengeParams:
		return a.issuePasskeyChallenge(ctx, in, params)
	case domain.FlowPasskeyRegistrationChallengeParams:
		return a.issuePasskeyRegistrationChallenge(ctx, in, params)
	default:
		return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: unsupported challenge params %T", in.Params)
	}
}

// VerifyChallenge verifies the proof against the challenge identified by
// ChallengeID, by the check it was issued as.
func (a *FlowAuthAttemptAdapter) VerifyChallenge(ctx context.Context, in domain.FlowVerifyChallengeInput) (string, error) {
	switch in.Check {
	case domain.AuthCheckTypePasskey:
		return a.verifyPasskey(ctx, in)
	case domain.AuthCheckTypePasskeyRegistration:
		return "", a.verifyPasskeyRegistration(ctx, in)
	default:
		return "", fmt.Errorf("flow auth-attempt adapter: unsupported challenge check %s", in.Check)
	}
}

// issuePasskeyChallenge issues a WebAuthn assertion challenge; its options are
// the PublicKeyCredentialRequestOptions the browser hands to
// navigator.credentials.get().
func (a *FlowAuthAttemptAdapter) issuePasskeyChallenge(ctx context.Context, in domain.FlowIssueChallengeInput, params domain.FlowPasskeyChallengeParams) (domain.FlowIssuedChallenge, error) {
	origins := make([]url.URL, 0, len(params.RPOrigins))
	for _, o := range params.RPOrigins {
		u, err := url.Parse(o)
		if err != nil {
			return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: parse rp origin %q: %w", o, err)
		}
		origins = append(origins, *u)
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
		return domain.FlowIssuedChallenge{}, err
	}

	ch, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskey)
	if !ok {
		return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: passkey challenge missing after issue")
	}
	passkeyCh, ok := ch.(*domain.AuthChallengePasskey)
	if !ok {
		return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: unexpected passkey challenge type %T", ch)
	}
	options, err := domain.BuildPasskeyRequestOptions(passkeyCh)
	if err != nil {
		return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: build passkey options: %w", err)
	}
	return domain.FlowIssuedChallenge{ChallengeID: ch.GetID(), Options: options}, nil
}

// verifyPasskey verifies the assertion and returns the authenticated user id
// (resolved from the assertion for a discoverable login, or the
// already-pinned user otherwise).
func (a *FlowAuthAttemptAdapter) verifyPasskey(ctx context.Context, in domain.FlowVerifyChallengeInput) (string, error) {
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
		return "", fmt.Errorf("flow auth-attempt adapter: user factor missing after passkey verify")
	}
	return factor.UserID, nil
}

// issuePasskeyRegistrationChallenge issues a WebAuthn registration challenge;
// it returns the (possibly minted) user handle, and its options are the
// PublicKeyCredentialCreationOptions the browser hands to
// navigator.credentials.create().
func (a *FlowAuthAttemptAdapter) issuePasskeyRegistrationChallenge(ctx context.Context, in domain.FlowIssueChallengeInput, params domain.FlowPasskeyRegistrationChallengeParams) (domain.FlowIssuedChallenge, error) {
	origins, err := parseOrigins(params.RPOrigins)
	if err != nil {
		return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: %w", err)
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
		return domain.FlowIssuedChallenge{}, err
	}

	ch, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
	if !ok {
		return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: registration challenge missing after issue")
	}
	registrationCh, ok := ch.(*domain.AuthChallengePasskeyRegistration)
	if !ok {
		return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: unexpected registration challenge type %T", ch)
	}
	options, err := domain.BuildPasskeyCreationOptions(registrationCh)
	if err != nil {
		return domain.FlowIssuedChallenge{}, fmt.Errorf("flow auth-attempt adapter: build creation options: %w", err)
	}
	return domain.FlowIssuedChallenge{
		ChallengeID: ch.GetID(),
		UserID:      registrationCh.UserID,
		Options:     options,
	}, nil
}

// verifyPasskeyRegistration verifies the attestation. The create-user factory
// rides along; the attempt service invokes it with the persisted challenge's
// authoritative user handle, and only when that challenge is provisional.
// That makes it a sign-up, so the factory spends the flow's sign-up proof
// before it builds the user.
func (a *FlowAuthAttemptAdapter) verifyPasskeyRegistration(ctx context.Context, in domain.FlowVerifyChallengeInput) error {
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
