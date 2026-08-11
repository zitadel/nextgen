package service

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Service interface -------------------------------------------------------

// AuthAttemptService is the primary port for auth attempt operations.
// REST handler, OIDC server, SAML server and the flow engine all depend on this interface.
type AuthAttemptService interface {
	// Create and store a new auth attempt.
	//
	// If input.SessionID is set, the existing session's verified checks are copied
	// into the attempt for step-up authentication against an existing session.
	//
	// If input.RequiredChecks are nil, the project's default required checks are used.
	//
	// errors: domain.ErrAuthAttemptInvalidRequest, domain.ErrInternal
	Create(ctx context.Context, input CreateAuthAttemptInput) (*domain.AuthAttempt, error)

	// GetByID retrieves an auth attempt including all factors and challenges by its ID.
	//
	// errors: domain.ErrAuthAttemptNotFound, domain.ErrInternal
	GetByID(ctx context.Context, projectID, attemptID string) (*domain.AuthAttempt, error)

	// IssueChallenge creates and returns a new challenge for the given check type.
	// An existing challenge of the same type will be overwritten.
	//
	// For passkey challenges, the user check must already be verified, so the user ID is known
	// for retrieving registered credentials.
	//
	// errors: domain.ErrAuthAttemptNotFound, domain.ErrAuthAttemptInvalidRequest, domain.ErrAuthAttemptInvalidState, domain.ErrAuthAttemptAlreadyHandedOff, domain.ErrInternal
	IssueChallenge(ctx context.Context, input IssueChallengeInput) (*domain.AuthAttempt, error)

	// VerifyProof verifies the submitted proof against the challenge identified by ChallengeID.
	//
	// On success, it persists the verification and marks the attempt complete if all
	// required checks are now satisfied.
	//
	// On failure, it records the failed attempt for rate-limiting purposes.
	//
	// The ChallengeID must match the ID returned by IssueChallenge to prevent use of
	// stale proofs after a challenge is re-issued.
	//
	// errors: domain.ErrAuthAttemptNotFound, domain.ErrAuthAttemptStaleChallenge, domain.ErrAuthAttemptInvalidRequest, domain.ErrAuthAttemptProofRejected, domain.ErrAuthAttemptInvalidState, domain.ErrAuthAttemptAlreadyHandedOff, domain.ErrInternal
	VerifyProof(ctx context.Context, input VerifyProofInput) (*domain.AuthAttempt, error)

	// Handoff mints a single-use handoff token for a completed attempt.
	//
	// The client exchanges the token at POST /sessions/exchange to create
	// a new session or add factors to an existing session.
	//
	// The attempt must be in a completed state and not expired.
	//
	// errors: domain.ErrAuthAttemptNotFound, domain.ErrAuthAttemptInvalidState, domain.ErrAuthAttemptNotCompleted, domain.ErrAuthAttemptAlreadyHandedOff, domain.ErrInternal
	Handoff(ctx context.Context, input HandoffInput) (*domain.AuthAttempt, error)

	// RegisterCreatedUser registers a newly-created user's ID as a verified user
	// factor directly on the auth attempt, bypassing the challenge/proof cycle.
	// Used after on_success: create_user and passkey registration so the session
	// receives user_id after exchange.
	RegisterCreatedUser(ctx context.Context, projectID, attemptID, userID string) error
}

// ---- Input types -------------------------------------------------------------

type CreateAuthAttemptInput struct {
	ProjectID string
	// SessionID is set for step-up auth against an existing session.
	SessionID *string
	// RequiredChecks overrides the project's default policy.
	// Used by the OIDC adapter (acr_values) and flow engine.
	// If nil the project's DefaultRequiredChecks are used.
	RequiredChecks []domain.AuthCheckType
}

type IssueChallengeInput struct {
	ProjectID string
	AttemptID string
	// Challenge is a discriminated union — use one of the Challenge* types below.
	Challenge Challenge
}

type VerifyProofInput struct {
	ProjectID string
	AttemptID string
	// ChallengeID must match the ID returned by IssueChallenge.
	// Prevents use of stale proofs after a challenge is re-issued.
	ChallengeID string
	// Proof is a discriminated union — use one of the Proof* types below.
	Proof Proof
}

