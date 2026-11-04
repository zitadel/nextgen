package service

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ErrConsentTokenSpent is returned when a code or refresh token's record is
// gone: it was used already, or revoked. A refresh token presented twice is
// the replay ADR 037 asks the server to detect, and the rotation revokes every
// token of the consent before answering it.
var ErrConsentTokenSpent = errors.New("consent token already used or revoked")

// ConsentLifetimes bound a consent the way ADR 072 bounds a session: it ends
// Lifetime after the user gave it, and sooner once it goes unused for
// IdleTimeout.
type ConsentLifetimes struct {
	Lifetime    time.Duration
	IdleTimeout time.Duration
}

// GiveConsentInput is a user's consent to a client for one API.
type GiveConsentInput struct {
	ProjectID  string
	UserID     string
	ClientID   string
	ClientName string
	Resource   string
	Scope      []string
}

type ListConsentsInput struct {
	ProjectID string
	UserID    string
	PageToken string
	Limit     int
}

// ConsentToken is the record of one authorization code or refresh token
// issued under a consent. The token itself is sealed and handed to the
// client; only this record, keyed by its id, is stored (ADR 037), as an
// oidc_access_token row whose oidc_session_id is the consent.
type ConsentToken struct {
	ProjectID string
	ConsentID string
	UserID    string
	Scope     []string
	ExpiresAt time.Time
}

// ConsentService keeps users' consents to OAuth clients (ADR 082 §8), and the
// single-use records of the codes and refresh tokens issued under them. A
// consent is transient, like a session: each use moves its idle deadline,
// never past its lifetime, and the user lists and revokes it. Giving and
// revoking one emits its event in the same transaction.
type ConsentService interface {
	// Give records that the user consented to the client for the resource: a
	// new consent, or a live one's scopes widened and its deadline moved. An
	// expired one gives way to a new one, and what was issued under it goes.
	Give(ctx context.Context, input GiveConsentInput) (*domain.Consent, error)
	// Find returns the user's live consent to the client for the resource;
	// domain.ErrConsentNotFound when there is none.
	Find(ctx context.Context, projectID, userID, clientID, resource string) (*domain.Consent, error)
	// List pages the user's live consents, newest first.
	List(ctx context.Context, input ListConsentsInput) (consents []*domain.Consent, nextPage string, err error)
	// Revoke deletes the user's consent and every token issued under it;
	// domain.ErrConsentNotFound when the user has no such consent.
	Revoke(ctx context.Context, projectID, userID, consentID string) error
	// IssueToken writes the record of a code or refresh token and returns its
	// id.
	IssueToken(ctx context.Context, token ConsentToken) (string, error)
	// RedeemCode uses a code's record up. ErrConsentTokenSpent means it was
	// redeemed or revoked already.
	RedeemCode(ctx context.Context, projectID, tokenID string) error
	// Rotate uses a refresh token's record up, moves the consent's deadline
	// and writes the next record, in one transaction. A record that is gone
	// was replayed: every token of the consent is revoked and
	// ErrConsentTokenSpent returned. A consent that ended is
	// domain.ErrConsentNotFound.
	Rotate(ctx context.Context, projectID, tokenID string, next ConsentToken) (string, error)
	// RevokeToken ends one refresh token, and with it the rotations that
	// would have followed it (RFC 7009). The consent and the client's other
	// tokens stay.
	RevokeToken(ctx context.Context, projectID, tokenID string) error
	// RevokeTokens ends every code and refresh token issued under a consent,
	// which stays.
	RevokeTokens(ctx context.Context, projectID, consentID string) error
	// The consents name the clients that registered themselves, so the
	// registration store keeps a client a live consent names and deletes the
	// consents of a client it deletes.
	ClientRegistrationConsents
}

type consentService struct {
	pool      StatementPool
	lifetimes ConsentLifetimes
	now       func() time.Time
}

func NewConsentService(pool StatementPool, lifetimes ConsentLifetimes) ConsentService {
	return &consentService{pool: pool, lifetimes: lifetimes, now: time.Now}
}

