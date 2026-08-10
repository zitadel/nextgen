package session_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/session"
)

type fakeExchangeStore struct {
	attempt        *domain.AuthAttempt
	attemptErr     error
	sessions       map[string]*domain.Session
	getSessionErr  error
	insertErr      error
	attemptChecks  []session.StoredCheck
	sessionChecks  []session.StoredCheck
	applyErr       error
	userID         *string
	userIDErr      error
	updateErr      error
	deleteErr      error
	createTokenErr error

	deletedAttempt string
	appliedOn      string
	updatedTTL     time.Duration
	tokenPrev      string
	inserted       *domain.Session
}

func (f *fakeExchangeStore) GetAuthAttemptByHandoffToken(context.Context, string, []byte) (*domain.AuthAttempt, error) {
	if f.attemptErr != nil {
		return nil, f.attemptErr
	}
	return f.attempt, nil
}

func (f *fakeExchangeStore) GetSessionByID(_ context.Context, _, sessionID string) (*domain.Session, error) {
	if f.getSessionErr != nil {
		return nil, f.getSessionErr
	}
	s, ok := f.sessions[sessionID]
	if !ok {
		return nil, domain.ErrSessionNotFound()
	}
	cp := *s
	return &cp, nil
}

func (f *fakeExchangeStore) InsertSession(_ context.Context, s *domain.Session) error {
	if f.insertErr != nil {
		return f.insertErr
	}
	s.ID = "sess-new"
	s.TokenID = ""
	s.CreatedAt = time.Now()
	s.UpdatedAt = s.CreatedAt
	s.ExpiresAt = s.CreatedAt.Add(s.TimeToLive)
	f.inserted = s
	if f.sessions == nil {
		f.sessions = map[string]*domain.Session{}
	}
	cp := *s
	f.sessions[s.ID] = &cp
	return nil
}

func (f *fakeExchangeStore) LoadVerifiedChecks(_ context.Context, _, id string, onAttempt bool) ([]session.StoredCheck, error) {
	if onAttempt {
		return f.attemptChecks, nil
	}
	_ = id
	return f.sessionChecks, nil
}

func (f *fakeExchangeStore) ApplyExchange(_ context.Context, _, sessionID string, _ map[domain.AuthCheckType]session.StoredCheck) error {
	f.appliedOn = sessionID
	return f.applyErr
}

func (f *fakeExchangeStore) UserIDFromLastVerifiedChecks(context.Context, string, map[domain.AuthCheckType]session.StoredCheck) (*string, error) {
	return f.userID, f.userIDErr
}

func (f *fakeExchangeStore) UpdateSessionAfterExchange(_ context.Context, _, _ string, _ *string, ttl time.Duration) error {
	f.updatedTTL = ttl
	return f.updateErr
}

func (f *fakeExchangeStore) DeleteAuthAttempt(_ context.Context, _, attemptID string) error {
	f.deletedAttempt = attemptID
	return f.deleteErr
}

func (f *fakeExchangeStore) CreateSessionToken(_ context.Context, s *domain.Session, previousTokenID string) error {
	f.tokenPrev = previousTokenID
	if f.createTokenErr != nil {
		return f.createTokenErr
	}
	s.TokenID = "tok-rotated"
	return nil
}

func completedAttempt(projectID string, sessionID *string) *domain.AuthAttempt {
	now := time.Now()
	return &domain.AuthAttempt{
		ProjectID:      projectID,
		ID:             "attempt-1",
		SessionID:      sessionID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
		HandoffToken:   &domain.HandoffToken{TokenHash: session.HashHandoffToken("plain")},
		HandedOffAt:    &now,
	}
}

func TestRunExchange_newSession(t *testing.T) {
	t.Parallel()
	store := &fakeExchangeStore{
		attempt: completedAttempt("proj", nil),
		attemptChecks: []session.StoredCheck{
			{ID: "c1", Type: domain.AuthCheckTypePassword, LastVerifiedAt: time.Now(), OnAttempt: true},
		},
	}
	got, err := session.RunExchange(t.Context(), store, "proj", "plain", time.Hour)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "sess-new", got.ID)
	assert.Equal(t, "tok-rotated", got.TokenID)
	assert.Equal(t, "attempt-1", store.deletedAttempt)
	assert.Equal(t, "sess-new", store.appliedOn)
	assert.Equal(t, time.Hour, store.updatedTTL)
	assert.Equal(t, "", store.tokenPrev)
	assert.Equal(t, time.Hour, store.inserted.TimeToLive)
}

func TestRunExchange_stepUpExistingSession(t *testing.T) {
	t.Parallel()
	sid := "sess-1"
	store := &fakeExchangeStore{
		attempt: completedAttempt("proj", &sid),
		sessions: map[string]*domain.Session{
			sid: {ProjectID: "proj", ID: sid, TokenID: "tok-old", TimeToLive: time.Hour},
		},
		attemptChecks: []session.StoredCheck{
			{ID: "c2", Type: domain.AuthCheckTypePassword, LastVerifiedAt: time.Now(), OnAttempt: true},
		},
	}
	got, err := session.RunExchange(t.Context(), store, "proj", "plain", 0)
	require.NoError(t, err)
	assert.Equal(t, sid, got.ID)
	assert.Equal(t, "tok-old", store.tokenPrev)
	assert.Equal(t, "tok-rotated", got.TokenID)
}

func TestRunExchange_invalidHandoff(t *testing.T) {
	t.Parallel()
	store := &fakeExchangeStore{attemptErr: domain.ErrAuthAttemptNotFound()}
	_, err := session.RunExchange(t.Context(), store, "proj", "plain", 0)
	assert.ErrorIs(t, err, domain.ErrSessionInvalidHandoffToken())
}

func TestRunExchange_missingSessionConflict(t *testing.T) {
	t.Parallel()
	sid := "missing"
	store := &fakeExchangeStore{attempt: completedAttempt("proj", &sid)}
	_, err := session.RunExchange(t.Context(), store, "proj", "plain", 0)
	assert.ErrorIs(t, err, domain.ErrSessionExchangeConflict())
}

func TestRunExchange_applyConflict(t *testing.T) {
	t.Parallel()
	store := &fakeExchangeStore{
		attempt:  completedAttempt("proj", nil),
		applyErr: errors.New("promote failed"),
	}
	_, err := session.RunExchange(t.Context(), store, "proj", "plain", 0)
	assert.ErrorIs(t, err, domain.ErrSessionExchangeConflict())
}

func TestHasRealSessionToken(t *testing.T) {
	t.Parallel()
	assert.False(t, session.HasRealSessionToken(""))
	assert.True(t, session.HasRealSessionToken("tkn_42"))
}