type HandoffInput struct {
	ProjectID      string
	AttemptID      string
	IdempotencyKey *string
}

// ---- Challenge types (discriminated union) --------------------------------------

// Challenge is implemented by each check-type-specific challenge value.
type Challenge interface {
	ChallengeCheckType() domain.AuthCheckType
}

// UserChallenge identifies the user by login name (email, username, phone).
type UserChallenge struct{}

func (UserChallenge) ChallengeCheckType() domain.AuthCheckType { return domain.AuthCheckTypeUser }

// PasswordChallenge carries the plaintext password for verification.
type PasswordChallenge struct{}

func (PasswordChallenge) ChallengeCheckType() domain.AuthCheckType {
	return domain.AuthCheckTypePassword
}

// PasskeyChallenge carries the raw WebAuthn assertion response bytes.
type PasskeyChallenge struct {
	UserVerification string
	RPID             string
	RPOrigins        []url.URL
}

func (PasskeyChallenge) ChallengeCheckType() domain.AuthCheckType { return domain.AuthCheckTypePasskey }

// ---- Proof types (discriminated union) --------------------------------------

// Proof is implemented by each check-type-specific proof value.
type Proof interface {
	proofCheckType() domain.AuthCheckType
}

// UserProof identifies the user by login name (email, username, phone).
type UserProof struct {
	AttributeName string
	LoginName     string
}

func (UserProof) proofCheckType() domain.AuthCheckType { return domain.AuthCheckTypeUser }

// PasswordProof carries the plaintext password for verification.
type PasswordProof struct {
	Password string
}

func (PasswordProof) proofCheckType() domain.AuthCheckType { return domain.AuthCheckTypePassword }

// PasskeyProof carries the raw WebAuthn assertion response bytes.
type PasskeyProof struct {
	AssertionResponse []byte
}

func (PasskeyProof) proofCheckType() domain.AuthCheckType { return domain.AuthCheckTypePasskey }

// ---- Secondary ports -------------------------------------------------------------

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/auth_attempt.mock.go . SessionResolver,UserLookup

type SessionResolver interface {
	Get(ctx context.Context, projectID, sessionID string) (*domain.Session, error)
}

type UserLookup interface {
	GetByAttributes(ctx context.Context, projectID string, attrs []domain.Attribute) (*domain.User, error)
}

// ---- Implementation ----------------------------------------------------------

type authAttemptService struct {
	stmts            StatementPool
	sessions         SessionResolver
	users            UserLookup
	passwordVerifier crypto.HashVerifier
}

func NewAuthAttemptService(
	stmts StatementPool,
	sessions SessionResolver,
	users UserLookup,
	passwordVerifier crypto.HashVerifier,
) AuthAttemptService {
	return &authAttemptService{
		stmts:            stmts,
		sessions:         sessions,
		users:            users,
		passwordVerifier: passwordVerifier,
	}
}

// Create creates a new auth attempt.
// If input.SessionID is set, the existing session's verified checks are copied
// into the attempt for step-up auth — no new session is created.
func (s *authAttemptService) Create(ctx context.Context, input CreateAuthAttemptInput) (res *domain.AuthAttempt, err error) {
	requiredChecks := input.RequiredChecks
	if requiredChecks == nil {
		// TODO: load project default required checks
	}

	opts := make([]domain.AuthAttemptOption, 0, 1)
	if input.SessionID != nil {
		session, err := s.sessions.Get(ctx, input.ProjectID, *input.SessionID)
		if err != nil {
			if errors.Is(err, domain.ErrSessionNotFound()) {
				return nil, domain.ErrAuthAttemptInvalidRequest().WithParent(err).WithMessage("The session was not found.")
			}
			return nil, domain.ErrInternal(err).WithMessage("Failed to load the session.")
		}
		opts = append(opts, domain.WithSession(input.SessionID, session.Factors...))
	}

	attempt, err := domain.NewAuthAttempt(input.ProjectID, requiredChecks, opts...)
	if err != nil {
		return nil, err
	}

	if err = s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateAuthAttempt(ctx, attempt); err != nil {
			return err
		}
		payload := domain.AuthAttemptCreatedPayload{}
		if ac, ok := audit.ActorFromContext(ctx); ok && ac.FlowID != nil {
			payload.FlowID = *ac.FlowID
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeAuthAttemptCreated,
			Category:   domain.EventCategoryAuth,
			ProjectID:  attempt.ProjectID,
			EntityType: "auth_attempt",
			EntityID:   attempt.ID,
			Payload:    payload,
		})
	}); err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("Failed to create the auth attempt.")
	}
	return attempt, nil
}

