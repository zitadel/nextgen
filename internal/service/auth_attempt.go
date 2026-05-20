package service

import (
	"context"
	"errors"
	"net/url"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/passwap"
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
	// errors: domain.ErrAuthAttemptNotFound, domain.ErrAuthAttemptInvalidRequest, domain.ErrAuthAttemptInvalidState, domain.ErrAuthAttemptAlreadyCompleted, domain.ErrInternal
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
	// errors: domain.ErrAuthAttemptNotFound, domain.ErrAuthAttemptStaleChallenge, domain.ErrAuthAttemptInvalidRequest, domain.ErrAuthAttemptProofRejected, domain.ErrAuthAttemptInvalidState, domain.ErrAuthAttemptAlreadyCompleted, domain.ErrInternal
	VerifyProof(ctx context.Context, input VerifyProofInput) (*domain.AuthAttempt, error)

	// Handoff mints a single-use handoff token for a completed attempt.
	//
	// The token is exchanged by the client at POST /sessions/exchange to create
	// a new session or add factors to an existing session.
	//
	// The attempt must be in a completed state and not expired.
	//
	// errors: domain.ErrAuthAttemptNotFound, domain.ErrAuthAttemptInvalidState, domain.ErrAuthAttemptNotCompleted, domain.ErrInternal
	Handoff(ctx context.Context, input HandoffInput) (*domain.AuthAttempt, error)
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
	LoginName string
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

type sessionResolver interface {
	GetByID(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) (*domain.Session, error)
}

type projectLoader interface {
	Get(ctx context.Context, client database.QueryExecutor, id string) (*domain.Project, error)
}

type userLookup interface {
	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.User, error)
	ProjectIDCondition(projectID string) database.Condition
	IDCondition(id string) database.Condition
	AttributesCondition(attributes []domain.Attribute) database.Condition
}

type userPasswords interface {
	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserPassword, error)
	UserIDCondition(userID string) database.Condition
	ProjectIDCondition(pid string) database.Condition
}

type userPasskeys interface {
	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.UserPasskey, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.UserPasskey, error)
	UserIDCondition(userID string) database.Condition
	ProjectIDCondition(pid string) database.Condition
}

// ---- Implementation ----------------------------------------------------------

type authAttemptService struct {
	pool             database.Pool
	attempts         domain.AuthAttemptRepository
	sessions         sessionResolver
	projects         projectLoader
	users            userLookup
	userPasswords    userPasswords
	userPasskeys     userPasskeys
	passwordVerifier *passwap.Swapper
}

func NewAuthAttemptService(
	pool database.Pool,
	attempts domain.AuthAttemptRepository,
	sessions sessionResolver,
	projects projectLoader,
	users userLookup,
	userPasswords userPasswords,
	userPasskeys userPasskeys,
	passwordVerifier *passwap.Swapper,
) AuthAttemptService {
	return &authAttemptService{
		pool:             pool,
		attempts:         attempts,
		sessions:         sessions,
		projects:         projects,
		users:            users,
		userPasswords:    userPasswords,
		userPasskeys:     userPasskeys,
		passwordVerifier: passwordVerifier,
	}
}

// Create creates a new auth attempt.
// If input.SessionID is set, the existing session's verified checks are copied
// into the attempt for step-up auth — no new session is created.
func (s *authAttemptService) Create(ctx context.Context, input CreateAuthAttemptInput) (res *domain.AuthAttempt, err error) {
	requiredChecks := input.RequiredChecks
	if requiredChecks == nil {
		// TODO: implement this
		//project, err := s.projects.Get(ctx, s.pool, input.ProjectID)
		//if err != nil {
		//	return nil, domain.ErrInternal(err).WithMessage("failed to load project config")
		//}
		// requiredChecks = project.DefaultRequiredChecks
	}

	opts := make([]domain.AuthAttemptOption, 0, 1)
	if input.SessionID != nil {
		session, err := s.sessions.GetByID(ctx, s.pool, input.ProjectID, *input.SessionID)
		if err != nil {
			if errors.Is(err, domain.ErrSessionNotFound()) {
				return nil, domain.ErrAuthAttemptInvalidRequest().WithParent(err).WithMessage("session not found")
			}
			return nil, domain.ErrInternal(err).WithMessage("failed to load session")
		}
		opts = append(opts, domain.WithSession(input.SessionID, session.Factors...))
	}

	attempt, err := domain.NewAuthAttempt(input.ProjectID, requiredChecks, opts...)
	if err != nil {
		return nil, err
	}

	if err = s.attempts.Create(ctx, s.pool, attempt); err != nil {
		return nil, err //TODO: error handling
	}
	return attempt, nil
}

