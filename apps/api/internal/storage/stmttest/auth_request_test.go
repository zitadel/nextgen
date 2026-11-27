//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestAuthRequestStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		tests := []struct {
			name    string
			request domain.AuthRequest
		}{
			{
				name: "every_field",
				request: domain.AuthRequest{
					ClientID:      "client_1",
					RedirectURI:   "https://app.example.com/callback",
					State:         "xyz",
					Scopes:        []string{"read", "write"},
					CodeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
					Issuer:        "https://app.example.com/oauth/proj_1",
					DeploymentID:  "dep_1",
					ReleaseID:     "rel_1",
					BindingHash:   domain.HashSecret("nonce"),
					// The chain the request starts, which the redemption of
					// its code reads back; the cases below store none.
					CorrelationID: "chain_authorize",
				},
			},
			{
				// Empty scopes are read back empty, not nil.
				name: "no_scopes_or_pkce",
				request: domain.AuthRequest{
					ClientID:     "client_1",
					RedirectURI:  "http://127.0.0.1:4000/callback",
					State:        "xyz",
					Scopes:       []string{},
					Issuer:       "https://app.example.com/oauth/proj_1",
					DeploymentID: "dep_1",
					ReleaseID:    "rel_1",
					BindingHash:  domain.HashSecret("nonce"),
				},
			},
			{
				// Unset scopes are stored and read back empty on every dialect.
				name: "nil_scopes",
				request: domain.AuthRequest{
					ClientID:     "client_1",
					RedirectURI:  "https://app.example.com/callback",
					State:        "xyz",
					Issuer:       "https://app.example.com/oauth/proj_1",
					DeploymentID: "dep_1",
					ReleaseID:    "rel_1",
					BindingHash:  domain.HashSecret("nonce"),
				},
			},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				request := tt.request
				request.ProjectID = ensureProject(t, d.stmts)
				request.ExpiresAt = authRequestNow().Add(10 * time.Minute)
				require.NoError(t, d.stmts.CreateAuthRequest(t.Context(), &request))

				assert.True(t, domain.PrefixAuthRequest.Matches(request.ID), "id %q is not authreq_-prefixed", request.ID)
				assert.WithinDuration(t, time.Now(), request.CreatedAt, 5*time.Second)

				got, err := d.stmts.GetAuthRequest(t.Context(), request.ProjectID, request.ID)
				require.NoError(t, err)
				if request.Scopes == nil {
					request.Scopes = []string{}
				}
				assert.Equal(t, &request, got)
			})
		}
	})
}

func TestAuthRequestStatements_GetUnknownIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		_, err := d.stmts.GetAuthRequest(t.Context(), projectID, "authreq_unknown")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// The project FK cascades, so deleting a project takes its requests with it.
func TestAuthRequestStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		request := &domain.AuthRequest{
			ProjectID:    projectID,
			ClientID:     "client_1",
			RedirectURI:  "https://app.example.com/callback",
			State:        "xyz",
			Scopes:       []string{},
			Issuer:       "https://app.example.com/oauth/" + projectID,
			DeploymentID: "dep_1",
			ReleaseID:    "rel_1",
			BindingHash:  domain.HashSecret("nonce"),
			ExpiresAt:    authRequestNow().Add(time.Hour),
		}
		require.NoError(t, d.stmts.CreateAuthRequest(t.Context(), request))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetAuthRequest(t.Context(), projectID, request.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestAuthRequestStatements_SetAndRedeemCode(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		request := createAuthRequest(t, d)
		setCode(&request, "code_1")
		require.NoError(t, d.stmts.SetAuthRequestCode(t.Context(), &request, authRequestNow()))

		got, err := d.stmts.GetAuthRequest(t.Context(), request.ProjectID, request.ID)
		require.NoError(t, err)
		assert.Equal(t, &request, got)

		redeemed, err := d.stmts.RedeemAuthRequestCode(t.Context(), request.ProjectID, request.CodeHash)
		require.NoError(t, err)
		assert.Equal(t, &request, redeemed)

		_, err = d.stmts.RedeemAuthRequestCode(t.Context(), request.ProjectID, request.CodeHash)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetAuthRequest(t.Context(), request.ProjectID, request.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// A request gets one code: a second one changes nothing and the first still
// redeems.
func TestAuthRequestStatements_SetCodeOnce(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		request := createAuthRequest(t, d)
		first := request
		setCode(&first, "code_1")
		require.NoError(t, d.stmts.SetAuthRequestCode(t.Context(), &first, authRequestNow()))

		second := request
		setCode(&second, "code_2")
		second.UserID = "user_2"
		second.SessionID = "sess_2"
		err := d.stmts.SetAuthRequestCode(t.Context(), &second, authRequestNow())
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.RedeemAuthRequestCode(t.Context(), request.ProjectID, second.CodeHash)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		redeemed, err := d.stmts.RedeemAuthRequestCode(t.Context(), request.ProjectID, first.CodeHash)
		require.NoError(t, err)
		assert.Equal(t, &first, redeemed)
	})
}

func TestAuthRequestStatements_CodeUnknown(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		request := createAuthRequest(t, d)

		unknown := request
		unknown.ID = "authreq_unknown"
		setCode(&unknown, "code_1")
		err := d.stmts.SetAuthRequestCode(t.Context(), &unknown, authRequestNow())
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		_, err = d.stmts.RedeemAuthRequestCode(t.Context(), request.ProjectID, domain.HashSecret("never issued"))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		setCode(&request, "code_1")
		require.NoError(t, d.stmts.SetAuthRequestCode(t.Context(), &request, authRequestNow()))
		otherProject := ensureProject(t, d.stmts)
		_, err = d.stmts.RedeemAuthRequestCode(t.Context(), otherProject, request.CodeHash)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		// The refused redemption left the code in its own project.
		redeemed, err := d.stmts.RedeemAuthRequestCode(t.Context(), request.ProjectID, request.CodeHash)
		require.NoError(t, err)
		assert.Equal(t, &request, redeemed)
	})
}