func (s *consentService) Give(ctx context.Context, input GiveConsentInput) (_ *domain.Consent, err error) {
	ctx, end := startSpan(ctx, "ConsentService.Give")
	defer end(&err)

	now := s.now()
	var given *domain.Consent
	give := func(ctx context.Context, tx Statementer[AllStatements]) error {
		given = nil
		stmts := tx.Statements()
		existing, err := stmts.GetConsent(ctx, consentKey(input.ProjectID, input.UserID, input.ClientID, input.Resource))
		if _, none := errors.AsType[*database.NoRowFoundError](err); none {
			existing, err = nil, nil
		}
		if err != nil {
			return err
		}
		if existing != nil && existing.Live(now) {
			scope := scopeUnion(existing.Scope, input.Scope)
			widened := len(scope) > len(existing.Scope)
			update := domain.ConsentUpdate{
				ClientName: &input.ClientName,
				Scope:      scope,
				ExpiresAt:  s.deadline(existing.CreatedAt, now),
			}
			if err := stmts.UpdateConsent(ctx, input.ProjectID, existing.ID, update); err != nil {
				return err
			}
			existing.ClientName, existing.Scope, existing.ExpiresAt = input.ClientName, scope, update.ExpiresAt
			given = existing
			if !widened {
				return nil
			}
			return emitConsentGiven(ctx, stmts, existing)
		}
		if existing != nil {
			if err := stmts.DeleteConsent(ctx, input.ProjectID, existing.ID); err != nil {
				return err
			}
		}
		consent := &domain.Consent{
			ProjectID:  input.ProjectID,
			UserID:     input.UserID,
			ClientID:   input.ClientID,
			ClientName: input.ClientName,
			Resource:   input.Resource,
			Scope:      scopeUnion(nil, input.Scope),
			ExpiresAt:  s.deadline(now, now),
		}
		if err := stmts.CreateConsent(ctx, consent); err != nil {
			return err
		}
		given = consent
		return emitConsentGiven(ctx, stmts, consent)
	}
	err = s.pool.Transaction(ctx, give)
	if _, raced := errors.AsType[*database.UniqueError](err); raced {
		// Another authorization of the same user and client created it first:
		// this one widens it instead.
		err = s.pool.Transaction(ctx, give)
	}
	if err != nil {
		return nil, consentStorageError(err, "failed to give consent")
	}
	return given, nil
}

func (s *consentService) Find(ctx context.Context, projectID, userID, clientID, resource string) (_ *domain.Consent, err error) {
	ctx, end := startSpan(ctx, "ConsentService.Find")
	defer end(&err)

	consent, err := s.pool.Statements().GetConsent(ctx, consentKey(projectID, userID, clientID, resource))
	if _, none := errors.AsType[*database.NoRowFoundError](err); none {
		return nil, domain.ErrConsentNotFound()
	}
	if err != nil {
		return nil, consentStorageError(err, "failed to find consent")
	}
	if !consent.Live(s.now()) {
		return nil, domain.ErrConsentNotFound()
	}
	return consent, nil
}

func (s *consentService) List(ctx context.Context, input ListConsentsInput) (_ []*domain.Consent, _ string, err error) {
	ctx, end := startSpan(ctx, "ConsentService.List")
	defer end(&err)

	result, err := s.pool.Statements().ListConsents(ctx, &database.ListOptions[domain.ConsentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.ConsentFieldProjectID), input.ProjectID),
			database.Equal(database.Col(domain.ConsentFieldUserID), input.UserID),
			database.GreaterThan(database.Col(domain.ConsentFieldExpiresAt), s.now()),
		),
		Pagination: database.Page[domain.ConsentField]{
			Limit:  uint32(normalizeLimit(input.Limit)),
			Cursor: []byte(input.PageToken),
			OrderBy: database.OrderBy[domain.ConsentField]{
				Columns: []database.Column[domain.ConsentField]{
					database.Col(domain.ConsentFieldCreatedAt),
					database.Col(domain.ConsentFieldID),
				},
				Direction: database.OrderDesc,
			},
		},
	})
	if err != nil {
		return nil, "", mapListError(err, "failed to list consents from database")
	}
	return result.Items, string(result.NextCursor), nil
}

func (s *consentService) Revoke(ctx context.Context, projectID, userID, consentID string) (err error) {
	ctx, end := startSpan(ctx, "ConsentService.Revoke")
	defer end(&err)

	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		consent, err := stmts.GetConsent(ctx, database.And(
			database.Equal(database.Col(domain.ConsentFieldProjectID), projectID),
			database.Equal(database.Col(domain.ConsentFieldID), consentID),
			database.Equal(database.Col(domain.ConsentFieldUserID), userID),
		))
		if err != nil {
			return err
		}
		if err := stmts.DeleteConsent(ctx, projectID, consent.ID); err != nil {
			return err
		}
		return audit.Emit(ctx, stmts, consentEvent(consent, domain.EventTypeConsentRevoked, domain.ConsentRevokedPayload{
			ClientID: consent.ClientID,
			Resource: consent.Resource,
		}))
	})
	if _, none := errors.AsType[*database.NoRowFoundError](err); none {
		return domain.ErrConsentNotFound()
	}
	if err != nil {
		return consentStorageError(err, "failed to revoke consent")
	}
	return nil
}