func (s *authAttemptService) GetByID(ctx context.Context, projectID, attemptID string) (*domain.AuthAttempt, error) {
	return s.attempts.GetByID(ctx, s.pool, projectID, attemptID)
}

// IssueChallenge issues a challenge for the given check type on an existing attempt.
// For passkey, the user check must already be verified so the user ID is known.
func (s *authAttemptService) IssueChallenge(ctx context.Context, input IssueChallengeInput) (*domain.AuthAttempt, error) {
	attempt, err := s.attempts.GetByID(ctx, s.pool, input.ProjectID, input.AttemptID)
	if err != nil {
		return nil, err
	}

	challenger, err := s.buildChallenger(ctx, attempt, input.Challenge)
	if err != nil {
		return nil, err
	}

	if err := s.attempts.SetChallenge(ctx, s.pool, input.ProjectID, input.AttemptID, challenger); err != nil {
		return nil, err
	}

	return attempt, nil
}

// buildChallenger constructs the challenger for the given check type.
func (s *authAttemptService) buildChallenger(ctx context.Context, attempt *domain.AuthAttempt, challenge Challenge) (domain.AuthChallenge, error) {
	switch typ := challenge.(type) {
	case UserChallenge:
		if err := attempt.PrepareUserChallenge(); err != nil {
			return nil, err
		}
		userChallenge, err := domain.NewUserAuthCheck()
		if err != nil {
			return nil, err
		}
		attempt.SetCheck(userChallenge)
		return userChallenge, nil

	case PasswordChallenge:
		if err := attempt.PreparePasswordChallenge(); err != nil {
			return nil, err
		}
		passwordChallenge, err := domain.NewPasswordAuthCheck()
		if err != nil {
			return nil, err
		}
		attempt.SetCheck(passwordChallenge)
		return passwordChallenge, nil

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
		challenge, err := domain.CreatePasskeyChallenge(userID, passkeys, typ.UserVerification, typ.RPID, typ.RPOrigins)
		if err != nil {
			return nil, err
		}
		passkeyChallenge, err := domain.NewPasskeyAuthCheckChallenge(challenge)
		if err != nil {
			return nil, err
		}

		attempt.SetCheck(passkeyChallenge)
		return passkeyChallenge, nil

	default:
		return nil, domain.ErrAuthAttemptInvalidRequest()
	}
}

// VerifyProof verifies the submitted proof against the challenge identified by ChallengeID.
// On success, it persists the verification and marks the attempt complete if all
// required checks are now satisfied.
// On failure, it records the failed attempt for rate-limiting purposes.
func (s *authAttemptService) VerifyProof(ctx context.Context, input VerifyProofInput) (res *domain.AuthAttempt, err error) {
	attempt, err := s.attempts.GetByID(ctx, s.pool, input.ProjectID, input.AttemptID)
	if err != nil {
		return nil, err
	}

	// Validate the challenge ID is current — prevents stale proofs
	check, ok := attempt.ChallengeByID(input.ChallengeID)
	if !ok {
		return nil, domain.ErrAuthAttemptStaleChallenge()
	}

	// Proof type must match the challenge's check type
	if check.Type() != input.Proof.proofCheckType() {
		return nil, domain.ErrAuthAttemptInvalidRequest()
	}

	factor, err := s.verify(ctx, attempt, check, input.Proof)
	if err != nil {
		// Record the failure for rate-limiting — best effort, don't shadow the original error
		_ = s.attempts.ChallengeFailed(ctx, s.pool, input.ProjectID, input.AttemptID, check)
		return nil, err
	}

	if err = s.attempts.ChallengeSucceeded(ctx, s.pool, input.ProjectID, input.AttemptID, factor, check.GetID()); err != nil {
		return nil, err
	}
	attempt.SetCheck(factor) // Update the attempt with the successful factor for accurate state in the response

	return attempt, nil
}

