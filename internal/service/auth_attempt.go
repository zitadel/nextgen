package service

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/url"
	"slices"
	"strings"
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

	// BeginPasskeyEnrollment starts a management-plane enrollment ceremony on
	// an internal attempt: the target user is pinned as a verified user
	// factor and a registration challenge is issued. RegistrationID is the
	// internal attempt's id, but the attempt is invisible on the attempt
	// surface — internal attempts cannot be read, handed off, or exchanged.
	//
	// errors: domain.ErrAuthAttemptInvalidRequest, domain.ErrInternal
	BeginPasskeyEnrollment(ctx context.Context, input BeginPasskeyEnrollmentInput) (*BeginPasskeyEnrollmentOutput, error)

	// FinishPasskeyEnrollment verifies the attestation against the ceremony
	// and persists the credential; the internal attempt is consumed in the
	// same transaction, so a completed ceremony cannot be replayed and no
	// best-effort cleanup is needed.
	//
	// errors: domain.ErrAuthAttemptNotFound, domain.ErrAuthAttemptStaleChallenge, domain.ErrAuthAttemptInvalidRequest, domain.ErrAuthAttemptProofRejected, domain.ErrInternal
	FinishPasskeyEnrollment(ctx context.Context, input FinishPasskeyEnrollmentInput) (*FinishPasskeyEnrollmentOutput, error)
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
	// Internal marks a server-orchestrated ceremony (see
	// [domain.AuthAttempt.Internal]). Never settable through the REST surface.
	Internal bool
}

// BeginPasskeyEnrollmentInput starts a management-plane enrollment ceremony
// for an existing user.
type BeginPasskeyEnrollmentInput struct {
	ProjectID   string
	UserID      string
	Username    string
	DisplayName string
	RPID        string
	RPOrigins   []url.URL
}

type BeginPasskeyEnrollmentOutput struct {
	// RegistrationID identifies the ceremony on finish.
	RegistrationID string
	// Options is the PublicKeyCredentialCreationOptions JSON.
	Options []byte
}

type FinishPasskeyEnrollmentInput struct {
	ProjectID      string
	RegistrationID string
	// UserID must match the user the ceremony was begun for.
	UserID      string
	Attestation []byte
	// Name optionally labels the credential; empty derives a name.
	Name string
}

