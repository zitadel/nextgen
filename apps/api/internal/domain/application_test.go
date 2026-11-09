package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func webClient(redirectURIs ...string) domain.ApplicationClientDocument {
	return domain.ApplicationClientDocument{
		Slug:         "web",
		GrantTypes:   []string{"authorization_code"},
		RedirectURIs: redirectURIs,
	}
}

func TestValidateApplicationDocument(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		clients []domain.ApplicationClientDocument
		wantErr error
		want    map[string]string
	}{
		{
			name:    "https and loopback http pass",
			clients: []domain.ApplicationClientDocument{webClient("https://shop.example.com/callback", "http://localhost:3000/cb", "http://127.0.0.1:8080/cb", "http://[::1]/cb")},
		},
		{
			name: "refresh_token with authorization_code passes",
			clients: []domain.ApplicationClientDocument{
				{Slug: "web", GrantTypes: []string{"authorization_code", "refresh_token"}, RedirectURIs: []string{"https://shop.example.com/cb"}},
			},
		},
		{
			name: "refresh_token without a grant that issues one",
			clients: []domain.ApplicationClientDocument{
				{Slug: "worker", GrantTypes: []string{"refresh_token"}},
			},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/grant_types": "refresh_token requires a grant that issues refresh tokens"},
		},
		{
			name:    "authorization_code without redirect URIs",
			clients: []domain.ApplicationClientDocument{webClient()},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/redirect_uris": "authorization_code requires at least one redirect URI"},
		},
		{
			name:    "http on a public host",
			clients: []domain.ApplicationClientDocument{webClient("https://ok.example.com/cb", "http://shop.example.com/cb")},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/redirect_uris/1": "an http redirect URI must be on a loopback host"},
		},
		{
			name:    "a fragment",
			clients: []domain.ApplicationClientDocument{webClient("https://shop.example.com/cb#x")},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/redirect_uris/0": "a redirect URI may not have a fragment"},
		},
		{
			name:    "an uppercase host",
			clients: []domain.ApplicationClientDocument{webClient("https://Shop.example.com/cb")},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/redirect_uris/0": "the redirect URI is not in its canonical form"},
		},
		{
			name:    "an uppercase scheme",
			clients: []domain.ApplicationClientDocument{webClient("HTTPS://shop.example.com/cb")},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/redirect_uris/0": "the redirect URI is not in its canonical form"},
		},
		{
			name: "a duplicate client slug",
			clients: []domain.ApplicationClientDocument{
				webClient("https://shop.example.com/cb"),
				webClient("https://shop.example.com/cb"),
			},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/1/slug": "another client of the application has this slug"},
		},
		{
			name: "a client_id supplied twice",
			clients: []domain.ApplicationClientDocument{
				{Slug: "web", GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{"https://shop.example.com/cb"}, ClientID: new("shared")},
				{Slug: "api", GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{"https://shop.example.com/cb"}, ClientID: new("shared")},
			},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/1/client_id": "another client of the application has this client_id"},
		},
		{
			name: "a client_id supplied twice and a bad redirect URI",
			clients: []domain.ApplicationClientDocument{
				{Slug: "web", GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{"http://shop.example.com/cb"}, ClientID: new("shared")},
				{Slug: "api", GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{"https://shop.example.com/cb"}, ClientID: new("shared")},
			},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want: map[string]string{
				"/clients/0/redirect_uris/0": "an http redirect URI must be on a loopback host",
				"/clients/1/client_id":       "another client of the application has this client_id",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			err := domain.ValidateApplicationDocument(domain.ApplicationDocument{Slug: "shop", Name: "Shop", Clients: tt.clients})
			if tt.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
			if tt.want != nil {
				de, ok := err.(domain.Error)
				require.True(t, ok)
				assert.Equal(t, tt.want, de.Details)
			}
		})
	}
}

func TestApplicationRevisionNewClients(t *testing.T) {
	t.Parallel()

	stored := domain.ApplicationDocument{Clients: []domain.ApplicationClientDocument{
		{Slug: "web", ClientID: new("client_01KWH3B")},
	}}

	tests := []struct {
		name        string
		stored      domain.ApplicationDocument
		next        []domain.ApplicationClientDocument
		want        []string
		wantErr     error
		wantDetails any
	}{
		{
			name: "on create every client is new",
			next: []domain.ApplicationClientDocument{{Slug: "web"}, {Slug: "api", ClientID: new("289374592837459283@shop")}},
			want: []string{"web", "api"},
		},
		{
			name:   "a stored client may leave its id out",
			stored: stored,
			next:   []domain.ApplicationClientDocument{{Slug: "web"}},
		},
		{
			name:   "a stored client keeps a reserved prefix",
			stored: stored,
			next:   []domain.ApplicationClientDocument{{Slug: "web", ClientID: new("client_01KWH3B")}, {Slug: "api"}},
			want:   []string{"api"},
		},
		{
			name:        "a changed client_id",
			stored:      stored,
			next:        []domain.ApplicationClientDocument{{Slug: "web", ClientID: new("other")}},
			wantErr:     domain.ErrApplicationFieldImmutable(nil),
			wantDetails: map[string]any{"field": "/clients/0/client_id"},
		},
		{
			name:        "an omitted client",
			stored:      stored,
			next:        []domain.ApplicationClientDocument{{Slug: "api"}},
			wantErr:     domain.ErrApplicationFieldImmutable(nil),
			wantDetails: map[string]any{"field": "/clients/web"},
		},
		{
			name:        "a new client with the client_ prefix",
			next:        []domain.ApplicationClientDocument{{Slug: "web", ClientID: new("client_mine")}},
			wantErr:     domain.ErrApplicationInvalid(nil, nil),
			wantDetails: map[string]string{"/clients/0/client_id": "a supplied client_id may not start with client_ or dcr_"},
		},
		{
			name:        "a new client with the dcr_ prefix",
			next:        []domain.ApplicationClientDocument{{Slug: "web", ClientID: new("dcr_mine")}},
			wantErr:     domain.ErrApplicationInvalid(nil, nil),
			wantDetails: map[string]string{"/clients/0/client_id": "a supplied client_id may not start with client_ or dcr_"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := domain.ApplicationRevisionNewClients(tt.stored, domain.ApplicationDocument{Clients: tt.next})
			if tt.wantErr == nil {
				require.NoError(t, err)
				assert.Equal(t, tt.want, got)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
			de, ok := err.(domain.Error)
			require.True(t, ok)
			assert.Equal(t, tt.wantDetails, de.Details)
		})
	}
}
