//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestOAuthJWKS signs with a project's token signing key, as the token
// endpoint does, and verifies the signature against the JWKS the project's
// jwks_uri serves: it verifies against that project's set and not against
// another project's. A release that turns OAuth off leaves the set up, so
// the token still verifies; a project that does not exist has no set.
func TestOAuthJWKS(t *testing.T) {
	t.Parallel()
	projects := harness.EnsureProjectService(t)
	newProject := func() string {
		t.Helper()
		project, err := projects.Create(t.Context(), helpers.ProjectName(), []domain.Origin{
			{Pattern: oauthAppOrigin, Kind: domain.OriginKindPrimary},
		}, false)
		require.NoError(t, err)
		deployBundle(t, project.ID, service.BuildReleaseInput{
			ProjectID: project.ID,
			OAuth:     &service.CreateOAuthSettingsInput{ProjectID: project.ID, Enabled: true},
		})
		return project.ID
	}
	project := newProject()
	other := newProject()

	signer, err := harness.EnsureKeyService(t).GetProjectSigner(t.Context(), project, domain.SigningKeyPurposeToken, nil)
	require.NoError(t, err)
	jws, err := signer.Sign([]byte(`{"sub":"user_1"}`))
	require.NoError(t, err)
	token, err := jws.CompactSerialize()
	require.NoError(t, err)

	verify := func(t *testing.T, projectID string) error {
		t.Helper()
		resp, body := getMetadata(t, "/oauth/"+projectID+"/jwks", nil)
		require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
		var set jose.JSONWebKeySet
		require.NoError(t, json.Unmarshal(body, &set), string(body))
		require.NotEmpty(t, set.Keys)
		for _, key := range set.Keys {
			assert.True(t, key.IsPublic(), "the JWKS holds only public keys")
		}
		parsed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.EdDSA})
		require.NoError(t, err)
		keys := set.Key(parsed.Signatures[0].Header.KeyID)
		if len(keys) == 0 {
			return assert.AnError
		}
		_, err = parsed.Verify(keys[0])
		return err
	}

	assert.NoError(t, verify(t, project))
	assert.Error(t, verify(t, other))

	deployBundle(t, project, service.BuildReleaseInput{
		ProjectID: project,
		OAuth:     &service.CreateOAuthSettingsInput{ProjectID: project, Enabled: false},
	})
	assert.NoError(t, verify(t, project), "with oauth off")

	resp, body := getMetadata(t, "/oauth/proj_doesnotexist/jwks", nil)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode, string(body))
}
