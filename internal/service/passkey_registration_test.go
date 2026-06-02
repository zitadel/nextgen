package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// --- fakes ---

type fakePasskeyRegRepo struct {
	created   *domain.CreatePasskeyRegistration
	stored    map[string]*domain.PasskeyRegistration // id → row
	deleted   []string
	createErr error
	getErr    error
}

func (f *fakePasskeyRegRepo) Create(_ context.Context, _ database.QueryExecutor, r *domain.CreatePasskeyRegistration) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.created = r
	if f.stored == nil {
		f.stored = map[string]*domain.PasskeyRegistration{}
	}
	f.stored[r.ID] = &domain.PasskeyRegistration{
		ID:        r.ID,
		ProjectID: r.ProjectID,
		UserID:    r.UserID,
		Challenge: r.Challenge,
		ExpiresAt: r.ExpiresAt,
	}
	return nil
}

func (f *fakePasskeyRegRepo) Get(_ context.Context, _ database.QueryExecutor, _, id string) (*domain.PasskeyRegistration, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	if r, ok := f.stored[id]; ok {
		return r, nil
	}
	return nil, domain.ErrPasskeyRegistrationNotFound()
}

func (f *fakePasskeyRegRepo) Delete(_ context.Context, _ database.QueryExecutor, _, id string) error {
	f.deleted = append(f.deleted, id)
	return nil
}

type fakePasskeyRepo struct {
	created []*domain.CreateUserPasskey
	listed  []*domain.UserPasskey
}

func (f *fakePasskeyRepo) Get(_ context.Context, _ database.QueryExecutor, _ ...database.QueryOption) (*domain.UserPasskey, error) {
	return nil, nil
}
func (f *fakePasskeyRepo) List(_ context.Context, _ database.QueryExecutor, _ ...database.QueryOption) ([]*domain.UserPasskey, error) {
	return f.listed, nil
}
func (f *fakePasskeyRepo) Create(_ context.Context, _ database.QueryExecutor, p *domain.CreateUserPasskey) error {
	f.created = append(f.created, p)
	return nil
}
func (f *fakePasskeyRepo) Update(_ context.Context, _ database.QueryExecutor, _ database.Condition, _ ...database.Change) error {
	return nil
}
func (f *fakePasskeyRepo) Delete(_ context.Context, _ database.QueryExecutor, _ database.Condition) error {
	return nil
}
func (f *fakePasskeyRepo) ProjectIDCondition(pid string) database.Condition {
	return database.NewTextCondition(database.NewColumn("t", "project_id"), database.TextOperationEqual, pid)
}
func (f *fakePasskeyRepo) UserIDCondition(uid string) database.Condition {
	return database.NewTextCondition(database.NewColumn("t", "user_id"), database.TextOperationEqual, uid)
}
func (f *fakePasskeyRepo) CredentialIDCondition(cid string) database.Condition {
	return database.NewTextCondition(database.NewColumn("t", "credential_id"), database.TextOperationEqual, cid)
}
func (f *fakePasskeyRepo) PrimaryKeyCondition(id int64) database.Condition {
	return database.NewNumberCondition(database.NewColumn("t", "id"), database.NumberOperationEqual, id)
}
func (f *fakePasskeyRepo) UniqueCondition(pid, uid, cid string) database.Condition {
	return database.And(f.ProjectIDCondition(pid), f.UserIDCondition(uid), f.CredentialIDCondition(cid))
}
func (f *fakePasskeyRepo) SetAttestationType(string) database.Change { return nil }
func (f *fakePasskeyRepo) SetTransports([]string) database.Change    { return nil }
func (f *fakePasskeyRepo) SetSignCount(int64) database.Change        { return nil }
func (f *fakePasskeyRepo) IncrementSignCount(int64) database.Change  { return nil }
func (f *fakePasskeyRepo) SetBackupEligible(bool) database.Change    { return nil }
func (f *fakePasskeyRepo) SetBackupState(bool) database.Change       { return nil }
func (f *fakePasskeyRepo) SetVerifiedAt(time.Time) database.Change   { return nil }
func (f *fakePasskeyRepo) SetLastUsedAt(time.Time) database.Change   { return nil }

