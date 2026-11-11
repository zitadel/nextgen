package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/internal/api/generated"
)

// admitAll lets every request through its security requirement, so a test
// reaches the operation itself.
type admitAll struct{}

func (admitAll) HandleOAuth2(ctx context.Context, _ api.OperationName, _ api.OAuth2) (context.Context, error) {
	return ctx, nil
}

func (admitAll) HandleSessionCookie(ctx context.Context, _ api.OperationName, _ api.SessionCookie) (context.Context, error) {
	return ctx, nil
}

// deployTargets records the targets createDeployment decoded, and answers
// with a refusal no test reads.
type deployTargets struct {
	api.UnimplementedHandler
	got *api.DeploymentTargetsRequest
}

func (d *deployTargets) CreateDeployment(_ context.Context, req *api.CreateDeploymentRequest, _ api.CreateDeploymentParams) (api.CreateDeploymentRes, error) {
	d.got = &req.Targets
	return &api.CreateDeploymentNotFound{Code: "proj.not_found", Message: "recorded"}, nil
}

func deployThrough(t *testing.T, path, body string) (*deployTargets, *httptest.ResponseRecorder) {
	t.Helper()
	handler := &deployTargets{}
	servers, err := NewServers(handler, admitAll{}, api.WithErrorHandler(OgenErrorHandler))
	require.NoError(t, err)
	mux := http.NewServeMux()
	identity := func(h http.Handler) http.Handler { return h }
	MountAPI(mux, identity, identity, servers)
	req := httptest.NewRequest(http.MethodPost, path+"?project_id=proj_1", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer token")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return handler, rec
}

// A CLI or test kit released before `targets` became `"primary"` or a list of
// preview URLs still deploys to primary with `["primary"]`, and is told the
// shape is deprecated. The new shapes pass untouched and are told nothing.
func TestCreateDeploymentTakesTheLegacyPrimaryTargets(t *testing.T) {
	t.Parallel()

	t.Run("legacy primary list", func(t *testing.T) {
		t.Parallel()
		handler, rec := deployThrough(t, "/api/v1/deployments", `{"release_id":"rel_1","targets":["primary"],"message":"ship"}`)

		require.NotNil(t, handler.got, rec.Body.String())
		assert.True(t, handler.got.IsDeploymentPrimaryTarget())
		assert.Equal(t, legacyPrimaryTargetsDeprecation, rec.Header().Get("Deprecation"))
		assert.Equal(t, []string{legacyPrimaryTargetsLink}, rec.Header().Values("Link"))
	})

	t.Run("primary", func(t *testing.T) {
		t.Parallel()
		handler, rec := deployThrough(t, "/api/v1/deployments", `{"release_id":"rel_1","targets":"primary"}`)

		require.NotNil(t, handler.got, rec.Body.String())
		assert.True(t, handler.got.IsDeploymentPrimaryTarget())
		assert.Empty(t, rec.Header().Get("Deprecation"))
	})

	t.Run("preview URLs", func(t *testing.T) {
		t.Parallel()
		handler, rec := deployThrough(t, "/api/v1/deployments", `{"release_id":"rel_1","targets":["https://pr-7.acme.test"]}`)

		require.NotNil(t, handler.got, rec.Body.String())
		urls, ok := handler.got.GetDeploymentPreviewUrls()
		require.True(t, ok)
		assert.Equal(t, api.DeploymentPreviewUrls{"https://pr-7.acme.test"}, urls)
		assert.Empty(t, rec.Header().Get("Deprecation"))
	})

	t.Run("legacy primary list at the root path keeps the root's earlier date", func(t *testing.T) {
		t.Parallel()
		handler, rec := deployThrough(t, "/deployments", `{"release_id":"rel_1","targets":["primary"]}`)

		require.NotNil(t, handler.got, rec.Body.String())
		assert.True(t, handler.got.IsDeploymentPrimaryTarget())
		assert.Equal(t, rootPathDeprecation, rec.Header().Get("Deprecation"))
		assert.Equal(t, []string{rootPathDeprecationLink, legacyPrimaryTargetsLink}, rec.Header().Values("Link"))
	})
}

func TestLegacyPrimaryTargetsBody(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name, raw string
		want      string
	}{
		{name: "legacy primary list", raw: `{"release_id":"rel_1","targets":["primary"]}`, want: `{"release_id":"rel_1","targets":"primary"}`},
		{name: "primary", raw: `{"targets":"primary"}`},
		{name: "preview URLs", raw: `{"targets":["https://pr-7.acme.test"]}`},
		{name: "primary among preview URLs", raw: `{"targets":["primary","https://pr-7.acme.test"]}`},
		{name: "no targets", raw: `{"release_id":"rel_1"}`},
		{name: "null", raw: `null`},
		{name: "not JSON", raw: `targets=primary`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, ok := legacyPrimaryTargetsBody([]byte(tt.raw))
			if tt.want == "" {
				assert.False(t, ok)
				return
			}
			require.True(t, ok)
			assert.JSONEq(t, tt.want, string(got))
		})
	}
}