func (s *consentService) IssueToken(ctx context.Context, token ConsentToken) (_ string, err error) {
	ctx, end := startSpan(ctx, "ConsentService.IssueToken")
	defer end(&err)

	var id string
	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		var err error
		id, err = issueConsentToken(ctx, tx.Statements(), token)
		return err
	})
	if err != nil {
		return "", consentStorageError(err, "failed to issue oauth token")
	}
	return id, nil
}

func (s *consentService) RedeemCode(ctx context.Context, projectID, tokenID string) (err error) {
	ctx, end := startSpan(ctx, "ConsentService.RedeemCode")
	defer end(&err)

	found, err := s.pool.Statements().ConsumeTokenByID(ctx, projectID, tokenID)
	if err != nil {
		return consentStorageError(err, "failed to redeem oauth code")
	}
	if !found {
		return ErrConsentTokenSpent
	}
	return nil
}

// rotation is how a refresh went: rotated, replayed, or under a consent that
// ended.
type rotation uint8

const (
	rotated rotation = iota
	replayed
	consentEnded
)

func (s *consentService) Rotate(ctx context.Context, projectID, tokenID string, next ConsentToken) (_ string, err error) {
	ctx, end := startSpan(ctx, "ConsentService.Rotate")
	defer end(&err)

	now := s.now()
	var (
		id      string
		outcome rotation
	)
	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		// A retry re-runs the closure, so it starts from nothing each time.
		id, outcome = "", rotated
		stmts := tx.Statements()
		found, err := stmts.ConsumeTokenByID(ctx, projectID, tokenID)
		if err != nil {
			return err
		}
		if !found {
			outcome = replayed
			return revokeConsentTokens(ctx, stmts, projectID, next.ConsentID)
		}
		consent, err := stmts.GetConsent(ctx, database.And(
			database.Equal(database.Col(domain.ConsentFieldProjectID), projectID),
			database.Equal(database.Col(domain.ConsentFieldID), next.ConsentID),
		))
		if _, none := errors.AsType[*database.NoRowFoundError](err); none {
			outcome = consentEnded
			return nil
		}
		if err != nil {
			return err
		}
		if !consent.Live(now) {
			outcome = consentEnded
			return nil
		}
		if err := stmts.UpdateConsent(ctx, projectID, consent.ID, domain.ConsentUpdate{ExpiresAt: s.deadline(consent.CreatedAt, now)}); err != nil {
			return err
		}
		// A refresh token never outlives the consent it was issued under.
		token := next
		if lifetimeEnd := consent.CreatedAt.Add(s.lifetimes.Lifetime); token.ExpiresAt.After(lifetimeEnd) {
			token.ExpiresAt = lifetimeEnd
		}
		id, err = issueConsentToken(ctx, stmts, token)
		return err
	})
	if err != nil {
		return "", consentStorageError(err, "failed to rotate oauth refresh token")
	}
	switch outcome {
	case replayed:
		return "", ErrConsentTokenSpent
	case consentEnded:
		return "", domain.ErrConsentNotFound()
	}
	return id, nil
}

func (s *consentService) RevokeToken(ctx context.Context, projectID, tokenID string) (err error) {
	ctx, end := startSpan(ctx, "ConsentService.RevokeToken")
	defer end(&err)

	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		found, err := stmts.ConsumeTokenByID(ctx, projectID, tokenID)
		if err != nil || !found {
			return err
		}
		return audit.Emit(ctx, stmts, audit.EmitSpec{
			Type:       domain.EventTypeAuthTokenRevoked,
			Category:   domain.EventCategoryAuth,
			ProjectID:  projectID,
			EntityType: "token",
			EntityID:   tokenID,
			TokenID:    tokenID,
			Payload:    domain.AuthTokenRevokedPayload{},
		})
	})
	if err != nil {
		return consentStorageError(err, "failed to revoke oauth refresh token")
	}
	return nil
}

func (s *consentService) RevokeTokens(ctx context.Context, projectID, consentID string) (err error) {
	ctx, end := startSpan(ctx, "ConsentService.RevokeTokens")
	defer end(&err)

	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return revokeConsentTokens(ctx, tx.Statements(), projectID, consentID)
	})
	if err != nil {
		return consentStorageError(err, "failed to revoke a consent's tokens")
	}
	return nil
}

