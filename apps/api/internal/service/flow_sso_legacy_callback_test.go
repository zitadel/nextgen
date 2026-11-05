package service_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

// peekAttempts answers PeekSSOState only; any other call panics on the nil
// embedded interface.
type peekAttempts struct {
	service.AuthAttemptService
	check     *domain.SSOCallbackCheck
	err       error
	project   string
	state     string
	peekCalls int
}

func (p *peekAttempts) PeekSSOState(_ context.Context, projectID, state string) (*domain.SSOCallbackCheck, error) {
	p.peekCalls++
	p.project, p.state = projectID, state
	return p.check, p.err
}

const v4CallbackURL = "https://auth.acme.com/ui/login/login/externalidp/callback"

func legacyPending() *domain.SSOStatePayload {
	pending := ssoCallbackPending()
	pending.RedirectURI = v4CallbackURL
	return pending
}

func TestFlowSSOCallback_ResolveLegacy(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		requestURL string
		state      string
		pending    *domain.SSOStatePayload
		peekErr    error
		want       service.FlowSSOLegacyCallbackOutput
		wantErr    error
		wantPeek   bool
	}{
		{
			name:       "the URL the sign-in sent is relayed to its origin",
			requestURL: v4CallbackURL,
			state:      ssoCallbackState,
			pending:    legacyPending(),
			want:       service.FlowSSOLegacyCallbackOutput{ConnectionSlug: ssoCallbackSlug, ReturnOrigin: "https://app.example.com"},
			wantPeek:   true,
		},
		{
			name:       "scheme and host compare case-insensitively",
			requestURL: "HTTPS://Auth.Acme.com/ui/login/login/externalidp/callback",
			state:      ssoCallbackState,
			pending:    legacyPending(),
			want:       service.FlowSSOLegacyCallbackOutput{ConnectionSlug: ssoCallbackSlug, ReturnOrigin: "https://app.example.com"},
			wantPeek:   true,
		},
		{
			// The connection did not keep a v4 URL: its authorize request sent
			// the origin's own route, so nothing may arrive here for it.
			name:       "a connection without redirect_uri is never relayed",
			requestURL: v4CallbackURL,
			state:      ssoCallbackState,
			pending:    ssoCallbackPending(),
			wantErr:    domain.ErrSSOStateInvalid(),
			wantPeek:   true,
		},
		{
			name:       "another host is refused",
			requestURL: "https://evil.example.com/ui/login/login/externalidp/callback",
			state:      ssoCallbackState,
			pending:    legacyPending(),
			wantErr:    domain.ErrSSOStateInvalid(),
			wantPeek:   true,
		},
		{
			name:       "the other v4 path is refused",
			requestURL: "https://auth.acme.com/idps/callback",
			state:      ssoCallbackState,
			pending:    legacyPending(),
			wantErr:    domain.ErrSSOStateInvalid(),
			wantPeek:   true,
		},
		{
			name:       "an unknown or expired state is refused",
			requestURL: v4CallbackURL,
			state:      ssoCallbackState,
			peekErr:    domain.ErrSSOStateInvalid(),
			wantErr:    domain.ErrSSOStateInvalid(),
			wantPeek:   true,
		},
		{
			// v4's own states are numeric ids: they name no project and are
			// refused before any read.
			name:       "a v4 state is refused without a read",
			requestURL: v4CallbackURL,
			state:      "301934576019234817",
			wantErr:    domain.ErrSSOStateInvalid(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			attempts := &peekAttempts{err: tt.peekErr}
			if tt.pending != nil {
				attempts.check = &domain.SSOCallbackCheck{Pending: tt.pending}
			}
			svc := service.NewFlowSSOCallback(servicemocks.NewMockIDPConnectionService(ctrl), attempts, servicemocks.NewMockKeyService(ctrl), servicemocks.NewMockVariableService(ctrl), &http.Client{Transport: tripwireTransport{t}})

			got, err := svc.ResolveLegacy(t.Context(), service.FlowSSOLegacyCallbackInput{RequestURL: tt.requestURL, State: tt.state})

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.want, got)
			}
			if tt.wantPeek {
				assert.Equal(t, 1, attempts.peekCalls)
				assert.Equal(t, "proj-1", attempts.project)
				assert.Equal(t, tt.state, attempts.state)
			} else {
				assert.Zero(t, attempts.peekCalls)
			}
		})
	}
}