// GetByID retrieves an auth attempt by its ID and all its factors and challenges.
func (s *authAttemptService) GetByID(ctx context.Context, projectID, attemptID string) (*domain.AuthAttempt, error) {
	attempt, err := s.stmts.Statements().GetAuthAttemptByID(ctx, projectID, attemptID)
	if err != nil {
		if errors.Is(err, domain.ErrAuthAttemptNotFound()) {
			return nil, err
		}
		return nil, domain.ErrInternal(err).WithMessage("Failed to load the auth attempt.")
	}
	return attempt, nil
}

// IssueChallenge issues a challenge for the given check type on an existing attempt.
// For passkey, the user check must already be verified so the user ID is known.
func (s *authAttemptService) IssueChallenge(ctx context.Context, input IssueChallengeInput) (*domain.AuthAttempt, error) {
	attempt, err := s.stmts.Statements().GetAuthAttemptByID(ctx, input.ProjectID, input.AttemptID)
	if err != nil {
		return nil, err
	}

	challenge, err := s.buildChallenge(ctx, attempt, input.Challenge)
	if err != nil {
		return nil, err
	}

	if err := s.stmts.Statements().SetAuthAttemptChallenge(ctx, input.ProjectID, input.AttemptID, challenge); err != nil {
		return nil, err
	}

	return attempt, nil
}

// VerifyProof verifies the submitted proof against the challenge identified by ChallengeID.
// On success, it persists the verification and marks the attempt complete if all
// required checks are now satisfied.
// On failure, it records the failed attempt for rate-limiting purposes.
func (s *authAttemptService) VerifyProof(ctx context.Context, input VerifyProofInput) (res *domain.AuthAttempt, err error) {
	attempt, err := s.stmts.Statements().GetAuthAttemptByID(ctx, input.ProjectID, input.AttemptID)
	if err != nil {
		return nil, err
	}

	challenge, factor, err := s.verify(ctx, attempt, input.Proof, input.ChallengeID)
	if err != nil {
		// Record the failure for rate-limiting — best effort, don't shadow
		// the original error. Skip when verify couldn't identify a challenge row.
		if challenge != nil {
			_ = s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
				if err := tx.Statements().AuthAttemptChallengeFailed(ctx, input.ProjectID, input.AttemptID, challenge); err != nil {
					return err
				}
				return emitAuthCheck(ctx, tx.Statements(), input.ProjectID, challenge, false)
			})
		}
		return nil, err
	}

	err = s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().AuthAttemptChallengeSucceeded(ctx, input.ProjectID, input.AttemptID, factor, challenge.GetID()); err != nil {
			return err
		}
		return emitAuthCheck(ctx, tx.Statements(), input.ProjectID, challenge, true)
	})
	if err != nil {
		return nil, err
	}
	attempt.SetCheck(factor) // Update the attempt with the successful factor for accurate state in the response

	return attempt, nil
}

