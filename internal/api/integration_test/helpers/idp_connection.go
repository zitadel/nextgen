package helpers

import (
	"testing"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureIDPConnectionService(t *testing.T) service.IDPConnectionService {
	t.Helper()
	h.idpConnectionService.mutex.Lock()
	defer h.idpConnectionService.mutex.Unlock()

	if h.idpConnectionService.value == nil {
		h.idpConnectionService.value = service.NewIDPConnectionService(
			h.EnsureServiceDB(t),
			h.EnsureSchemaValidator(t),
		)
	}
	return h.idpConnectionService.value
}

// OIDCConnection is a minimal valid OIDC connection document. Tests change the
// fields they are about on the returned value.
func OIDCConnection(slug string) api.IdpConnection {
	return api.IdpConnection{
		Slug:        slug,
		Protocol:    api.IdpProtocolOidc,
		DisplayName: "Google",
		Oidc: api.NewOptIdpConnectionOidc(api.IdpConnectionOidc{
			Issuer:       "https://accounts.google.com",
			ClientID:     "google-client",
			ClientSecret: "${{ GOOGLE_CLIENT_SECRET }}",
			Scopes:       []string{"openid"},
		}),
	}
}
