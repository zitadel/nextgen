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
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
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

type fakePasskeyStatements struct {
	testAllStatements
	created []*domain.CreateUserPasskey
	listed  []*domain.UserPasskey
}

func (f *fakePasskeyStatements) CreateUserPasskey(_ context.Context, p *domain.CreateUserPasskey) error {
	f.created = append(f.created, p)
	return nil
}

func (f *fakePasskeyStatements) ListUserPasskeys(_ context.Context, _ *v2database.ListOptions[domain.UserPasskeyField]) (*v2database.ListResult[*domain.UserPasskey], error) {
	return &v2database.ListResult[*domain.UserPasskey]{Items: f.listed}, nil
}

func (f *fakePasskeyStatements) GetUserPasskey(context.Context, string, string, string) (*domain.UserPasskey, error) {
	panic("unexpected call to GetUserPasskey")
}

func (f *fakePasskeyStatements) UpdateUserPasskey(context.Context, *domain.UserPasskey) error {
	panic("unexpected call to UpdateUserPasskey")
}

func (f *fakePasskeyStatements) DeleteUserPasskey(context.Context, string, string, string) error {
	panic("unexpected call to DeleteUserPasskey")
}

type fakePasskeyV2Pool struct {
	stmts *fakePasskeyStatements
}

func (p fakePasskeyV2Pool) Statements() service.AllStatements { return p.stmts }
func (p fakePasskeyV2Pool) Transaction(context.Context, func(context.Context, service.Statementer[service.AllStatements]) error) error {
	panic("unexpected transaction")
}

type fakeIDGen struct{ next string }

func (f *fakeIDGen) New(_ string) (string, error) { return f.next, nil }

// --- helpers ---

func buildTestRegistrationSvc(regRepo *fakePasskeyRegRepo, stmts *fakePasskeyStatements) *service.PasskeyRegistrationService {
	return service.NewPasskeyRegistrationService(nil, fakePasskeyV2Pool{stmts: stmts}, regRepo, &fakeIDGen{next: "pkreg_test01"})
}

// --- tests ---

func TestPasskeyRegistrationService_Begin_StoresSession(t *testing.T) {
	regRepo := &fakePasskeyRegRepo{}
	stmts := &fakePasskeyStatements{}
	svc := buildTestRegistrationSvc(regRepo, stmts)

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

	// Options should be valid JSON containing creation challenge fields.
	var optMap map[string]any
	require.NoError(t, json.Unmarshal(out.Options, &optMap))
	assert.Contains(t, optMap, "challenge")
	assert.Contains(t, optMap, "rp")
	user, ok := optMap["user"].(map[string]any)
	require.True(t, ok, "creation options must include a user object")
	assert.Equal(t, "alice@example.com", user["name"])
	assert.Equal(t, "Alice Example", user["displayName"])

	// Session must be persisted.
	require.NotNil(t, regRepo.created)
	assert.Equal(t, "proj-1", regRepo.created.ProjectID)
	assert.Equal(t, "user-1", regRepo.created.UserID)
	assert.Equal(t, "pkreg_test01", regRepo.created.ID)
	assert.Equal(t, "alice@example.com", regRepo.created.Challenge.Username)
	assert.Equal(t, "Alice Example", regRepo.created.Challenge.DisplayName)
	assert.True(t, regRepo.created.ExpiresAt.After(time.Now()))
}

func TestPasskeyRegistrationService_Begin_UsesNeutralLabelWithoutUsername(t *testing.T) {
	regRepo := &fakePasskeyRegRepo{}
	stmts := &fakePasskeyStatements{}
	svc := buildTestRegistrationSvc(regRepo, stmts)

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
	assert.Equal(t, "Passkey account", regRepo.created.Challenge.Username)
	assert.Empty(t, regRepo.created.Challenge.DisplayName)
}

func TestPasskeyRegistrationService_Begin_RequestsDiscoverableCredential(t *testing.T) {
	regRepo := &fakePasskeyRegRepo{}
	stmts := &fakePasskeyStatements{}
	svc := buildTestRegistrationSvc(regRepo, stmts)

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
	regRepo := &fakePasskeyRegRepo{}
	stmts := &fakePasskeyStatements{}
	svc := buildTestRegistrationSvc(regRepo, stmts)

	err := svc.Finish(context.Background(), service.FinishRegistrationInput{
		ProjectID:      "proj-1",
		RegistrationID: "pkreg_missing",
		Attestation:    []byte(`{}`),
	})
	require.Error(t, err)
}

func TestPasskeyRegistrationService_Finish_InvalidAttestationReturnsProofRejected(t *testing.T) {
	regRepo := &fakePasskeyRegRepo{}
	stmts := &fakePasskeyStatements{}
	svc := buildTestRegistrationSvc(regRepo, stmts)

	// First begin a ceremony to create the session.
	out, err := svc.Begin(context.Background(), service.BeginRegistrationInput{
		ProjectID: "proj-1",
		UserID:    "user-1",
		RPID:      "example.com",
		RPOrigins: []string{"https://example.com"},
	})
	require.NoError(t, err)

	// Submit a garbage attestation — the domain should reject it.
	err = svc.Finish(context.Background(), service.FinishRegistrationInput{
		ProjectID:      "proj-1",
		RegistrationID: out.RegistrationID,
		Attestation:    []byte(`{"not":"valid-webauthn"}`),
	})
	require.Error(t, err)
	// Domain wraps parse/verify errors as proof-rejected.
	assert.True(t, errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)))
	// Session is NOT deleted on failure (caller may retry).
	assert.Empty(t, regRepo.deleted)
}
