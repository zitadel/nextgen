package domain_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/secrets"
)

func webClient(redirectURIs ...string) domain.ApplicationClientDocument {
	return domain.ApplicationClientDocument{
		Slug:         "web",
		Type:         "confidential",
		GrantTypes:   []string{"authorization_code"},
		RedirectURIs: redirectURIs,
	}
}

func spaClient(redirectURIs []string, origins ...string) domain.ApplicationClientDocument {
	return domain.ApplicationClientDocument{
		Slug:           "spa",
		Type:           "public",
		GrantTypes:     []string{"authorization_code", "refresh_token"},
		RedirectURIs:   redirectURIs,
		AllowedOrigins: origins,
	}
}

func nativeClient(redirectURIs ...string) domain.ApplicationClientDocument {
	return domain.ApplicationClientDocument{
		Slug:         "native",
		Type:         "public",
		GrantTypes:   []string{"authorization_code", "refresh_token"},
		RedirectURIs: redirectURIs,
	}
}

func TestValidateRegisteredApplication(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		clients []domain.ApplicationClientDocument
		wantErr error
		want    map[string]string
	}{
		{
			name:    "https and loopback http pass",
			clients: []domain.ApplicationClientDocument{webClient("https://shop.example.com/callback", "http://localhost:3000/cb", "http://127.0.0.1:8080/cb", "http://[::1]/cb", "https://shop.example.com/cb?tenant=acme&next=%2Fdashboard")},
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
				{Slug: "web", Type: "confidential", GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{"http://shop.example.com/cb"}, ClientID: new("shared")},
				{Slug: "api", Type: "confidential", GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{"https://shop.example.com/cb"}, ClientID: new("shared")},
			},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want: map[string]string{
				"/clients/0/redirect_uris/0": "an http redirect URI must be on a loopback host",
				"/clients/1/client_id":       "another client of the application has this client_id",
			},
		},
		{
			name:    "a public spa client with origins passes",
			clients: []domain.ApplicationClientDocument{spaClient([]string{"http://localhost:5173/callback"}, "http://localhost:5173")},
		},
		{
			name:    "a native private-use redirect passes",
			clients: []domain.ApplicationClientDocument{nativeClient("com.acme.tunes:/callback", "http://127.0.0.1/callback")},
		},
		{
			name:    "a confidential client with a private-use redirect",
			clients: []domain.ApplicationClientDocument{webClient("com.acme.app:/callback")},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/redirect_uris/0": "a confidential client may not use a private-use redirect URI"},
		},
		{
			name: "a confidential client with allowed origins",
			clients: []domain.ApplicationClientDocument{
				{
					Slug: "web", Type: "confidential", GrantTypes: []string{"authorization_code"},
					RedirectURIs: []string{"https://shop.example.com/cb"}, AllowedOrigins: []string{"https://shop.example.com"},
				},
			},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/allowed_origins": "only a public client lists allowed origins"},
		},
		{
			name:    "an allowed origin with a path",
			clients: []domain.ApplicationClientDocument{spaClient([]string{"http://localhost:5173/callback"}, "http://localhost:5173/app")},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/allowed_origins/0": "an allowed origin must be scheme://host[:port] with no path"},
		},
		{
			name:    "an invalid redirect scheme",
			clients: []domain.ApplicationClientDocument{nativeClient("1bad:/callback")},
			wantErr: domain.ErrApplicationInvalid(nil, nil),
			want:    map[string]string{"/clients/0/redirect_uris/0": "a redirect URI scheme must be http, https, or a private-use scheme"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			err := domain.ValidateRegisteredApplication(domain.ApplicationDocument{Slug: "shop", Name: "Shop", Clients: tt.clients})
			if tt.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
			if tt.want != nil {
				var de domain.Error
				ok := errors.As(err, &de)
				require.True(t, ok)
				assert.Equal(t, tt.want, de.Details)
			}
		})
	}
}

func TestValidateRegisteredApplicationRefusesASecretVariable(t *testing.T) {
	t.Parallel()

	client := webClient("https://shop.example.com/cb")
	client.Secret = new("${{ SHOP_WEB_SECRET }}")
	err := domain.ValidateRegisteredApplication(domain.ApplicationDocument{Slug: "shop", Name: "Shop", Clients: []domain.ApplicationClientDocument{client}})
	require.ErrorIs(t, err, domain.ErrApplicationInvalid(nil, nil))
	var de domain.Error
	require.True(t, errors.As(err, &de))
	assert.Equal(t, map[string]string{
		"/clients/0/secret": "only a client declared in a release names its secret; the server generates a registered client's secret",
	}, de.Details)
}

