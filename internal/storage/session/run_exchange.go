package session

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// ExchangeStore is the dialect IO surface used by [RunExchange].
type ExchangeStore interface {
	GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffTokenHash []byte) (*domain.AuthAttempt, error)
	GetSessionByID(ctx context.Context, projectID, sessionID string) (*domain.Session, error)
	InsertSession(ctx context.Context, session *domain.Session) error
	LoadVerifiedChecks(ctx context.Context, projectID, id string, onAttempt bool) ([]StoredCheck, error)
	ApplyExchange(ctx context.Context, projectID, sessionID string, last map[domain.AuthCheckType]StoredCheck) error
	UserIDFromLastVerifiedChecks(ctx context.Context, projectID string, last map[domain.AuthCheckType]StoredCheck) (*string, error)
	UpdateSessionAfterExchange(ctx context.Context, projectID, sessionID string, userID *string, ttl time.Duration) error
	DeleteAuthAttempt(ctx context.Context, projectID, attemptID string) error
	CreateSessionToken(ctx context.Context, session *domain.Session, previousTokenID string) error
}

// RunExchange performs handoff-token exchange: validate attempt, resolve or
// create the target session, promote verified checks, rotate the session token,
// and delete the attempt. Dialects supply SQL via [ExchangeStore].
func RunExchange(ctx context.Context, store ExchangeStore, projectID, handoffToken string, ttl time.Duration) (*domain.Session, error) {
	attempt, err := store.GetAuthAttemptByHandoffToken(ctx, projectID, HashHandoffToken(handoffToken))
	if err != nil {
		if errors.Is(err, domain.ErrAuthAttemptNotFound()) {
			return nil, domain.ErrSessionInvalidHandoffToken()
		}
		return nil, err
	}
	if err := ValidateHandoffAttempt(attempt); err != nil {
		return nil, err
	}
	if !attempt.IsCompleted() {
		return nil, domain.ErrSessionInvalidHandoffToken()
	}

	var target *domain.Session
	if attempt.SessionID != nil {
		target, err = store.GetSessionByID(ctx, projectID, *attempt.SessionID)
		if err != nil {
			if errors.Is(err, domain.ErrSessionNotFound()) {
				return nil, domain.ErrSessionExchangeConflict()
			}
			return nil, err
		}
	} else {
		target = &domain.Session{ProjectID: projectID, TimeToLive: ExchangeTTL(ttl)}
		if err := store.InsertSession(ctx, target); err != nil {
			return nil, exchangeConflict(err)
		}
	}

	attemptChecks, err := store.LoadVerifiedChecks(ctx, projectID, attempt.ID, true)
	if err != nil {
		return nil, err
	}
	sessionChecks, err := store.LoadVerifiedChecks(ctx, projectID, target.ID, false)
	if err != nil {
		return nil, err
	}
	last := PickLastVerifiedByType(attemptChecks, sessionChecks)
	if err := store.ApplyExchange(ctx, projectID, target.ID, last); err != nil {
		return nil, exchangeConflict(err)
	}
	userID, err := store.UserIDFromLastVerifiedChecks(ctx, projectID, last)
	if err != nil {
		return nil, exchangeConflict(err)
	}
	oldTokenID := target.TokenID
	if err := store.UpdateSessionAfterExchange(ctx, projectID, target.ID, userID, ttl); err != nil {
		return nil, exchangeConflict(err)
	}
	if err := store.DeleteAuthAttempt(ctx, projectID, attempt.ID); err != nil {
		return nil, exchangeConflict(err)
	}
	refreshed, err := store.GetSessionByID(ctx, projectID, target.ID)
	if err != nil {
		return nil, exchangeConflict(err)
	}
	if err := store.CreateSessionToken(ctx, refreshed, oldTokenID); err != nil {
		return nil, exchangeConflict(err)
	}
	return refreshed, nil
}

// HasRealSessionToken reports whether previousTokenID names a persisted token
// that should be revoked after rotation. Empty means the session has no token
// yet (sessions.token_id is NULL until CreateSessionToken links one).
func HasRealSessionToken(previousTokenID string) bool {
	return previousTokenID != ""
}

// exchangeConflict reports a conflict while keeping err in the chain. Both verbs
// must be %w: the dialect's retry (Spanner's ReadWriteTransaction) decides by
// looking for a gRPC status in the returned error, so flattening err to a string
// here strips an ABORTED and turns a retryable conflict into a user-facing one.
func exchangeConflict(err error) error {
	return fmt.Errorf("%w: %w", domain.ErrSessionExchangeConflict(), err)
}