func (f *fakePasskeyRepo) PrimaryKeyColumns() []database.Column { return nil }
func (f *fakePasskeyRepo) UniqueKeyColumns() []database.Column  { return nil }
func (f *fakePasskeyRepo) UpdatedAtColumn() database.Column {
	return database.NewColumn("t", "updated_at")
}
func (f *fakePasskeyRepo) qualifiedTableName() string { return "t" }

type fakeIDGen struct{ next string }

func (f *fakeIDGen) New(_ string) (string, error) { return f.next, nil }

// --- helpers ---

func buildTestRegistrationSvc(regRepo *fakePasskeyRegRepo, pkRepo *fakePasskeyRepo) *service.PasskeyRegistrationService {
	return service.NewPasskeyRegistrationService(nil, regRepo, pkRepo, nil, &fakeIDGen{next: "pkreg_test01"})
}

// --- tests ---

func TestPasskeyRegistrationService_IssueChallenge_StoresSession(t *testing.T) {
	regRepo := &fakePasskeyRegRepo{}
	pkRepo := &fakePasskeyRepo{}
	svc := buildTestRegistrationSvc(regRepo, pkRepo)

	out, err := svc.IssuePasskeyRegistrationChallenge(context.Background(), domain.FlowIssuePasskeyRegistrationChallengeInput{
		ProjectID: "proj-1",
		UserID:    "user-1",
		RPID:      "example.com",
		RPOrigins: []string{"https://example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "pkreg_test01", out.ChallengeID)
	assert.NotEmpty(t, out.Options)

	// Options should be valid JSON containing creation challenge fields.
	var optMap map[string]any
	require.NoError(t, json.Unmarshal(out.Options, &optMap))
	assert.Contains(t, optMap, "challenge")
	assert.Contains(t, optMap, "rp")

	// Session must be persisted.
	require.NotNil(t, regRepo.created)
	assert.Equal(t, "proj-1", regRepo.created.ProjectID)
	assert.Equal(t, "user-1", regRepo.created.UserID)
	assert.Equal(t, "pkreg_test01", regRepo.created.ID)
	assert.True(t, regRepo.created.ExpiresAt.After(time.Now()))
}

func TestPasskeyRegistrationService_Submit_NotFoundReturnsProofRejected(t *testing.T) {
	regRepo := &fakePasskeyRegRepo{}
	pkRepo := &fakePasskeyRepo{}
	svc := buildTestRegistrationSvc(regRepo, pkRepo)

	err := svc.SubmitPasskeyRegistration(context.Background(), domain.FlowSubmitPasskeyRegistrationInput{
		ProjectID:   "proj-1",
		UserID:      "user-1",
		ChallengeID: "pkreg_missing",
		Attestation: []byte(`{}`),
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)))
}

func TestPasskeyRegistrationService_Submit_InvalidAttestationReturnsProofRejected(t *testing.T) {
	regRepo := &fakePasskeyRegRepo{}
	pkRepo := &fakePasskeyRepo{}
	svc := buildTestRegistrationSvc(regRepo, pkRepo)

	// First issue a challenge to create the session.
	out, err := svc.IssuePasskeyRegistrationChallenge(context.Background(), domain.FlowIssuePasskeyRegistrationChallengeInput{
		ProjectID: "proj-1",
		UserID:    "user-1",
		RPID:      "example.com",
		RPOrigins: []string{"https://example.com"},
	})
	require.NoError(t, err)

	// Submit a garbage attestation — the domain should reject it.
	err = svc.SubmitPasskeyRegistration(context.Background(), domain.FlowSubmitPasskeyRegistrationInput{
		ProjectID:   "proj-1",
		UserID:      "user-1",
		ChallengeID: out.ChallengeID,
		Attestation: []byte(`{"not":"valid-webauthn"}`),
	})
	require.Error(t, err)
	// Domain wraps parse/verify errors as proof-rejected.
	assert.True(t, errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)))
	// Session is NOT deleted on failure (caller may retry).
	assert.Empty(t, regRepo.deleted)
}