func TestValidateDeclaredApplication(t *testing.T) {
	t.Parallel()

	declared := func(clientID, secret *string) domain.ApplicationClientDocument {
		client := webClient("https://shop.example.com/cb")
		client.Type = "confidential"
		client.ClientID, client.Secret = clientID, secret
		return client
	}
	withoutRedirect := declared(new("shop-web"), new("${{ SHOP_WEB_SECRET }}"))
	withoutRedirect.RedirectURIs = nil
	tests := []struct {
		name   string
		client domain.ApplicationClientDocument
		want   map[string]string
	}{
		{
			name:   "a client with its client_id and secret variable passes",
			client: declared(new("shop-web"), new("${{ SHOP_WEB_SECRET }}")),
		},
		{
			name:   "a client without its client_id or secret variable",
			client: declared(nil, nil),
			want: map[string]string{
				"/clients/0/client_id": "a client declared in a release sets its client_id",
				"/clients/0/secret":    "a confidential client declared in a release names the variable holding its secret",
			},
		},
		{
			name:   "the rules both writers share still hold",
			client: withoutRedirect,
			want:   map[string]string{"/clients/0/redirect_uris": "authorization_code requires at least one redirect URI"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			err := domain.ValidateDeclaredApplication(domain.ApplicationDocument{Slug: "shop", Name: "Shop", Clients: []domain.ApplicationClientDocument{tt.client}})
			if tt.want == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, domain.ErrApplicationInvalid(nil, nil))
			var de domain.Error
			require.True(t, errors.As(err, &de))
			assert.Equal(t, tt.want, de.Details)
		})
	}
}