type FinishPasskeyEnrollmentOutput struct {
	PasskeyID string
	Name      string
	CreatedAt time.Time
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

// PasskeyRegistrationChallenge starts a WebAuthn credential-enrollment ceremony.
// UserID targets an existing user (must match a pinned user factor when one
// exists); empty UserID on an attempt without a user factor makes the ceremony
// provisional: a user handle is minted and the user row is created when the
// attestation is verified.
type PasskeyRegistrationChallenge struct {
	UserID      string
	Username    string
	DisplayName string
	RPID        string
	RPOrigins   []url.URL
}

func (PasskeyRegistrationChallenge) ChallengeCheckType() domain.AuthCheckType {
	return domain.AuthCheckTypePasskeyRegistration
}

// ---- Proof types (discriminated union) --------------------------------------

// Proof is implemented by each check-type-specific proof value.
type Proof interface {
	proofCheckType() domain.AuthCheckType
}

// UserProof identifies the user by login name (email, username, phone).
// The flow path sets AttributeName — its step is bound to a schema whose
// designated identifier the field resolver already derived. The direct API
// leaves AttributeName empty and the bare LoginName resolves against the
// designated identifier of every user schema in the project (ADR 058 §5).
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

// PasskeyRegistrationProof carries the raw WebAuthn attestation response bytes.
type PasskeyRegistrationProof struct {
	AttestationResponse []byte
	// Name labels the credential in passkey management surfaces. Optional:
	// when empty, a name is derived from the credential itself
	// ([domain.GeneratePasskeyCredentialName]).
	Name string
	// CreateUser, when set, builds the actions that create the ceremony's
	// user inside the success transaction, so user creation, credential
	// persistence, and check success land atomically. The service invokes it
	// with the stored challenge's authoritative user handle — a caller cannot
	// create a row under a different id than the credential binds to. Only
	// consulted for provisional ceremonies.
	CreateUser func(userID string) []UserAction
}

func (PasskeyRegistrationProof) proofCheckType() domain.AuthCheckType {
	return domain.AuthCheckTypePasskeyRegistration
}

// ---- Secondary ports -------------------------------------------------------------

type SessionResolver interface {
	Get(ctx context.Context, projectID, sessionID string) (*domain.Session, error)
}

type UserLookup interface {
	GetByAttributes(ctx context.Context, projectID string, attrs []domain.Attribute) (*domain.User, error)
	// GetByIdentifier is the scoped identifier lookup of ADR 058 §5: it
	// matches attr only on users of the given schema URLs and only against
	// uniquely registered values.
	GetByIdentifier(ctx context.Context, projectID string, schemaURLs []string, attr domain.Attribute) (*domain.User, error)
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
	attempt.Internal = input.Internal

	if err = s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateAuthAttempt(ctx, attempt); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeAuthAttemptCreated,
			Category:   domain.EventCategoryAuth,
			ProjectID:  attempt.ProjectID,
			EntityType: "auth_attempt",
			EntityID:   attempt.ID,
			SessionID:  attempt.SessionID,
			Payload:    domain.AuthAttemptCreatedPayload{},
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

	challenge, factor, txExtra, err := s.verify(ctx, attempt, input.Proof, input.ChallengeID)
	if err != nil {
		s.recordProofFailure(ctx, attempt, challenge)
		return nil, err
	}

	err = s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		// txExtra carries proof-type-specific writes that must commit atomically
		// with the check success (e.g. registration persists the user row and
		// credential). It runs first so FK ordering holds.
		if txExtra != nil {
			if err := txExtra(ctx, tx.Statements()); err != nil {
				return err
			}
		}
		if err := tx.Statements().AuthAttemptChallengeSucceeded(ctx, input.ProjectID, input.AttemptID, factor, challenge.GetID()); err != nil {
			return err
		}
		return emitAuthCheck(ctx, tx.Statements(), attempt, challenge, true)
	})
	if err != nil {
		// A provisional registration's create-user action can lose the
		// uniqueness race inside the transaction. Surfacing the stable code
		// explicitly also puts user.already_exists into the generated error
		// unions: erroranalysis cannot look into the txExtra closure.
		if errors.Is(err, domain.ErrUserAlreadyExists()) {
			return nil, domain.ErrUserAlreadyExists().WithParent(err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
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
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeAuthAttemptHandedOff,
			Category:   domain.EventCategoryAuth,
			ProjectID:  attempt.ProjectID,
			EntityType: "auth_attempt",
			EntityID:   attempt.ID,
			SessionID:  attempt.SessionID,
			Payload:    domain.AuthAttemptHandedOffPayload{},
		})
	})
	if err != nil {
		return nil, err
	}
	return attempt, nil
}

// recordDirectAuthFactor upserts a proof-equivalent factor on the attempt and
// emits its auth.check.succeeded event, inside the caller's transaction. A
// direct write is legitimate only when the fact was just established by other
// verified means in the same transaction: a created user during sign-up, or a
// user resolved cryptographically from a discoverable assertion.
func recordDirectAuthFactor(ctx context.Context, stmts AllStatements, attempt *domain.AuthAttempt, factor domain.AuthFactor) (string, error) {
	checkID, err := stmts.SetAuthAttemptFactor(ctx, attempt.ProjectID, attempt.ID, factor)
	if err != nil {
		return "", err
	}
	return checkID, audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeAuthCheckSucceeded,
		Category:   domain.EventCategoryAuth,
		ProjectID:  attempt.ProjectID,
		EntityType: "check",
		EntityID:   checkID,
		SessionID:  attempt.SessionID,
		Payload: domain.AuthCheckPayload{
			CheckID:       checkID,
			CheckType:     factor.Type().String(),
			AuthAttemptID: attempt.ID,
		},
	})
}

func emitAuthCheck(ctx context.Context, stmts EventStatements, attempt *domain.AuthAttempt, challenge domain.AuthChallenge, succeeded bool) error {
	eventType := domain.EventTypeAuthCheckFailed
	if succeeded {
		eventType = domain.EventTypeAuthCheckSucceeded
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAuth,
		ProjectID:  attempt.ProjectID,
		EntityType: "check",
		EntityID:   challenge.GetID(),
		SessionID:  attempt.SessionID,
		Payload: domain.AuthCheckPayload{
			CheckID:       challenge.GetID(),
			CheckType:     challenge.Type().String(),
			AuthAttemptID: attempt.ID,
		},
	})
}

const passkeyRegistrationDefaultUsername = "Passkey account"

