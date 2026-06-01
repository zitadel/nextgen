package helpers

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
)

func (h *Harness) EnsureAPIClient(t *testing.T, projectID string) *api.Client {
	t.Helper()
	serv := h.EnsureTestServer(t)
	if h.apiClients == nil {
		h.apiClients = make(map[string]*api.Client)
	}
	if client, ok := h.apiClients[projectID]; ok {
		return client
	}
	client, err := api.NewClient(
		serv.URL,
		h.EnsureFakeSecuritySource(t, projectID),
	)
	require.NoError(t, err)
	h.apiClients[projectID] = client
	return h.apiClients[projectID]
}

func (h *Harness) EnsureFakeSecuritySource(t *testing.T, projectID string) *FakeSecuritySource {
	t.Helper()
	if h.fakeSecuritySources == nil {
		h.fakeSecuritySources = make(map[string]*FakeSecuritySource)
	}
	if source, ok := h.fakeSecuritySources[projectID]; ok {
		return source
	}
	h.fakeSecuritySources[projectID] = &FakeSecuritySource{
		projectID: projectID,
	}
	return h.fakeSecuritySources[projectID]
}

type FakeSecuritySource struct {
	projectID string
}

func (f FakeSecuritySource) OAuth2(ctx context.Context, operationName api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{
		Token:  fmt.Sprintf("sk_%s", f.projectID),
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