// An expired request gets no code and its row stays as it was.
func TestAuthRequestStatements_SetCodeRefusesExpiredRequest(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		request := createAuthRequest(t, d)

		withCode := request
		setCode(&withCode, "code_1")
		err := d.stmts.SetAuthRequestCode(t.Context(), &withCode, request.ExpiresAt)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		got, err := d.stmts.GetAuthRequest(t.Context(), request.ProjectID, request.ID)
		require.NoError(t, err)
		assert.Equal(t, &request, got)
	})
}

// Of several redemptions of one code at once, exactly one gets the request.
func TestAuthRequestStatements_RedeemCodeConcurrent(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		request := createAuthRequest(t, d)
		setCode(&request, "code_1")
		require.NoError(t, d.stmts.SetAuthRequestCode(t.Context(), &request, authRequestNow()))

		var (
			wg      sync.WaitGroup
			results [8]*domain.AuthRequest
			errs    [8]error
		)
		start := make(chan struct{})
		for i := range results {
			wg.Go(func() {
				<-start // release together so the redemptions overlap
				results[i], errs[i] = d.stmts.RedeemAuthRequestCode(t.Context(), request.ProjectID, request.CodeHash)
			})
		}
		close(start)
		wg.Wait()

		var won int
		for i := range results {
			if errs[i] == nil {
				won++
				assert.Equal(t, &request, results[i])
				continue
			}
			assert.ErrorIs(t, errs[i], new(database.NoRowFoundError), "redemption %d", i)
		}
		assert.Equal(t, 1, won, "a code redeems exactly once")
	})
}

// Requests without a code do not collide on the code index (Spanner indexes
// NULL as a value unless the index is NULL_FILTERED).
func TestAuthRequestStatements_RequestsWithoutCodeShareAProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		first := createAuthRequest(t, d)
		second := createAuthRequestIn(t, d, first.ProjectID)
		for _, request := range []domain.AuthRequest{first, second} {
			got, err := d.stmts.GetAuthRequest(t.Context(), request.ProjectID, request.ID)
			require.NoError(t, err)
			assert.Equal(t, &request, got)
		}

		setCode(&first, "code_1")
		require.NoError(t, d.stmts.SetAuthRequestCode(t.Context(), &first, authRequestNow()))
		setCode(&second, "code_2")
		require.NoError(t, d.stmts.SetAuthRequestCode(t.Context(), &second, authRequestNow()))
		for _, request := range []domain.AuthRequest{first, second} {
			redeemed, err := d.stmts.RedeemAuthRequestCode(t.Context(), request.ProjectID, request.CodeHash)
			require.NoError(t, err)
			assert.Equal(t, &request, redeemed)
		}
	})
}

// createAuthRequest stores a request without a code in a project of its own.
func createAuthRequest(t *testing.T, d dialect) domain.AuthRequest {
	t.Helper()
	return createAuthRequestIn(t, d, ensureProject(t, d.stmts))
}

// createAuthRequestIn stores a request without a code in projectID.
func createAuthRequestIn(t *testing.T, d dialect, projectID string) domain.AuthRequest {
	t.Helper()
	request := domain.AuthRequest{
		ProjectID:     projectID,
		ClientID:      "client_1",
		RedirectURI:   "https://app.example.com/callback",
		State:         "xyz",
		Scopes:        []string{"read"},
		CodeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		Issuer:        "https://app.example.com/oauth/" + projectID,
		DeploymentID:  "dep_1",
		ReleaseID:     "rel_1",
		BindingHash:   domain.HashSecret("nonce"),
		ExpiresAt:     authRequestNow().Add(10 * time.Minute),
	}
	require.NoError(t, d.stmts.CreateAuthRequest(t.Context(), &request))
	return request
}

func setCode(request *domain.AuthRequest, code string) {
	request.CodeHash = domain.HashSecret(code)
	request.UserID = "user_1"
	request.SessionID = "sess_1"
	request.CodeExpiresAt = new(authRequestNow().Add(time.Minute))
}

// authRequestNow is truncated to Postgres' microsecond precision so times
// round-trip equal on every dialect.
func authRequestNow() time.Time {
	return time.Now().UTC().Truncate(time.Microsecond)
}
