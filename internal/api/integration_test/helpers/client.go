package helpers

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
)

func (h *Harness) EnsureAPIClient(t *testing.T) *api.Client {
	t.Helper()
	if h.APIClient == nil {
		serv := h.EnsureTestServer(t)
		client, err := api.NewClient(
			serv.URL,
			h.EnsureFakeSecuritySource(t),
		)
		require.NoError(t, err)
		h.APIClient = client
	}
	return h.APIClient
}

func (h *Harness) EnsureFakeSecuritySource(t *testing.T) *FakeSecuritySource {
	t.Helper()
	if h.FakeSecuritySource == nil {
		h.FakeSecuritySource = &FakeSecuritySource{}
	}
	return h.FakeSecuritySource
}

type FakeSecuritySource struct {
}

func (f FakeSecuritySource) OAuth2(ctx context.Context, operationName api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{
		Token:  "this_is_a_fake_token__once_we_have_proper_auth__replace_this_with_a_proper_one",
		Scopes: []string{"all"},
	}, nil
}

func (f FakeSecuritySource) UsernamePassword(ctx context.Context, operationName api.OperationName) (api.UsernamePassword, error) {
	return api.UsernamePassword{
		Username: "TEST_USER",
		Password: "TEST_PASSWORD",
		Roles:    []string{"all"},
	}, nil
}

var _ api.SecuritySource = (*FakeSecuritySource)(nil)