// passkeyRegistrationLabels normalizes the browser-visible labels for a
// registration ceremony: a neutral default when no identifier was collected,
// and the username doubling as display name when only it is known.
func passkeyRegistrationLabels(username, displayName string) (string, string) {
	username = strings.TrimSpace(username)
	displayName = strings.TrimSpace(displayName)
	if username == "" {
		return passkeyRegistrationDefaultUsername, ""
	}
	if displayName == "" {
		displayName = username
	}
	return username, displayName
}

func parseOrigins(raw []string) ([]url.URL, error) {
	origins := make([]url.URL, 0, len(raw))
	for _, o := range raw {
		u, err := url.Parse(o)
		if err != nil {
			return nil, fmt.Errorf("parse origin %q: %w", o, err)
		}
		origins = append(origins, *u)
	}
	return origins, nil
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

	case PasskeyRegistrationChallenge:
		userID, provisional, err := attempt.PreparePasskeyRegistrationChallenge(typ.UserID)
		if err != nil {
			return nil, err
		}
		// A provisional handle becomes a user id at verification, so it must
		// be server-minted: a caller-supplied handle is kept only when it
		// matches the attempt's own in-flight provisional ceremony (a
		// re-issued challenge); any other handle is replaced by a fresh mint.
		// Enrollment for an existing user always rides a verified user factor
		// on the attempt — every authenticated path persists one, including
		// discoverable passkey login — so store-existence is never consulted.
		if provisional && userID != "" && !attempt.HasProvisionalRegistrationHandle(userID) {
			userID = ""
		}
		if userID == "" {
			userID, err = s.stmts.Statements().NewManagedID(string(domain.PrefixUser))
			if err != nil {
				return nil, domain.ErrInternal(err).WithMessage("failed to mint user id")
			}
		}
		var passkeys []*domain.UserPasskey
		if !provisional {
			passkeys, err = s.listUserPasskeys(ctx, attempt.ProjectID, userID)
			if err != nil {
				return nil, domain.ErrInternal(err).WithMessage("failed to load user passkeys")
			}
		}
		username, displayName := passkeyRegistrationLabels(typ.Username, typ.DisplayName)
		registrationChallenge, err := domain.CreatePasskeyRegistrationChallenge(userID, username, displayName, passkeys, typ.RPID, typ.RPOrigins)
		if err != nil {
			// The WebAuthn library rejects malformed relying-party
			// configuration (empty rp id, bad origins) — caller input, not a
			// server fault.
			return nil, domain.ErrAuthAttemptInvalidRequest().WithParent(err).WithMessage("invalid relying-party configuration")
		}
		return attempt.SetPasskeyRegistrationChallenge(registrationChallenge, provisional), nil

	default:
		return nil, domain.ErrAuthAttemptInvalidRequest()
	}
}

