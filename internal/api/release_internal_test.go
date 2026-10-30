package api

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Pins the release resource-flavored answers through the resolver gate. The
// pair that matters is the foreign-project one: a write reports the project as
// missing and a read reports the release as missing, so neither confirms that
// the other project exists.
func TestReleaseAccessRow(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})

	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", releaseAccess, opWrite),
		"own-project write with the project secret should pass")
	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", releaseAccess, opRead),
		"own-project read with the project secret should pass")

	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", releaseAccess, opWrite),
		domain.ErrReleaseProjectNotFound().Code)
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", releaseAccess, opRead),
		domain.ErrReleaseNotFound().Code)

	// Releases are management-plane, so a browser credential is denied rather
	// than served a read: project.read alone never reaches the resolver.
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", releaseAccess, opWrite),
		domain.ErrReleasePermissionDenied().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", releaseAccess, opRead),
		domain.ErrReleasePermissionDenied().Code)

	// No credential at all answers as a miss, not as a denial, for the same
	// reason the foreign-project case does.
	assertDomainCode(t, requireProjectAccess(context.Background(), stmts, "proj_a", releaseAccess, opWrite),
		domain.ErrReleaseProjectNotFound().Code)
	assertDomainCode(t, requireProjectAccess(context.Background(), stmts, "proj_a", releaseAccess, opRead),
		domain.ErrReleaseNotFound().Code)

	t.Run("foothold but missing permission is forbidden", func(t *testing.T) {
		deny := false
		foothold := true
		narrow := stubAuthzStmts{allowCheck: &deny, foothold: &foothold}
		assertDomainCode(t, requireProjectAccess(operator, narrow, "proj_a", releaseAccess, opWrite),
			domain.ErrReleasePermissionDenied().Code)
	})

	// Listing runs a different gate, so the codes it refuses with are worth
	// pinning too. How that gate narrows a partial view is machinery every
	// resource shares, and TestRequireProjectListAccess already covers it.
	t.Run("listing refuses with the same release-flavored codes", func(t *testing.T) {
		_, _, err := requireProjectListAccess(operator, stmts, "proj_b", releaseAccess, domain.ResourceKindRelease)
		assertDomainCode(t, err, domain.ErrReleaseNotFound().Code)

		_, _, err = requireProjectListAccess(preview, stmts, "proj_a", releaseAccess, domain.ResourceKindRelease)
		assertDomainCode(t, err, domain.ErrReleasePermissionDenied().Code)

		_, _, err = requireProjectListAccess(context.Background(), stmts, "proj_a", releaseAccess, domain.ResourceKindRelease)
		assertDomainCode(t, err, domain.ErrReleaseNotFound().Code)
	})
}

// Pins the request contract of POST /releases/build at the decoder: a closed
// bundle with a single branding. A generator or schema change that loosens it
// fails here rather than reaching the handler.
func TestBuildReleaseRequestShape(t *testing.T) {
	t.Parallel()

	accepted := map[string]string{
		"branding only": `{"bundle":{"branding":{}}}`,
		// Every kind is optional, and a kind's array may be empty. An empty
		// bundle as a whole is the server's to refuse, not the decoder's.
		"empty kinds": `{"bundle":{"schemas":[],"flow_definitions":[]}}`,
		"schema url":  `{"bundle":{"schemas":[{"kind":"schema-url","url":"https://acme.example/human.json"}]}}`,
	}
	for name, body := range accepted {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := decodeBuildReleaseRequest(body)
			require.NoError(t, err)
		})
	}

	refused := map[string]string{
		"no bundle":          `{"message":"no content"}`,
		"pointers":           `{"pointers":[{"kind":"schema","revision_id":"sch_1"}],"bundle":{"branding":{}}}`,
		"unknown bundle key": `{"bundle":{"flowDefinitions":[{}]}}`,
		// A project has one branding: an array of them is refused at
		// decoding, before it can be materialised element by element.
		"branding as an array": `{"bundle":{"branding":[{},{}]}}`,
	}
	for name, body := range refused {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := decodeBuildReleaseRequest(body)
			assert.Error(t, err)
		})
	}
}

// decodeBuildReleaseRequest runs what the server runs on a request body:
// decode, then validate.
func decodeBuildReleaseRequest(body string) (api.BuildReleaseRequest, error) {
	var req api.BuildReleaseRequest
	if err := req.Decode(jx.DecodeStr(body)); err != nil {
		return req, err
	}
	return req, req.Validate()
}

// A revoked release and one still served are both conflicts.
func TestReleaseErrorResponseConflicts(t *testing.T) {
	assert.Equal(t, http.StatusConflict, releaseErrorResponse(domain.ErrReleaseRevoked()).StatusCode)
	assert.Equal(t, http.StatusConflict, releaseErrorResponse(domain.ErrReleaseInUse(domain.ReleaseInUseDetails{})).StatusCode)
}