// verify dispatches proof verification to the appropriate secondary port.
// Returns the checker to persist (always, even on failure) and any error.
func (s *authAttemptService) verify(ctx context.Context, attempt *domain.AuthAttempt, check domain.AuthChallenge, proof Proof) (domain.AuthFactor, error) {
	switch p := proof.(type) {
	case UserProof:
		if err := attempt.PrepareUserVerification(); err != nil {
			return nil, err
		}

		// TODO: get the schema to retrieve the identifying attribute
		// schema, err := s.schema.Get()
		// if err != nil {
		//
		// }
		var identifierAttributeKey string
		user, err := s.users.Get(
			ctx,
			s.pool,
			database.WithCondition(s.users.ProjectIDCondition(attempt.ProjectID)),
			database.WithCondition(s.users.AttributesCondition([]domain.Attribute{{
				Key:   identifierAttributeKey,
				Value: p.LoginName,
			}})),
		)
		if err != nil {
			return nil, domain.ErrAuthAttemptProofRejected().WithParent(err)
		}
		return &domain.AuthFactorUser{
			UserID: user.ID,
		}, nil

	case PasswordProof:
		userFactor, err := attempt.PreparePasswordVerification()
		if err != nil {
			return nil, err
		}
		password, err := s.userPasswords.Get(
			ctx,
			s.pool,
			database.WithCondition(s.userPasswords.ProjectIDCondition(attempt.ProjectID)),
			database.WithCondition(s.userPasswords.UserIDCondition(userFactor.UserID)),
		)
		if err != nil {
			return nil, domain.ErrAuthAttemptProofRejected().WithParent(err)
		}
		if err := password.Verify(p.Password, s.passwordVerifier); err != nil {
			return nil, domain.ErrAuthAttemptProofRejected().WithParent(err)
		}
		return &domain.AuthFactorPassword{}, nil

	case PasskeyProof:
		userID, err := attempt.PreparePasskeyVerification()
		if err != nil {
			return nil, err
		}
		passkeyCheck := check.(*domain.AuthChallengePasskey)
		var passkeys []*domain.UserPasskey
		if userID != "" {
			passkeys, err = s.listUserPasskeys(ctx, attempt.ProjectID, userID)
			if err != nil {
				return nil, err
			}
		}
		verification, err := domain.VerifyPasskeyChallenge(
			passkeyCheck.PasskeyChallenge,
			p.AssertionResponse,
			userID,
			passkeys,
			func(userID string) ([]*domain.UserPasskey, error) {
				return s.listUserPasskeys(ctx, attempt.ProjectID, userID)
			},
		)
		if err != nil {
			return nil, domain.ErrAuthAttemptProofRejected().WithParent(err)
		}
		return &domain.AuthFactorPasskey{UserVerified: verification.UserVerified, UserID: verification.UserID}, nil

	default:
		return nil, domain.ErrAuthAttemptInvalidRequest().WithDetails("unsupported proof type")
	}
}

// Handoff mints a single-use handoff token for a completed attempt.
// The token is exchanged by the client at POST /sessions/exchange.
func (s *authAttemptService) Handoff(ctx context.Context, input HandoffInput) (*domain.AuthAttempt, error) {
	attempt, err := s.attempts.GetByID(ctx, s.pool, input.ProjectID, input.AttemptID)
	if err != nil {
		return nil, err
	}

	if err := attempt.PrepareHandoff(); err != nil {
		return nil, err
	}

	if err := s.attempts.Handoff(ctx, s.pool, attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}

func (s *authAttemptService) listUserPasskeys(ctx context.Context, projectID, userID string) ([]*domain.UserPasskey, error) {
	return s.userPasskeys.List(
		ctx,
		s.pool,
		database.WithCondition(s.userPasskeys.ProjectIDCondition(projectID)),
		database.WithCondition(s.userPasskeys.UserIDCondition(userID)),
	)
}

var _ AuthAttemptService = (*authAttemptService)(nil)