// verify dispatches proof verification to the appropriate secondary port.
// Returns the checker to persist (always, even on failure), an optional
// closure with extra writes that must commit atomically with the check
// success, and any error.
func (s *authAttemptService) verify(ctx context.Context, attempt *domain.AuthAttempt, proof Proof, challengeID string) (domain.AuthChallenge, domain.AuthFactor, func(context.Context, AllStatements) error, error) {
	switch p := proof.(type) {
	case UserProof:
		userChallenge, err := attempt.PrepareUserVerification(challengeID)
		if err != nil {
			return nil, nil, nil, err
		}
		user, err := s.resolveUserProof(ctx, attempt.ProjectID, p)
		if err != nil {
			return userChallenge, nil, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		return userChallenge, attempt.SetUserFactor(user), nil, nil

	case PasswordProof:
		passwordChallenge, userFactor, err := attempt.PreparePasswordVerification(challengeID)
		if err != nil {
			return nil, nil, nil, err
		}
		password, err := s.stmts.Statements().GetUserPassword(ctx, database.And(
			database.Equal(database.Col(domain.UserPasswordFieldProjectID), attempt.ProjectID),
			database.Equal(database.Col(domain.UserPasswordFieldUserID), userFactor.UserID),
		))
		if err != nil {
			return passwordChallenge, nil, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		if err := password.Verify(p.Password, s.passwordVerifier); err != nil {
			return passwordChallenge, nil, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		return passwordChallenge, attempt.SetPasswordFactor(), nil, nil

	case PasskeyProof:
		challenge, userFactor, err := attempt.PreparePasskeyVerification(challengeID)
		if err != nil {
			return nil, nil, nil, err
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
				return nil, nil, nil, err
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
			return passkeyChallenge, nil, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		// Discoverable login resolves the user cryptographically from the assertion; bind it onto
		// the attempt — including the persisted user check row, which downstream consumers
		// (exchange user binding, password step-up, enrollment targeting) key on — so the
		// subject is pinned and the session/handoff carries the user id. For an identified
		// login the user factor is already present and unchanged.
		var txExtra func(context.Context, AllStatements) error
		if userFactor == nil && verification.UserID != "" {
			resolvedUser := attempt.SetUserFactor(&domain.User{ID: verification.UserID})
			txExtra = func(ctx context.Context, stmts AllStatements) error {
				_, err := recordDirectAuthFactor(ctx, stmts, attempt, resolvedUser)
				return err
			}
		}
		// Use the verified user as the source of truth: it is set for both identified and
		// discoverable logins, whereas userFactor is nil in the discoverable case.
		s.recordPasskeyUsage(ctx, attempt.ProjectID, verification)
		return passkeyChallenge, attempt.SetPasskeyFactor(verification), txExtra, nil

	case PasskeyRegistrationProof:
		registrationChallenge, err := attempt.PreparePasskeyRegistrationVerification(challengeID)
		if err != nil {
			return nil, nil, nil, err
		}
		newPasskey, err := domain.VerifyPasskeyRegistration(registrationChallenge.PasskeyRegistrationChallenge, p.AttestationResponse, p.Name)
		if err != nil {
			return registrationChallenge, nil, nil, domain.ErrAuthAttemptProofRejected(err)
		}
		// The stored challenge is authoritative for the credential's owner.
		newPasskey.ProjectID = attempt.ProjectID
		newPasskey.UserID = registrationChallenge.UserID
		var createActions []UserAction
		if registrationChallenge.Provisional && p.CreateUser != nil {
			// The factory receives the challenge's handle, so the created row
			// cannot diverge from the user the credential binds to.
			createActions = p.CreateUser(registrationChallenge.UserID)
			for _, action := range createActions {
				if err := action.Prepare(ctx); err != nil {
					return nil, nil, nil, err
				}
			}
		}
		// Captured before the in-memory pin below: writing the user check
		// without a proof is only legitimate when no user factor exists yet
		// (provisional sign-up, or enrollment for a user pinned in flow state
		// only). Re-enrolling on an authenticated attempt must not rewrite
		// the proof-backed user check or emit a synthetic check event.
		_, hadUserFactor := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
		factor := attempt.SetPasskeyRegistrationFactor(newPasskey)
		userFactor := attempt.SetUserFactor(&domain.User{ID: registrationChallenge.UserID})
		txExtra := func(ctx context.Context, stmts AllStatements) error {
			for _, action := range createActions {
				if err := action.Apply(ctx, stmts); err != nil {
					return err
				}
			}
			if err := stmts.CreateUserPasskey(ctx, newPasskey); err != nil {
				return fmt.Errorf("passkey registration: store credential: %w", err)
			}
			// The credential row's identity rides on the factor so the caller
			// can answer from the verify result without a read-back.
			factor.PasskeyID = newPasskey.ID
			factor.Name = newPasskey.Name
			if !hadUserFactor {
				if _, err := recordDirectAuthFactor(ctx, stmts, attempt, userFactor); err != nil {
					return err
				}
			}
			return audit.Emit(ctx, stmts, audit.EmitSpec{
				Type:       domain.EventTypeAuthFactorPasskeyEnrolled,
				Category:   domain.EventCategoryAuth,
				ProjectID:  attempt.ProjectID,
				EntityType: "user_passkey",
				EntityID:   newPasskey.ID,
				SessionID:  attempt.SessionID,
				Payload: domain.AuthFactorPayload{
					UserID:   registrationChallenge.UserID,
					FactorID: newPasskey.ID,
				},
			})
		}
		return registrationChallenge, factor, txExtra, nil

	default:
		return nil, nil, nil, domain.ErrAuthAttemptInvalidRequest().WithMessage("unsupported proof type")
	}
}

// resolveUserProof resolves the submitted identifier to a user. The flow
// path names the attribute to match; the direct API submits a bare login
// name that resolves cross-schema.
func (s *authAttemptService) resolveUserProof(ctx context.Context, projectID string, p UserProof) (*domain.User, error) {
	if p.AttributeName != "" {
		return s.users.GetByAttributes(ctx, projectID, []domain.Attribute{{
			Key:   domain.AttributeKey(p.AttributeName),
			Value: p.LoginName,
		}})
	}
	return s.resolveIdentifierCrossSchema(ctx, projectID, p.LoginName)
}

// resolveIdentifierCrossSchema resolves a bare login name against the
// designated identifier of every user schema in the project (ADR 058 §5).
// Each lookup is scoped to the designating schemas' users, the value must
// match exactly one user across the derived set, and zero or several matches
// reject the proof — never property or schema precedence, which is how
// classic Zitadel let one user's username shadow another user's email
// (zitadel/zitadel#10782). With a single designating schema this degenerates
// to the same single-attribute lookup as the flow path.
func (s *authAttemptService) resolveIdentifierCrossSchema(ctx context.Context, projectID, loginName string) (*domain.User, error) {
	byProperty, err := s.designatedIdentifiers(ctx, projectID)
	if err != nil {
		return nil, err
	}
	var matches []*domain.User
	for _, property := range slices.Sorted(maps.Keys(byProperty)) {
		user, err := s.users.GetByIdentifier(ctx, projectID, byProperty[property], domain.Attribute{
			Key:   domain.AttributeKey(property),
			Value: loginName,
		})
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				continue
			}
			if _, ok := errors.AsType[*database.MultipleRowsFoundError](err); ok {
				// The unique registry allows one row per project and key, so
				// several users here mean a corrupted registry: surface it as
				// ambiguity, never pick one.
				return nil, fmt.Errorf("identifier resolution: property %q matches multiple users", property)
			}
			return nil, err
		}
		// A schema URL designates exactly one property and a user carries
		// exactly one schema URL, so matches from different property groups
		// are distinct users.
		matches = append(matches, user)
	}
	switch len(matches) {
	case 0:
		return nil, errors.New("identifier resolution: no user matches the submitted identifier")
	case 1:
		return matches[0], nil
	default:
		return nil, fmt.Errorf("identifier resolution: value matches %d designated identifier properties", len(matches))
	}
}

// identifierSchemaPageSize pages the user-schema listing during identifier
// resolution. Projects hold few schemas; paging is correctness, not tuning.
const identifierSchemaPageSize = 100

// designatedIdentifiers groups the project's user-schema URLs by their
// designated identifier property. Every stored revision contributes its own
// designation: users pin the schema URL they were created under, so an older
// revision's users stay resolvable under that revision's designation even
// after a newer revision designates differently. Schemas that designate
// nothing (passkey-only, API-managed) drop out of resolution entirely.
func (s *authAttemptService) designatedIdentifiers(ctx context.Context, projectID string) (map[string][]string, error) {
	stmts := s.stmts.Statements()
	list := func(cursor []byte) (*database.ListResult[*domain.JSONSchema], error) {
		return stmts.ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{
			Filter: database.And(
				database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
				database.Equal(database.Col(domain.JSONSchemaFieldKind), domain.JSONSchemaKindUserSchema.String()),
			),
			Pagination: database.Page[domain.JSONSchemaField]{
				Limit:  identifierSchemaPageSize,
				Cursor: cursor,
				OrderBy: database.OrderBy[domain.JSONSchemaField]{
					// url is the resource id and, with project_id fixed by
					// the filter, makes the order total so page boundaries
					// cannot skip or repeat rows.
					Columns: []database.Column[domain.JSONSchemaField]{
						database.Col(domain.JSONSchemaFieldURL),
					},
					Direction: database.OrderAsc,
				},
			},
		}, JSONSchemaQueryOptions{})
	}
	first, err := list(nil)
	if err != nil {
		return nil, err
	}
	byProperty := make(map[string][]string)
	for schema, err := range first.Iterate(list) {
		if err != nil {
			return nil, err
		}
		if property := domain.DesignatedIdentifier(schema.Schema); property != "" {
			byProperty[property] = append(byProperty[property], schema.URL)
		}
	}
	return byProperty, nil
}

// recordProofFailure records a failed proof for rate limiting — best effort,
// never shadowing the original error. Skipped when verify could not identify
// a challenge row.
func (s *authAttemptService) recordProofFailure(ctx context.Context, attempt *domain.AuthAttempt, challenge domain.AuthChallenge) {
	if challenge == nil {
		return
	}
	_ = s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().AuthAttemptChallengeFailed(ctx, attempt.ProjectID, attempt.ID, challenge); err != nil {
			return err
		}
		return emitAuthCheck(ctx, tx.Statements(), attempt, challenge, false)
	})
}

