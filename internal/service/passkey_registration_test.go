package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type passkeyRegState struct {
	created *domain.CreatePasskeyRegistration
	stored  map[string]*domain.PasskeyRegistration
	deleted []string
}

func (s *passkeyRegState) expectCRUD(stmts *servicemocks.MockAllStatements) {
	stmts.EXPECT().
		CreatePasskeyRegistration(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, r *domain.CreatePasskeyRegistration) error {
			s.created = r
			if s.stored == nil {
				s.stored = map[string]*domain.PasskeyRegistration{}
			}
			s.stored[r.ID] = &domain.PasskeyRegistration{
				ID:        r.ID,
				ProjectID: r.ProjectID,
				UserID:    r.UserID,
				Challenge: r.Challenge,
				ExpiresAt: r.ExpiresAt,
			}
			return nil
		}).AnyTimes()
	stmts.EXPECT().
		GetPasskeyRegistration(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _, id string) (*domain.PasskeyRegistration, error) {
			if r, ok := s.stored[id]; ok {
				return r, nil
			}
			return nil, database.NewNoRowFoundError(nil)
		}).AnyTimes()
	stmts.EXPECT().
		DeletePasskeyRegistration(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _, id string) error {
			s.deleted = append(s.deleted, id)
			return nil
		}).AnyTimes()
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

func buildTestRegistrationSvc(t *testing.T, state *passkeyRegState, pkRepo *fakePasskeyRepo) *service.PasskeyRegistrationService {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	state.expectCRUD(statements)
	return service.NewPasskeyRegistrationService(nil, pool, pkRepo, &fakeIDGen{next: "pkreg_test01"})
}

func TestPasskeyRegistrationService_Begin_StoresSession(t *testing.T) {
	state := &passkeyRegState{}
	pkRepo := &fakePasskeyRepo{}
	svc := buildTestRegistrationSvc(t, state, pkRepo)

	out, err := svc.Begin(context.Background(), service.BeginRegistrationInput{
		ProjectID:   "proj-1",
		UserID:      "user-1",
		Username:    "alice@example.com",
		DisplayName: "Alice Example",
		RPID:        "example.com",
		RPOrigins:   []string{"https://example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "pkreg_test01", out.RegistrationID)
	assert.NotEmpty(t, out.Options)

	var optMap map[string]any
	require.NoError(t, json.Unmarshal(out.Options, &optMap))
	assert.Contains(t, optMap, "challenge")
	assert.Contains(t, optMap, "rp")
	user, ok := optMap["user"].(map[string]any)
	require.True(t, ok, "creation options must include a user object")
	assert.Equal(t, "alice@example.com", user["name"])
	assert.Equal(t, "Alice Example", user["displayName"])

	require.NotNil(t, state.created)
	assert.Equal(t, "proj-1", state.created.ProjectID)
	assert.Equal(t, "user-1", state.created.UserID)
	assert.Equal(t, "pkreg_test01", state.created.ID)
	assert.Equal(t, "alice@example.com", state.created.Challenge.Username)
	assert.Equal(t, "Alice Example", state.created.Challenge.DisplayName)
	assert.True(t, state.created.ExpiresAt.After(time.Now()))
}

func TestPasskeyRegistrationService_Begin_UsesNeutralLabelWithoutUsername(t *testing.T) {
	state := &passkeyRegState{}
	pkRepo := &fakePasskeyRepo{}
	svc := buildTestRegistrationSvc(t, state, pkRepo)

	out, err := svc.Begin(context.Background(), service.BeginRegistrationInput{
		ProjectID: "proj-1",
		UserID:    "user-1",
		RPID:      "example.com",
		RPOrigins: []string{"https://example.com"},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, out.Options)

	var optMap map[string]any
	require.NoError(t, json.Unmarshal(out.Options, &optMap))
	user, ok := optMap["user"].(map[string]any)
	require.True(t, ok, "creation options must include a user object")
	assert.Equal(t, "Passkey account", user["name"])
	assert.Empty(t, user["displayName"])
	assert.Equal(t, "Passkey account", state.created.Challenge.Username)
	assert.Empty(t, state.created.Challenge.DisplayName)
}

func TestPasskeyRegistrationService_Begin_RequestsDiscoverableCredential(t *testing.T) {
	state := &passkeyRegState{}
	pkRepo := &fakePasskeyRepo{}
	svc := buildTestRegistrationSvc(t, state, pkRepo)

	out, err := svc.Begin(context.Background(), service.BeginRegistrationInput{
		ProjectID: "proj-1",
		UserID:    "user-1",
		RPID:      "example.com",
		RPOrigins: []string{"https://example.com"},
	})
	require.NoError(t, err)

	var optMap map[string]any
	require.NoError(t, json.Unmarshal(out.Options, &optMap))
	selection, ok := optMap["authenticatorSelection"].(map[string]any)
	require.True(t, ok, "creation options must include authenticatorSelection")
	assert.Equal(t, "required", selection["residentKey"])
	assert.Equal(t, "preferred", selection["userVerification"])
}

func TestPasskeyRegistrationService_Finish_NotFoundReturnsError(t *testing.T) {
	state := &passkeyRegState{}
	pkRepo := &fakePasskeyRepo{}
	svc := buildTestRegistrationSvc(t, state, pkRepo)

	err := svc.Finish(context.Background(), service.FinishRegistrationInput{
		ProjectID:      "proj-1",
		RegistrationID: "pkreg_missing",
		Attestation:    []byte(`{}`),
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrPasskeyRegistrationNotFound()))
}

func TestPasskeyRegistrationService_Finish_InvalidAttestationReturnsProofRejected(t *testing.T) {
	state := &passkeyRegState{}
	pkRepo := &fakePasskeyRepo{}
	svc := buildTestRegistrationSvc(t, state, pkRepo)

	out, err := svc.Begin(context.Background(), service.BeginRegistrationInput{
		ProjectID: "proj-1",
		UserID:    "user-1",
		RPID:      "example.com",
		RPOrigins: []string{"https://example.com"},
	})
	require.NoError(t, err)

	err = svc.Finish(context.Background(), service.FinishRegistrationInput{
		ProjectID:      "proj-1",
		RegistrationID: out.RegistrationID,
		Attestation:    []byte(`{"not":"valid-webauthn"}`),
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)))
	assert.Empty(t, state.deleted)
}
