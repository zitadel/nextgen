//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
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

// authRequestNow is truncated to Postgres' microsecond precision so times
// round-trip equal on every dialect.
func authRequestNow() time.Time {
	return time.Now().UTC().Truncate(time.Microsecond)
}