// BeginPasskeyEnrollment starts a management-plane enrollment ceremony on an
// internal attempt (see the interface doc).
func (s *authAttemptService) BeginPasskeyEnrollment(ctx context.Context, input BeginPasskeyEnrollmentInput) (*BeginPasskeyEnrollmentOutput, error) {
	attempt, err := s.Create(ctx, CreateAuthAttemptInput{ProjectID: input.ProjectID, Internal: true})
	if err != nil {
		return nil, err
	}
	// Pin the target user before issuing: the management caller (user.write)
	// vouches for the enrollment target, and the pinned factor is what makes
	// the ceremony non-provisional.
	userFactor := attempt.SetUserFactor(&domain.User{ID: input.UserID})
	if err := s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		_, err := recordDirectAuthFactor(ctx, tx.Statements(), attempt, userFactor)
		return err
	}); err != nil {
		return nil, err
	}

	issued, err := s.IssueChallenge(ctx, IssueChallengeInput{
		ProjectID: input.ProjectID,
		AttemptID: attempt.ID,
		Challenge: PasskeyRegistrationChallenge{
			UserID:      input.UserID,
			Username:    input.Username,
			DisplayName: input.DisplayName,
			RPID:        input.RPID,
			RPOrigins:   input.RPOrigins,
		},
	})
	if err != nil {
		return nil, err
	}
	check, ok := issued.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage("registration challenge missing after issue")
	}
	registrationCh, ok := check.(*domain.AuthChallengePasskeyRegistration)
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage("unexpected registration challenge type")
	}
	options, err := domain.BuildPasskeyCreationOptions(registrationCh)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to build creation options")
	}
	return &BeginPasskeyEnrollmentOutput{RegistrationID: attempt.ID, Options: options}, nil
}

