package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// fakeBearers verifies one token, as the platform's authorization server would.
type fakeBearers struct {
	err error
}

const testBearer = "header.payload.signature"

func (f fakeBearers) VerifyUserBearer(_ context.Context, token string) (UserBearer, error) {
	if f.err != nil {
		return UserBearer{}, f.err
	}
	if token != testBearer {
		return UserBearer{}, domain.ErrInvalidToken()
	}
	return UserBearer{
		ProjectID: domain.PlatformProjectID,
		UserID:    "user_developer",
		ClientID:  "cli",
		ExpiresAt: time.Now().Add(time.Minute),
	}, nil
}

func userBearerHandler(verifier UserBearerVerifier) *SecurityHandler {
	return NewSecurityHandler(nil).WithPlatformProject(domain.PlatformProjectID).WithUserBearers(verifier)
}

// A user bearer is the same principal a platform session of that user is
// (ADR 053 §5): HandleNextgenSession builds the same ScopeContext.
func TestUserBearerActsAsTheSessionUser(t *testing.T) {
	ctx, err := userBearerHandler(fakeBearers{}).HandleOAuth2(t.Context(), api.ListDeploymentsOperation, api.OAuth2{Token: testBearer})
	require.NoError(t, err)

	scope, ok := GetScopeContext(ctx)
	require.True(t, ok)
	assert.Equal(t, ScopeContext{
		ProjectID:         domain.PlatformProjectID,
		PrincipalType:     domain.AuthzPrincipalTypeUser,
		PrincipalID:       "user_developer",
		PlatformProjectID: domain.PlatformProjectID,
	}, scope)

	self, err := requireSelf(ctx, api.OptProjectID{})
	require.NoError(t, err)
	assert.Equal(t, "user_developer", self.UserID())
}

// Operations no session may call assume a project secret's home is its
// target; a user bearer is refused there rather than acting on the platform.
func TestUserBearerOnlyWhereASessionMayAct(t *testing.T) {
	_, err := userBearerHandler(fakeBearers{}).HandleOAuth2(t.Context(), api.BuildReleaseOperation, api.OAuth2{Token: testBearer})
	assert.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
}

func TestUserBearerRefusals(t *testing.T) {
	t.Run("a token the server refuses is a 401", func(t *testing.T) {
		_, err := userBearerHandler(fakeBearers{}).HandleOAuth2(t.Context(), api.GetMyUserOperation, api.OAuth2{Token: "other.jwt.token"})
		assert.ErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})
	t.Run("a key store failure stays a server fault", func(t *testing.T) {
		fault := domain.ErrUnavailable().WithParent(errors.New("key store down"))
		_, err := userBearerHandler(fakeBearers{err: fault}).HandleOAuth2(t.Context(), api.GetMyUserOperation, api.OAuth2{Token: testBearer})
		assert.ErrorIs(t, err, domain.ErrUnavailable())
		assert.NotErrorIs(t, err, ogenerrors.ErrSecurityRequirementIsNotSatisfied)
	})
	t.Run("a project held by project_id must be the token's", func(t *testing.T) {
		ctx, err := userBearerHandler(fakeBearers{}).HandleOAuth2(t.Context(), api.GetMyUserOperation, api.OAuth2{Token: testBearer})
		require.NoError(t, err)
		_, err = requireSelf(ctx, api.NewOptProjectID(api.ProjectID("proj_other")))
		assert.ErrorIs(t, err, domain.ErrSessionProjectMismatch())
	})
}
