package api

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/mocks"
)

// A step-up sign-in inherits the named session's verified factors, so naming a
// session is not enough: the request must carry that session's token.
func TestProvenSessionID(t *testing.T) {
	const (
		project = "proj_a"
		session = "sess_a"
		raw     = "session-token"
	)
	sessionToken := func(projectID, sessionID string) *domain.Token {
		return &domain.Token{Type: domain.TokenTypeSessionToken, ProjectID: projectID, SessionID: new(sessionID)}
	}
	refused := domain.ErrRequestInvalid()

	tests := []struct {
		name         string
		sessionID    string
		sessionToken string
		introspected *domain.Token
		introspectEr error
		want         *string
		wantErr      error
	}{
		{name: "neither: a new session", want: nil},
		{name: "id without token is refused", sessionID: session, wantErr: refused},
		{name: "token alone names its session", sessionToken: raw, introspected: sessionToken(project, session), want: new(session)},
		{name: "matching id and token", sessionID: session, sessionToken: raw, introspected: sessionToken(project, session), want: new(session)},
		{name: "token of another session is refused", sessionID: session, sessionToken: raw, introspected: sessionToken(project, "sess_b"), wantErr: refused},
		{name: "token of another project is refused", sessionID: session, sessionToken: raw, introspected: sessionToken("proj_b", session), wantErr: refused},
		{name: "a token that is not a session token is refused", sessionID: session, sessionToken: raw, introspected: &domain.Token{Type: domain.TokenTypeProjectPreview, ProjectID: project}, wantErr: refused},
		{name: "an invalid token is refused", sessionID: session, sessionToken: raw, introspectEr: domain.ErrInvalidToken(), wantErr: refused},
		{name: "a revoked token is refused", sessionID: session, sessionToken: raw, introspectEr: domain.ErrTokenRevoked(), wantErr: refused},
		{name: "a token store failure is a server fault, not a refusal", sessionID: session, sessionToken: raw, introspectEr: domain.ErrInternal(nil), wantErr: domain.ErrInternal(nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			tokens := mocks.NewMockTokenService(ctrl)
			if tt.sessionToken != "" {
				tokens.EXPECT().IntrospectToken(gomock.Any(), tt.sessionToken).Return(tt.introspected, tt.introspectEr)
			}
			h := Handler{tokenService: tokens}

			got, err := h.provenSessionID(t.Context(), project, tt.sessionID, tt.sessionToken, domain.ErrRequestInvalid)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
