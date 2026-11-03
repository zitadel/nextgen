package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
	"gopkg.in/yaml.v3"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
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

// Both bearer schemes read the same Authorization header, and ogen runs every
// one an operation lists: each skips the other's tokens, so neither fails a
// request the other carries.
func TestTheBearerSchemesSkipEachOthersTokens(t *testing.T) {
	handler := userBearerHandler(fakeBearers{})

	_, err := handler.HandlePat(t.Context(), api.ListDeploymentsOperation, api.Pat{Token: testBearer})
	assert.ErrorIs(t, err, ogenerrors.ErrSkipServerSecurity, "a person's token is oauth2's")

	_, err = handler.HandleOAuth2(t.Context(), api.ListDeploymentsOperation, api.OAuth2{Token: "a.five.part.secret.jwe"})
	assert.ErrorIs(t, err, ogenerrors.ErrSkipServerSecurity, "a secret is pat's")

	_, err = NewSecurityHandler(nil).HandleOAuth2(t.Context(), api.ListDeploymentsOperation, api.OAuth2{Token: testBearer})
	assert.ErrorIs(t, err, ogenerrors.ErrSkipServerSecurity, "without an authorization server, a cookie may still carry the request")
}

// The app plane's handlers take their target from a secret's home (auth
// attempts, handoffs, sessions) or prove a secret (the claim), so a person's
// token is no credential there. Every other operation a secret may call, a
// person with the grants may call too: the CLI acts as the developer
// everywhere else.
func TestOnlyTheAppPlaneRefusesAPersonsToken(t *testing.T) {
	t.Parallel()
	appPlane := map[string]bool{
		"createAuthAttempt": true, "getAuthAttempt": true, "issueChallenge": true,
		"verifyChallengeProof": true, "createHandoff": true, "createSession": true,
		"exchangeHandoff": true, "initClaim": true, "getClaimStatus": true,
		"beginUserPasskeyRegistration": true, "finishUserPasskeyRegistration": true,
	}
	const openapiDir = "../../api/openapi"
	var spec struct {
		Paths map[string]struct {
			Ref string `yaml:"$ref"`
		} `yaml:"paths"`
	}
	raw, err := os.ReadFile(filepath.Join(openapiDir, "openapi-spec.yaml"))
	require.NoError(t, err)
	require.NoError(t, yaml.Unmarshal(raw, &spec))

	seen := map[string]bool{}
	for _, item := range spec.Paths {
		if item.Ref == "" {
			continue
		}
		var methods map[string]struct {
			OperationID string                `yaml:"operationId"`
			Security    []map[string][]string `yaml:"security"`
		}
		raw, err := os.ReadFile(filepath.Join(openapiDir, item.Ref))
		require.NoError(t, err)
		require.NoError(t, yaml.Unmarshal(raw, &methods), item.Ref)
		for _, op := range methods {
			var pat, person bool
			for _, requirement := range op.Security {
				_, isPat := requirement["pat"]
				_, isPerson := requirement["oauth2"]
				pat, person = pat || isPat, person || isPerson
			}
			if !pat {
				continue
			}
			seen[op.OperationID] = true
			assert.Equal(t, !appPlane[op.OperationID], person, "%s: a person's token (oauth2) belongs everywhere a secret goes but the app plane", op.OperationID)
		}
	}
	for op := range appPlane {
		assert.True(t, seen[op], "%s is no longer a secret's operation: update the app plane", op)
	}
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

// Through the real router, where ogen runs every bearer scheme an operation
// lists against the one Authorization header: a person's token reaches an
// operator operation and is refused on the app plane, and the project secret
// reaches both. The handler is unimplemented, so a request that passed
// security fails there instead, with anything but a 401.
func TestBearerSchemesThroughTheRouter(t *testing.T) {
	const secret = "a.five.part.secret.jwe"
	tokens := servicemocks.NewMockTokenService(gomock.NewController(t))
	tokens.EXPECT().IntrospectToken(gomock.Any(), secret).Return(&domain.Token{
		ProjectID: "proj_1",
		Type:      domain.TokenTypeProjectToken,
		Scope:     []string{"project.write", "project.read"},
	}, nil).AnyTimes()
	security := NewSecurityHandler(tokens).WithPlatformProject(domain.PlatformProjectID).WithUserBearers(fakeBearers{})
	server, err := api.NewServer(api.UnimplementedHandler{}, security, api.WithErrorHandler(OgenErrorHandler))
	require.NoError(t, err)

	for _, tc := range []struct {
		name, path, token string
		passes            bool
	}{
		{"a person's token on an operator operation", "/deployments?project_id=proj_1", testBearer, true},
		{"a person's token on the app plane", "/auth_attempts/att_1", testBearer, false},
		{"the secret on an operator operation", "/deployments?project_id=proj_1", secret, true},
		{"the secret on the app plane", "/auth_attempts/att_1", secret, true},
		{"a token neither scheme knows", "/deployments?project_id=proj_1", "other.jwt.token", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			req.Header.Set("Authorization", "Bearer "+tc.token)
			rec := httptest.NewRecorder()
			server.ServeHTTP(rec, req)
			if tc.passes {
				assert.NotEqual(t, http.StatusUnauthorized, rec.Code, rec.Body.String())
			} else {
				assert.Equal(t, http.StatusUnauthorized, rec.Code, rec.Body.String())
			}
		})
	}
}