// Handoff mints a single-use handoff token for a completed attempt.
// The client exchanges the token at POST /sessions/exchange.
func (s *authAttemptService) Handoff(ctx context.Context, input HandoffInput) (*domain.AuthAttempt, error) {
	attempt, err := s.stmts.Statements().GetAuthAttemptByID(ctx, input.ProjectID, input.AttemptID)
	if err != nil {
		return nil, err
	}

	if err := attempt.PrepareHandoff(); err != nil {
		return nil, err
	}

	err = s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().HandoffAuthAttempt(ctx, attempt); err != nil {
			return err
		}
		payload := domain.AuthAttemptHandedOffPayload{}
		if attempt.SessionID != nil {
			payload.SessionID = *attempt.SessionID
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeAuthAttemptHandedOff,
			Category:   domain.EventCategoryAuth,
			ProjectID:  attempt.ProjectID,
			EntityType: "auth_attempt",
			EntityID:   attempt.ID,
			Payload:    payload,
		})
	})
	if err != nil {
		return nil, err
	}
	return attempt, nil
}

// RegisterCreatedUser registers a newly-created user's ID as a verified user
// factor on the auth attempt without a challenge/proof cycle. It issues a
// synthetic user challenge and immediately marks it succeeded so the exchange
// can promote the user_id to the session.
func (s *authAttemptService) RegisterCreatedUser(ctx context.Context, projectID, attemptID, userID string) error {
	challenge := &domain.AuthChallengeUser{}
	return s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().SetAuthAttemptChallenge(ctx, projectID, attemptID, challenge); err != nil {
			return err
		}
		factor := &domain.AuthFactorUser{UserID: userID}
		if err := tx.Statements().AuthAttemptChallengeSucceeded(ctx, projectID, attemptID, factor, challenge.GetID()); err != nil {
			return err
		}
		return emitAuthCheck(ctx, tx.Statements(), projectID, challenge, true)
	})
}

func emitAuthCheck(ctx context.Context, stmts EventStatements, projectID string, challenge domain.AuthChallenge, succeeded bool) error {
	eventType := domain.EventTypeAuthCheckFailed
	if succeeded {
		eventType = domain.EventTypeAuthCheckSucceeded
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAuth,
		ProjectID:  projectID,
		EntityType: "check",
		EntityID:   challenge.GetID(),
		Payload: domain.AuthCheckPayload{
			CheckID:   challenge.GetID(),
			CheckType: challenge.Type().String(),
		},
	})
}

// buildChallenge constructs the challenge for the given check type.
func (s *authAttemptService) buildChallenge(ctx context.Context, attempt *domain.AuthAttempt, challenge Challenge) (domain.AuthChallenge, error) {
	switch typ := challenge.(type) {
	case UserChallenge:
		if err := attempt.PrepareUserChallenge(); err != nil {
			return nil, err
		}
		return attempt.SetUserChallenge(), nil

	case PasswordChallenge:
		if err := attempt.PreparePasswordChallenge(); err != nil {
			return nil, err
		}
		return attempt.SetPasswordChallenge(), nil

	case PasskeyChallenge:
		userID, err := attempt.PreparePasskeyChallenge()
		if err != nil {
			return nil, err
		}
		var passkeys []*domain.UserPasskey
		if userID != "" {
			passkeys, err = s.listUserPasskeys(ctx, attempt.ProjectID, userID)
			if err != nil {
				return nil, domain.ErrInternal(err).WithMessage("failed to load user passkeys")
			}
		}
		passkeyChallenge, err := domain.CreatePasskeyChallenge(userID, passkeys, typ.UserVerification, typ.RPID, typ.RPOrigins)
		if err != nil {
			return nil, err
		}
		return attempt.SetPasskeyChallenge(passkeyChallenge), nil

	default:
		return nil, domain.ErrAuthAttemptInvalidRequest()
	}
}

