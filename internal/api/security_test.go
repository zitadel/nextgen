package api

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

type fakeTokenVerifier struct {
	payload *domain.Token
	err     error
}

func (f fakeTokenVerifier) Verify(string) (*domain.Token, error) {
	return f.payload, f.err
}

func TestHandleOAuth2(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		token         string
		verifier      domain.TokenVerifier
		wantErr       bool
		wantProjectID string
	}{
		{
			name:     "empty token is rejected",
			token:    "",
			verifier: fakeTokenVerifier{err: errors.New("not called")},
			wantErr:  true,
		},
		{
			name:          "real project token is verified cryptographically",
			token:         "opaque-project-secret",
			verifier:      fakeTokenVerifier{payload: &domain.Token{ProjectID: "proj_verified"}},
			wantProjectID: "proj_verified",
		},
		{
			name:          "sk_ project key identifies the project when verification fails",
			token:         "sk_proj_01ABC",
			verifier:      fakeTokenVerifier{err: errors.New("not a real token")},
			wantProjectID: "proj_01ABC",
		},
		{
			name:     "sk_ prefix without a project id is rejected",
			token:    "sk_not_a_project",
			verifier: fakeTokenVerifier{err: errors.New("not a real token")},
			wantErr:  true,
		},
		{
			name:     "unverifiable token without sk_ prefix is rejected",
			token:    "garbage",
			verifier: fakeTokenVerifier{err: errors.New("not a real token")},
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			handler := NewSecurityHandler(tt.verifier)

			ctx, err := handler.HandleOAuth2(context.Background(), "", api.OAuth2{Token: tt.token})
			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			scope, ok := GetScopeContext(ctx)
			require.True(t, ok)
			assert.Equal(t, tt.wantProjectID, scope.ProjectID)
		})
	}
}