// Named returns the ids among clientIDs that a live consent names. A client
// has a consent per user, so each id is one read of its first live one.
func (s *consentService) Named(ctx context.Context, stmts AllStatements, projectID string, clientIDs []string) (_ []string, err error) {
	ctx, end := startSpan(ctx, "ConsentService.Named")
	defer end(&err)

	var named []string
	for _, clientID := range clientIDs {
		result, err := stmts.ListConsents(ctx, &database.ListOptions[domain.ConsentField]{
			Filter: database.And(
				database.Equal(database.Col(domain.ConsentFieldProjectID), projectID),
				database.Equal(database.Col(domain.ConsentFieldClientID), clientID),
				database.GreaterThan(database.Col(domain.ConsentFieldExpiresAt), s.now()),
			),
			Pagination: database.Page[domain.ConsentField]{Limit: 1},
		})
		if err != nil {
			return nil, consentStorageError(err, "failed to find a client's consents")
		}
		if len(result.Items) > 0 {
			named = append(named, clientID)
		}
	}
	return named, nil
}

// Delete deletes the consents that name clientID and the tokens issued under
// them, in the caller's transaction.
func (s *consentService) Delete(ctx context.Context, stmts AllStatements, projectID, clientID string) (err error) {
	ctx, end := startSpan(ctx, "ConsentService.Delete")
	defer end(&err)

	if err := stmts.DeleteConsentsByClient(ctx, projectID, clientID); err != nil {
		return consentStorageError(err, "failed to delete a client's consents")
	}
	return nil
}

// deadline is the idle deadline of a consent given at createdAt and used at
// now: the idle timeout from now, never past the end of its lifetime.
func (s *consentService) deadline(createdAt, now time.Time) time.Time {
	idle := now.Add(s.lifetimes.IdleTimeout)
	if lifetimeEnd := createdAt.Add(s.lifetimes.Lifetime); idle.After(lifetimeEnd) {
		return lifetimeEnd
	}
	return idle
}

func consentKey(projectID, userID, clientID, resource string) database.Filter[domain.ConsentField] {
	return database.And(
		database.Equal(database.Col(domain.ConsentFieldProjectID), projectID),
		database.Equal(database.Col(domain.ConsentFieldUserID), userID),
		database.Equal(database.Col(domain.ConsentFieldClientID), clientID),
		database.Equal(database.Col(domain.ConsentFieldResource), resource),
	)
}

// scopeUnion is consented followed by what requested adds, each scope once.
func scopeUnion(consented, requested []string) []string {
	scope := make([]string, 0, len(consented)+len(requested))
	for _, s := range slices.Concat(consented, requested) {
		if !slices.Contains(scope, s) {
			scope = append(scope, s)
		}
	}
	return scope
}

func issueConsentToken(ctx context.Context, stmts AllStatements, token ConsentToken) (string, error) {
	consentID := token.ConsentID
	expiresAt := token.ExpiresAt
	record := &domain.Token{
		ProjectID:     token.ProjectID,
		UserID:        token.UserID,
		Type:          domain.TokenTypeOIDCAccessToken,
		OIDCSessionID: &consentID,
		Scope:         token.Scope,
		ExpiresAt:     &expiresAt,
	}
	if err := stmts.CreateToken(ctx, record); err != nil {
		return "", err
	}
	if err := emitAuthTokenIssued(ctx, stmts, record.ProjectID, record.TokenID, nil, tokenUserID(record), record.Scope); err != nil {
		return "", err
	}
	return record.TokenID, nil
}

func revokeConsentTokens(ctx context.Context, stmts AllStatements, projectID, consentID string) error {
	if err := stmts.DeleteTokensByOIDCSessionID(ctx, projectID, consentID); err != nil {
		return err
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeAuthTokenRevoked,
		Category:   domain.EventCategoryAuth,
		ProjectID:  projectID,
		EntityType: "consent",
		EntityID:   consentID,
		Payload:    domain.AuthTokenRevokedPayload{},
	})
}

func emitConsentGiven(ctx context.Context, stmts AllStatements, consent *domain.Consent) error {
	return audit.Emit(ctx, stmts, consentEvent(consent, domain.EventTypeConsentGiven, domain.ConsentGivenPayload{
		ClientID: consent.ClientID,
		Resource: consent.Resource,
		Scopes:   consent.Scope,
	}))
}

// consentEvent is a consent's event, acted by the user it belongs to: the
// consent step and the me endpoints act for the signed-in user.
func consentEvent(consent *domain.Consent, eventType domain.EventType, payload any) audit.EmitSpec {
	actor := consent.UserID
	actorType := domain.EventActorTypeHuman
	return audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAuth,
		ProjectID:  consent.ProjectID,
		EntityType: "consent",
		EntityID:   consent.ID,
		Payload:    payload,
		ActorID:    &actor,
		ActorType:  &actorType,
	}
}

// consentStorageError keeps a classified failure's code, so an unavailable
// store answers 503 and clients retry, and wraps anything else.
func consentStorageError(err error, message string) error {
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	if mapped := mapStorageError(err); mapped != err {
		return mapped
	}
	return domain.ErrInternal(err).WithMessage(message)
}