// verify dispatches proof verification to the appropriate secondary port.
// Returns the checker to persist (always, even on failure) and any error.
func (s *authAttemptService) verify(ctx context.Context, attempt *domain.AuthAttempt, proof Proof, challengeID string) (domain.AuthChallenge, domain.AuthFactor, error) {
	switch p := proof.(type) {
	case UserProof:
		userChallenge, err := attempt.PrepareUserVerification(challengeID)
		if err != nil {
			return nil, nil, err
		}
		user, err := s.users.GetByAttributes(ctx, attempt.ProjectID, []domain.Attribute{{
			Key:   domain.AttributeKey(p.AttributeName),
			Value: p.LoginName,
		}})
		if err != nil {
			return userChallenge, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		return userChallenge, attempt.SetUserFactor(user), nil

	case PasswordProof:
		passwordChallenge, userFactor, err := attempt.PreparePasswordVerification(challengeID)
		if err != nil {
			return nil, nil, err
		}
		password, err := s.stmts.Statements().GetUserPassword(ctx, database.And(
			database.Equal(database.Col(domain.UserPasswordFieldProjectID), attempt.ProjectID),
			database.Equal(database.Col(domain.UserPasswordFieldUserID), userFactor.UserID),
		))
		if err != nil {
			return passwordChallenge, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		if err := password.Verify(p.Password, s.passwordVerifier); err != nil {
			return passwordChallenge, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		return passwordChallenge, attempt.SetPasswordFactor(), nil

	case PasskeyProof:
		challenge, userFactor, err := attempt.PreparePasskeyVerification(challengeID)
		if err != nil {
			return nil, nil, err
		}
		passkeyChallenge := challenge.(*domain.AuthChallengePasskey)
		// userID is empty for a discoverable (usernameless) login; the user is then resolved
		// from the assertion's user handle inside VerifyPasskeyChallenge.
		var (
			userID   string
			passkeys []*domain.UserPasskey
		)
		if userFactor != nil {
			userID = userFactor.UserID
			passkeys, err = s.listUserPasskeys(ctx, attempt.ProjectID, userID)
			if err != nil {
				return nil, nil, err
			}
		}
		verification, err := domain.VerifyPasskeyChallenge(
			passkeyChallenge.PasskeyChallenge,
			p.AssertionResponse,
			userID,
			passkeys,
			func(userID string) ([]*domain.UserPasskey, error) {
				return s.listUserPasskeys(ctx, attempt.ProjectID, userID)
			},
		)
		if err != nil {
			return passkeyChallenge, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		// Discoverable login resolves the user cryptographically from the assertion; bind it onto
		// the attempt so the subject is pinned and the session/handoff carries the user id. For an
		// identified login the user factor is already present and unchanged.
		if userFactor == nil && verification.UserID != "" {
			attempt.SetUserFactor(&domain.User{ID: verification.UserID})
		}
		// Use the verified user as the source of truth: it is set for both identified and
		// discoverable logins, whereas userFactor is nil in the discoverable case.
		s.recordPasskeyUsage(ctx, attempt.ProjectID, verification)
		return passkeyChallenge, attempt.SetPasskeyFactor(verification), nil

	default:
		return nil, nil, domain.ErrAuthAttemptInvalidRequest().WithMessage("unsupported proof type")
	}
}

// recordPasskeyUsage persists sign count, backup state, and last-used time after a
// successful assertion. Best-effort: write failure must not reject an otherwise valid proof.
func (s *authAttemptService) recordPasskeyUsage(ctx context.Context, projectID string, v *domain.PasskeyVerification) {
	_ = s.stmts.Statements().UpdateUserPasskey(
		ctx,
		userPasskeyKeyFilter(projectID, v.UserID, domain.EncodePasskeyCredentialID(v.CredentialID)),
		&domain.UserPasskeySignCountUpdate{SignCount: int64(v.SignCount)},
		&domain.UserPasskeyBackupStateUpdate{BackupState: v.BackupState},
		&domain.UserPasskeyLastUsedAtUpdate{LastUsedAt: time.Now()},
	)
}

func (s *authAttemptService) listUserPasskeys(ctx context.Context, projectID, userID string) ([]*domain.UserPasskey, error) {
	result, err := s.stmts.Statements().ListUserPasskeys(ctx, &database.ListOptions[domain.UserPasskeyField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		),
	})
	if err != nil {
		return nil, err
	}
	return result.Items, nil
}

func userPasskeyKeyFilter(projectID, userID, credentialID string) database.Filter[domain.UserPasskeyField] {
	return database.And(
		database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		database.Equal(database.Col(domain.UserPasskeyFieldCredentialID), credentialID),
	)
}

var _ AuthAttemptService = (*authAttemptService)(nil)
