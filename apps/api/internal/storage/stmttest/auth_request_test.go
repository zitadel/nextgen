//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"crypto/rand"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
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
				},
			},
			{
				// Nil scopes are stored as an empty array and read back empty.
				name: "no_state_scopes_or_pkce",
				request: domain.AuthRequest{
					ClientID:     "client_1",
					RedirectURI:  "http://127.0.0.1:4000/callback",
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
				want := request
				if want.Scopes == nil {
					want.Scopes = []string{}
				}
				assert.Equal(t, &want, got)
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

// The purge takes at most limit expired rows of one project, and never a
// live row or another project's.
func TestAuthRequestStatements_DeleteExpired(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		now := authRequestNow()
		projectID := ensureProject(t, d.stmts)
		otherProjectID := ensureProject(t, d.stmts)
		expired := []*domain.AuthRequest{
			createAuthRequest(t, d.stmts, projectID, now.Add(-time.Minute)),
			createAuthRequest(t, d.stmts, projectID, now),
		}
		live := createAuthRequest(t, d.stmts, projectID, now.Add(time.Minute))
		other := createAuthRequest(t, d.stmts, otherProjectID, now.Add(-time.Minute))

		require.NoError(t, d.stmts.DeleteExpiredAuthRequests(t.Context(), projectID, now, 1))
		assert.Equal(t, 1, countAuthRequests(t, d.stmts, expired...), "a purge with limit 1 leaves one expired row")

		require.NoError(t, d.stmts.DeleteExpiredAuthRequests(t.Context(), projectID, now, 10))
		assert.Zero(t, countAuthRequests(t, d.stmts, expired...))
		assert.Equal(t, 1, countAuthRequests(t, d.stmts, live), "the live row is kept")
		assert.Equal(t, 1, countAuthRequests(t, d.stmts, other), "another project's row is kept")
	})
}

// The project FK cascades, so deleting a project takes its requests with it.
func TestAuthRequestStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		request := createAuthRequest(t, d.stmts, projectID, authRequestNow().Add(time.Hour))

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		_, err = d.stmts.GetAuthRequest(t.Context(), projectID, request.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// authRequestNow is truncated to Postgres' microsecond precision so times
// round-trip equal on every dialect.
func authRequestNow() time.Time {
	return time.Now().UTC().Truncate(time.Microsecond)
}

func createAuthRequest(t *testing.T, stmts service.AllStatements, projectID string, expiresAt time.Time) *domain.AuthRequest {
	t.Helper()
	request := &domain.AuthRequest{
		ProjectID:    projectID,
		ClientID:     "client_1",
		RedirectURI:  "https://app.example.com/callback",
		Issuer:       "https://app.example.com/oauth/" + projectID,
		DeploymentID: "dep_1",
		ReleaseID:    "rel_1",
		BindingHash:  domain.HashSecret(rand.Text()),
		ExpiresAt:    expiresAt,
	}
	require.NoError(t, stmts.CreateAuthRequest(t.Context(), request))
	return request
}

// countAuthRequests counts how many of requests are still stored.
func countAuthRequests(t *testing.T, stmts service.AllStatements, requests ...*domain.AuthRequest) int {
	t.Helper()
	n := 0
	for _, request := range requests {
		_, err := stmts.GetAuthRequest(t.Context(), request.ProjectID, request.ID)
		if err == nil {
			n++
			continue
		}
		require.ErrorIs(t, err, new(database.NoRowFoundError))
	}
	return n
}