func TestReviseRegisteredApplication(t *testing.T) {
	t.Parallel()

	current := domain.ApplicationDocument{Clients: []domain.ApplicationClientDocument{
		{Slug: "web", ClientID: new("client_01KWH3B")},
	}}

	tests := []struct {
		name        string
		current     domain.ApplicationDocument
		document    []domain.ApplicationClientDocument
		want        []string
		wantErr     error
		wantDetails any
	}{
		{
			name:     "every client of an application without clients is new",
			document: []domain.ApplicationClientDocument{{Slug: "web"}, {Slug: "api", ClientID: new("289374592837459283@shop")}},
			want:     []string{"web", "api"},
		},
		{
			name:     "a current client may leave its id out",
			current:  current,
			document: []domain.ApplicationClientDocument{{Slug: "web"}},
		},
		{
			name:     "a current client keeps a reserved prefix",
			current:  current,
			document: []domain.ApplicationClientDocument{{Slug: "web", ClientID: new("client_01KWH3B")}, {Slug: "api"}},
			want:     []string{"api"},
		},
		{
			name:        "a changed client_id",
			current:     current,
			document:    []domain.ApplicationClientDocument{{Slug: "web", ClientID: new("other")}},
			wantErr:     domain.ErrApplicationFieldImmutable(nil),
			wantDetails: map[string][]string{"fields": {"/clients/0/client_id"}},
		},
		{
			name:        "an omitted client",
			current:     current,
			document:    []domain.ApplicationClientDocument{{Slug: "api"}},
			wantErr:     domain.ErrApplicationFieldImmutable(nil),
			wantDetails: map[string][]string{"fields": {"/clients/web"}},
		},
		{
			name: "every omitted client and changed client_id",
			current: domain.ApplicationDocument{Clients: []domain.ApplicationClientDocument{
				{Slug: "web", ClientID: new("client_01KWH3B")},
				{Slug: "api", ClientID: new("client_01KWH3C")},
				{Slug: "cli", ClientID: new("client_01KWH3D")},
			}},
			document:    []domain.ApplicationClientDocument{{Slug: "cli", ClientID: new("other")}},
			wantErr:     domain.ErrApplicationFieldImmutable(nil),
			wantDetails: map[string][]string{"fields": {"/clients/web", "/clients/api", "/clients/0/client_id"}},
		},
		{
			name:     "every new client with a reserved prefix",
			document: []domain.ApplicationClientDocument{{Slug: "web", ClientID: new("client_mine")}, {Slug: "api"}, {Slug: "cli", ClientID: new("dcr_mine")}},
			wantErr:  domain.ErrApplicationInvalid(nil, nil),
			wantDetails: map[string]string{
				"/clients/0/client_id": "a supplied client_id may not start with client_ or dcr_",
				"/clients/2/client_id": "a supplied client_id may not start with client_ or dcr_",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			current, err := json.Marshal(tt.current)
			require.NoError(t, err)
			old := &domain.Application{ProjectID: "prj", ID: "app", Slug: "shop", Document: current}
			_, added, _, err := domain.ReviseRegisteredApplication(old, domain.ApplicationDocument{Clients: tt.document}, []byte("{}"), secrets.NewRandomSecretGenerator())
			if tt.wantErr == nil {
				require.NoError(t, err)
				var got []string
				for _, client := range added {
					got = append(got, client.Slug)
				}
				assert.Equal(t, tt.want, got)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
			var de domain.Error
			ok := errors.As(err, &de)
			require.True(t, ok)
			assert.Equal(t, tt.wantDetails, de.Details)
		})
	}
}

// A release checks clients against every client the application ever
// stored: it may drop one and declare it again, never under another
// client_id.
func TestReviseDeclaredApplication(t *testing.T) {
	t.Parallel()

	declared := &domain.Application{ProjectID: "prj", ID: "app", Slug: "shop", IsDeclared: true}
	stored := []*domain.ApplicationClient{
		{Slug: "web", ClientID: "shop-web"},
		{Slug: "api", ClientID: "shop-api"},
	}
	declaredClient := func(slug, clientID string) domain.ApplicationClientDocument {
		return domain.ApplicationClientDocument{
			Slug: slug, ClientID: new(clientID), Type: "confidential",
			GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{"https://shop.example.com/cb"},
			Secret: new("${{ " + strings.ToUpper(strings.ReplaceAll(slug, "-", "_")) + "_SECRET }}"),
		}
	}

	tests := []struct {
		name        string
		old         *domain.Application
		document    []domain.ApplicationClientDocument
		want        []*domain.ApplicationClient
		wantErr     error
		wantDetails any
	}{
		{
			name:     "a dropped client is not an error",
			old:      declared,
			document: []domain.ApplicationClientDocument{declaredClient("web", "shop-web")},
			want:     []*domain.ApplicationClient{},
		},
		{
			name:     "a client declared again under its client_id is not created again",
			old:      declared,
			document: []domain.ApplicationClientDocument{declaredClient("api", "shop-api"), declaredClient("cli", "shop-cli")},
			want:     []*domain.ApplicationClient{{ProjectID: "prj", Slug: "cli", ClientID: "shop-cli"}},
		},
		{
			name:        "a client declared again under another client_id",
			old:         declared,
			document:    []domain.ApplicationClientDocument{declaredClient("api", "shop-api-2")},
			wantErr:     domain.ErrApplicationFieldImmutable(nil),
			wantDetails: map[string][]string{"fields": {"/clients/0/client_id"}},
		},
		{
			name:        "the location is the client's index in the new document",
			old:         declared,
			document:    []domain.ApplicationClientDocument{declaredClient("web", "shop-web"), declaredClient("api", "shop-api-2")},
			wantErr:     domain.ErrApplicationFieldImmutable(nil),
			wantDetails: map[string][]string{"fields": {"/clients/1/client_id"}},
		},
		{
			name:     "a new client with a reserved prefix",
			old:      declared,
			document: []domain.ApplicationClientDocument{declaredClient("cli", "client_mine")},
			wantErr:  domain.ErrApplicationInvalid(nil, nil),
			wantDetails: map[string]string{
				"/clients/0/client_id": "a supplied client_id may not start with client_ or dcr_",
			},
		},
		{
			name:     "a registered application",
			old:      &domain.Application{ProjectID: "prj", ID: "app", Slug: "shop"},
			document: []domain.ApplicationClientDocument{declaredClient("web", "shop-web")},
			wantErr:  domain.ErrApplicationRegistered(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			revised, got, err := tt.old.ReviseDeclaredApplication(stored, domain.ApplicationDocument{Slug: "shop", Name: "Shop", Clients: tt.document}, []byte("{}"))
			if tt.wantErr == nil {
				require.NoError(t, err)
				assert.Equal(t, tt.want, got)
				assert.Equal(t, &domain.Application{ProjectID: "prj", ID: "app", Slug: "shop", IsDeclared: true, Document: []byte("{}")}, revised)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
			if tt.wantDetails == nil {
				return
			}
			var de domain.Error
			require.True(t, errors.As(err, &de))
			assert.Equal(t, tt.wantDetails, de.Details)
		})
	}
}

// A client that leaves first_party out takes its writer's default; one that
// sets it keeps it. Fields the server does not model stay as written.
func TestFillFirstPartyDefaults(t *testing.T) {
	t.Parallel()
	document := []byte(`{"slug":"shop","x-note":12345678901234567890,"clients":[` +
		`{"slug":"web"},{"slug":"api","first_party":true},{"slug":"cli","first_party":false}]}`)
	tests := []struct {
		name     string
		declared bool
		want     string
	}{
		{
			name:     "declared",
			declared: true,
			want: `{"slug":"shop","x-note":12345678901234567890,"clients":[` +
				`{"slug":"web","first_party":true},{"slug":"api","first_party":true},{"slug":"cli","first_party":false}]}`,
		},
		{
			name: "registered",
			want: `{"slug":"shop","x-note":12345678901234567890,"clients":[` +
				`{"slug":"web","first_party":false},{"slug":"api","first_party":true},{"slug":"cli","first_party":false}]}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := domain.FillFirstPartyDefaults(document, tt.declared)
			require.NoError(t, err)
			assert.JSONEq(t, tt.want, string(got))
		})
	}
}