// The 409 names every origin still serving the release, so the caller can
// deploy elsewhere or roll back before revoking again, and records the error
// for the error line.
func TestReleaseInUseResponseCarriesOrigins(t *testing.T) {
	ctx := recordingContext(t)
	err := domain.ErrReleaseInUse(domain.ReleaseInUseDetails{Origins: []domain.ReleaseInUseOrigin{
		{Origin: "https://app.acme.com", DeploymentID: "dep_1"},
	}})
	resp, ok := releaseInUseResponse(ctx, err)
	require.True(t, ok)
	assert.Equal(t, api.ErrorCode(domain.ErrReleaseInUse(domain.ReleaseInUseDetails{}).Code), resp.Code)
	assert.Equal(t, []api.RevokeReleaseConflictDetailsOriginsItem{
		{Origin: "https://app.acme.com", DeploymentID: "dep_1"},
	}, resp.Details.Origins)
	recorded, _ := middleware.RecordedError(ctx)
	assert.ErrorIs(t, recorded, err)
}

// Without the origins the 409 cannot name them, so the generic envelope
// answers and logs.
func TestReleaseInUseResponseNeedsOrigins(t *testing.T) {
	ctx := recordingContext(t)
	_, ok := releaseInUseResponse(ctx, domain.ErrReleaseInUse(domain.ReleaseInUseDetails{}).WithDetails(nil))
	assert.False(t, ok)
	_, recorded := middleware.RecordedError(ctx)
	assert.False(t, recorded)
}

// The typed 400 is recorded under the code the body carries, with the
// resources that failed as its cause.
func TestBundleValidationBadRequestRecordsTheError(t *testing.T) {
	ctx := recordingContext(t)
	bundleErr := &service.BundleValidationError{Resources: []service.BundleResourceFailure{
		{Kind: domain.ReleasePointerKindSchema, Index: 0, Err: domain.ErrRequestInvalid()},
	}}
	resp := bundleValidationBadRequest(ctx, bundleErr)

	assert.Equal(t, api.ErrorCode(domain.ErrReleaseInvalid(nil, nil).Code), resp.Code)
	recorded, ok := middleware.RecordedError(ctx)
	require.True(t, ok)
	assert.ErrorIs(t, recorded, domain.ErrReleaseInvalid(nil, nil))
	cause, ok := errors.AsType[*service.BundleValidationError](recorded)
	require.True(t, ok)
	assert.Same(t, bundleErr, cause)
}

func TestRequireBuildKindScopes(t *testing.T) {
	t.Parallel()

	bundle := api.ConfigurationBundle{
		Branding: api.NewOptBranding(api.Branding{
			Layout: api.NewOptBrandingLayout(api.BrandingLayoutCentered),
		}),
		Idps: []api.IdpConnection{{Slug: "google"}},
	}

	t.Run("project.write covers every kind", func(t *testing.T) {
		ctx := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"project.write", "release.write"},
		})
		require.NoError(t, requireBuildKindScopes(ctx, bundle))
	})

	t.Run("missing branding.write is named", func(t *testing.T) {
		ctx := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"release.write", "idp.write"},
		})
		err := requireBuildKindScopes(ctx, bundle)
		require.Error(t, err)
		assertDomainCode(t, err, domain.ErrReleasePermissionDenied().Code)
		assert.Contains(t, err.Error(), "branding.write")
	})

	t.Run("missing idp.write is named", func(t *testing.T) {
		ctx := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"release.write", "branding.write"},
		})
		err := requireBuildKindScopes(ctx, bundle)
		require.Error(t, err)
		assertDomainCode(t, err, domain.ErrReleasePermissionDenied().Code)
		assert.Contains(t, err.Error(), "idp.write")
	})

	t.Run("missing policy.write is named", func(t *testing.T) {
		ctx := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"release.write"},
		})
		err := requireBuildKindScopes(ctx, api.ConfigurationBundle{
			Policies: []api.PublishPolicyRequest{api.NewPasswordSetPolicyInputPublishPolicyRequest(api.PasswordSetPolicyInput{
				Operation: api.PasswordSetPolicyInputOperationAuthFactorPasswordSet,
			})},
		})
		require.Error(t, err)
		assertDomainCode(t, err, domain.ErrReleasePermissionDenied().Code)
		assert.Contains(t, err.Error(), "policy.write")
	})

	t.Run("empty kinds need no extra scope", func(t *testing.T) {
		ctx := WithScopeContext(context.Background(), ScopeContext{
			ProjectID: "proj_a",
			Scope:     []string{"release.write"},
		})
		require.NoError(t, requireBuildKindScopes(ctx, api.ConfigurationBundle{}))
	})
}