// FinishPasskeyEnrollment verifies the attestation and consumes the internal
// attempt atomically (see the interface doc).
func (s *authAttemptService) FinishPasskeyEnrollment(ctx context.Context, input FinishPasskeyEnrollmentInput) (*FinishPasskeyEnrollmentOutput, error) {
	attempt, err := s.stmts.Statements().GetAuthAttemptByID(ctx, input.ProjectID, input.RegistrationID)
	if err != nil {
		return nil, err
	}
	if !attempt.Internal {
		// An ordinary attempt id must not be consumable as an enrollment
		// ceremony; report it like a consumed one.
		return nil, domain.ErrAuthAttemptNotFound()
	}
	check, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
	if !ok {
		return nil, domain.ErrAuthAttemptStaleChallenge()
	}
	registrationCh, ok := check.(*domain.AuthChallengePasskeyRegistration)
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage("unexpected registration challenge type")
	}
	if registrationCh.UserID != input.UserID {
		return nil, domain.ErrAuthAttemptInvalidRequest().WithMessage("The registration does not belong to this user.")
	}

	proof := PasskeyRegistrationProof{AttestationResponse: input.Attestation, Name: input.Name}
	challenge, factor, txExtra, err := s.verify(ctx, attempt, proof, check.GetID())
	if err != nil {
		s.recordProofFailure(ctx, attempt, challenge)
		return nil, err
	}
	err = s.stmts.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if txExtra != nil {
			if err := txExtra(ctx, tx.Statements()); err != nil {
				return err
			}
		}
		if err := tx.Statements().AuthAttemptChallengeSucceeded(ctx, attempt.ProjectID, attempt.ID, factor, challenge.GetID()); err != nil {
			return err
		}
		if err := emitAuthCheck(ctx, tx.Statements(), attempt, challenge, true); err != nil {
			return err
		}
		// Consume the internal attempt in the same transaction: the ceremony
		// outcome is fully audited by the check and enrollment events, and
		// the row must never be read, replayed, or handed off (same
		// no-attempt-event precedent as the exchange's delete).
		return tx.Statements().DeleteAuthAttemptByID(ctx, attempt.ProjectID, attempt.ID)
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, err
	}
	registrationFactor, ok := factor.(*domain.AuthFactorPasskeyRegistration)
	if !ok || registrationFactor.PasskeyID == "" {
		return nil, domain.ErrInternal(nil).WithMessage("registration factor missing after verify")
	}
	return &FinishPasskeyEnrollmentOutput{
		PasskeyID: registrationFactor.PasskeyID,
		Name:      registrationFactor.Name,
		CreatedAt: registrationFactor.GetLastVerifiedAt(),
	}, nil
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
