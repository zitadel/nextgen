package main

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"
)

const (
	redirectURI = "http://127.0.0.1:1/cb"
	nonce       = "test-nonce"
	verifier    = "test-code-verifier-0123456789-0123456789-0123456789"
)

// startMock serves the handler on a local port and returns the issuer, with
// the trailing slash the journey runner also uses.
func startMock(t *testing.T) string {
	t.Helper()
	srv := httptest.NewUnstartedServer(nil)
	issuer := "http://" + srv.Listener.Addr().String() + "/"
	handler, err := newHandler(config{
		Issuer:       issuer,
		RedirectURI:  redirectURI,
		ClientID:     "journey",
		ClientSecret: "journey-secret",
		UsersFile:    "users.json",
	})
	if err != nil {
		t.Fatal(err)
	}
	srv.Config.Handler = handler
	srv.Start()
	t.Cleanup(srv.Close)
	return issuer
}

// browser keeps cookies like a browser and stops at the client's redirect URI,
// where a relying party would take over.
func browser(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{
		Jar: jar,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			if strings.HasPrefix(req.URL.String(), redirectURI) {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
}

func newParty(t *testing.T, issuer string) rp.RelyingParty {
	t.Helper()
	party, err := rp.NewRelyingPartyOIDC(context.Background(), issuer, "journey", "journey-secret", redirectURI,
		[]string{oidc.ScopeOpenID, oidc.ScopeEmail},
		rp.WithVerifierOpts(rp.WithNonce(func(context.Context) string { return nonce })),
	)
	if err != nil {
		t.Fatal(err)
	}
	return party
}

// login opens the authorize URL, submits the login form and returns the
// final response.
func login(t *testing.T, issuer string, party rp.RelyingParty, username, password string) *http.Response {
	t.Helper()
	client := browser(t)
	authURL := rp.AuthURL("state", party,
		rp.AuthURLOpt(rp.WithURLParam("nonce", nonce)),
		rp.WithCodeChallenge(oidc.NewSHACodeChallenge(verifier)),
	)
	page, err := client.Get(authURL)
	if err != nil {
		t.Fatal(err)
	}
	page.Body.Close()
	if page.StatusCode != http.StatusOK || page.Request.URL.Path != "/login/username" {
		t.Fatalf("expected the login page, got %d at %s", page.StatusCode, page.Request.URL)
	}
	resp, err := client.PostForm(issuer+"login/username", url.Values{
		"id":       {page.Request.URL.Query().Get("authRequestID")},
		"username": {username},
		"password": {password},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestRoundTrip(t *testing.T) {
	issuer := startMock(t)
	for _, user := range []string{"rev1-user", "rev2-user"} {
		t.Run(user, func(t *testing.T) {
			ctx := context.Background()
			party := newParty(t, issuer)
			resp := login(t, issuer, party, user, "journey-pass")
			if resp.StatusCode != http.StatusFound {
				t.Fatalf("expected a redirect to the client, got %d", resp.StatusCode)
			}
			location, err := resp.Location()
			if err != nil {
				t.Fatal(err)
			}
			code := location.Query().Get("code")
			if code == "" {
				t.Fatalf("no code in %s", location)
			}

			tokens, err := rp.CodeExchange[*oidc.IDTokenClaims](ctx, code, party, rp.WithCodeVerifier(verifier))
			if err != nil {
				t.Fatal(err)
			}
			if tokens.IDTokenClaims.Nonce != nonce {
				t.Errorf("nonce = %q, want %q", tokens.IDTokenClaims.Nonce, nonce)
			}
			if tokens.IDTokenClaims.Subject != user {
				t.Errorf("sub = %q, want %q", tokens.IDTokenClaims.Subject, user)
			}

			info, err := rp.Userinfo[*oidc.UserInfo](ctx, tokens.AccessToken, tokens.TokenType, tokens.IDTokenClaims.Subject, party)
			if err != nil {
				t.Fatal(err)
			}
			if want := user + "@example.com"; info.Email != want {
				t.Errorf("email = %q, want %q", info.Email, want)
			}
			if !bool(info.EmailVerified) {
				t.Error("email_verified = false, want true")
			}
		})
	}
}
