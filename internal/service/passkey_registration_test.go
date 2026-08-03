package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
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
			if r.ID == "" {
				r.ID = "pkreg_test01"
			}
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

type passkeyUserState struct {
	created []*domain.CreateUserPasskey
	listed  []*domain.UserPasskey
}

func (s *passkeyUserState) expectUserPasskeys(stmts *servicemocks.MockAllStatements) {
	stmts.EXPECT().
		ListUserPasskeys(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ *database.ListOptions[domain.UserPasskeyField]) (*database.ListResult[*domain.UserPasskey], error) {
			return &database.ListResult[*domain.UserPasskey]{Items: s.listed}, nil
		}).AnyTimes()
	stmts.EXPECT().
		CreateUserPasskey(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, p *domain.CreateUserPasskey) error {
			s.created = append(s.created, p)
			return nil
		}).AnyTimes()
}

func buildTestRegistrationSvc(t *testing.T, regState *passkeyRegState, userState *passkeyUserState) *service.PasskeyRegistrationService {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	regState.expectCRUD(statements)
	userState.expectUserPasskeys(statements)
	return service.NewPasskeyRegistrationService(pool)
}

func TestPasskeyRegistrationService_Begin_StoresSession(t *testing.T) {
	regState := &passkeyRegState{}
	userState := &passkeyUserState{}
	svc := buildTestRegistrationSvc(t, regState, userState)

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
	assert.Equal(t, "user-1", out.UserID)
	assert.NotEmpty(t, out.Options)

	var optMap map[string]any
	require.NoError(t, json.Unmarshal(out.Options, &optMap))
	assert.Contains(t, optMap, "challenge")
	assert.Contains(t, optMap, "rp")
	require.IsType(t, map[string]any{}, optMap["user"], "creation options must include a user object")
	user := optMap["user"].(map[string]any)
	assert.Equal(t, "alice@example.com", user["name"])
	assert.Equal(t, "Alice Example", user["displayName"])

	require.NotNil(t, regState.created)
	assert.Equal(t, "proj-1", regState.created.ProjectID)
	assert.Equal(t, "user-1", regState.created.UserID)
	assert.Equal(t, "pkreg_test01", regState.created.ID)
	assert.Equal(t, "alice@example.com", regState.created.Challenge.Username)
	assert.Equal(t, "Alice Example", regState.created.Challenge.DisplayName)
	assert.True(t, regState.created.ExpiresAt.After(time.Now()))
}

func TestPasskeyRegistrationService_Begin_MintsUserIDWhenEmpty(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockStatementPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()

	regState := &passkeyRegState{}
	userState := &passkeyUserState{}
	regState.expectCRUD(statements)
	userState.expectUserPasskeys(statements)
	statements.EXPECT().NewManagedID(string(domain.PrefixUser)).Return("user_minted01", nil)

	svc := service.NewPasskeyRegistrationService(pool)
	out, err := svc.Begin(context.Background(), service.BeginRegistrationInput{
		ProjectID: "proj-1",
		RPID:      "example.com",
		RPOrigins: []string{"https://example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "user_minted01", out.UserID)
	require.NotNil(t, regState.created)
	assert.Equal(t, "user_minted01", regState.created.UserID)
}

func TestPasskeyRegistrationService_Begin_UsesNeutralLabelWithoutUsername(t *testing.T) {
	regState := &passkeyRegState{}
	userState := &passkeyUserState{}
	svc := buildTestRegistrationSvc(t, regState, userState)

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
	require.IsType(t, map[string]any{}, optMap["user"], "creation options must include a user object")
	user := optMap["user"].(map[string]any)
	assert.Equal(t, "Passkey account", user["name"])
	assert.Empty(t, user["displayName"])
	assert.Equal(t, "Passkey account", regState.created.Challenge.Username)
	assert.Empty(t, regState.created.Challenge.DisplayName)
}

func TestPasskeyRegistrationService_Begin_RequestsDiscoverableCredential(t *testing.T) {
	regState := &passkeyRegState{}
	userState := &passkeyUserState{}
	svc := buildTestRegistrationSvc(t, regState, userState)

	out, err := svc.Begin(context.Background(), service.BeginRegistrationInput{
		ProjectID: "proj-1",
		UserID:    "user-1",
		RPID:      "example.com",
		RPOrigins: []string{"https://example.com"},
	})
	require.NoError(t, err)

	var optMap map[string]any
	require.NoError(t, json.Unmarshal(out.Options, &optMap))
	require.IsType(t, map[string]any{}, optMap["authenticatorSelection"], "creation options must include authenticatorSelection")
	selection := optMap["authenticatorSelection"].(map[string]any)
	assert.Equal(t, "required", selection["residentKey"])
	assert.Equal(t, "preferred", selection["userVerification"])
}

func TestPasskeyRegistrationService_Finish_NotFoundReturnsError(t *testing.T) {
	regState := &passkeyRegState{}
	userState := &passkeyUserState{}
	svc := buildTestRegistrationSvc(t, regState, userState)

	err := svc.Finish(context.Background(), service.FinishRegistrationInput{
		ProjectID:      "proj-1",
		RegistrationID: "pkreg_missing",
		Attestation:    []byte(`{}`),
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrPasskeyRegistrationNotFound()))
}

func TestPasskeyRegistrationService_Finish_InvalidAttestationReturnsProofRejected(t *testing.T) {
	regState := &passkeyRegState{}
	userState := &passkeyUserState{}
	svc := buildTestRegistrationSvc(t, regState, userState)

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
	assert.Empty(t, regState.deleted)
}

func TestPasskeyRegistrationService_Finish_StoresPasskeyName(t *testing.T) {
	tests := []struct {
		name         string
		passkeyName  string
		expectedName string
	}{
		{
			name:         "caller-supplied name is stored",
			passkeyName:  "Work laptop",
			expectedName: "Work laptop",
		},
		{
			// Without a name the credential still needs something displayable;
			// the user's display name is not it — it is the same for every
			// credential the user registers.
			name:         "no name falls back to the credential's own properties",
			expectedName: domain.PasskeyNameDeviceBound,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			regState := &passkeyRegState{}
			userState := &passkeyUserState{}
			svc := buildTestRegistrationSvc(t, regState, userState)

			out, err := svc.Begin(context.Background(), service.BeginRegistrationInput{
				ProjectID:   "proj-1",
				UserID:      "user-1",
				Username:    "alice@example.com",
				DisplayName: "Alice Example",
				RPID:        passkeyRPID,
				RPOrigins:   []string{passkeyOrigin},
			})
			require.NoError(t, err)

			err = svc.Finish(context.Background(), service.FinishRegistrationInput{
				ProjectID:      "proj-1",
				RegistrationID: out.RegistrationID,
				Attestation:    []byte(attestPasskeyRegistration(t, out.Options)),
				PasskeyName:    tt.passkeyName,
			})
			require.NoError(t, err)

			require.Len(t, userState.created, 1)
			assert.Equal(t, tt.expectedName, userState.created[0].Name)
		})
	}
}

// attestPasskeyRegistration answers creation options with a real attestation
// from a fresh virtual authenticator.
func attestPasskeyRegistration(t *testing.T, options []byte) string {
	t.Helper()

	rp := virtualwebauthn.RelyingParty{ID: passkeyRPID, Name: "Example", Origin: passkeyOrigin}
	auth := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte("user-1"),
	})
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	auth.AddCredential(cred)

	attestationOptions, err := virtualwebauthn.ParseAttestationOptions(string(options))
	require.NoError(t, err)

	return virtualwebauthn.CreateAttestationResponse(rp, auth, cred, *attestationOptions)
}
