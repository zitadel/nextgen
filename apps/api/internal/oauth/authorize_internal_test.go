package oauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// newPlainServer is a server that can answer an authorization request up to
// its redirect: no keys, sessions or users are reached before it.
func newPlainServer(t *testing.T) *Server {
	t.Helper()
	s, err := New(Deps{
		Config:      Config{Enabled: true},
		PublicBase:  "https://zitadel.example.com",
		ConsolePath: "/ui/console",
		ProjectID:   domain.PlatformProjectID,
	})
	require.NoError(t, err)
	return s
}

// authorizeRaw calls authorize with a query exactly as a browser sends it.
func authorizeRaw(t *testing.T, s *Server, rawQuery string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/oauth/proj_platform/authorize?"+rawQuery, nil)
	w := httptest.NewRecorder()
	s.authorize(w, r)
	return w
}

// The request decodes redirect_uri once; nothing decodes it again. v4's
// payload, encoded twice on the wire, reaches the matcher as
// http://127.0.0.1%2Fcallback%23@attacker.example/, which a browser reads as
// attacker.example, and is refused without a redirect.
func TestAuthorizeDecodesTheRedirectURIOnce(t *testing.T) {
	for name, rawQuery := range map[string]string{
		"encoded twice, as v4's report sent it":     "client_id=cli&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%252Fcallback%2523%40attacker.example%2F",
		"encoded once, so it decodes to a fragment": "client_id=cli&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback%23%40attacker.example%2F",
	} {
		t.Run(name, func(t *testing.T) {
			w := authorizeRaw(t, newPlainServer(t), rawQuery)

			assert.Equal(t, http.StatusBadRequest, w.Code)
			assert.Empty(t, w.Header().Get("Location"), "a redirect URI that did not check out is never redirected to")
		})
	}
}

// The browser is sent to the URL the matcher checked: the same scheme, host,
// port and path, with only the response's parameters added.
func TestAuthorizeRedirectsToTheCheckedURI(t *testing.T) {
	w := authorizeRaw(t, newPlainServer(t),
		"client_id=cli&response_type=token&state=s1&redirect_uri="+url.QueryEscape("http://127.0.0.1:53142/callback"))

	require.Equal(t, http.StatusSeeOther, w.Code)
	location, err := url.Parse(w.Header().Get("Location"))
	require.NoError(t, err)
	assert.Equal(t, "http", location.Scheme)
	assert.Equal(t, "127.0.0.1:53142", location.Host)
	assert.Equal(t, "/callback", location.EscapedPath())
	assert.Nil(t, location.User)
	assert.Empty(t, location.Fragment)
	assert.Equal(t, url.Values{
		"error":             {errUnsupportedResponseType},
		"error_description": {"Only response_type=code is supported."},
		"state":             {"s1"},
		"iss":               {"https://zitadel.example.com"},
	}, location.Query())
}

// A registered client's redirect URI is whatever its registration said, so a
// failure goes there only once the user has seen the app: before that, the
// error page answers (RFC 9700 §4.11.2). A loopback URI is the user's own
// machine, and gets the failure as before.
func TestAuthorizeSendsNoFailureUnaskedToARegisteredClient(t *testing.T) {
	redirects := []string{"https://app.example/callback", "http://127.0.0.1/callback"}
	var documentURL string
	documents := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"client_id":     documentURL,
			"client_name":   "Agent",
			"redirect_uris": redirects,
		})
	}))
	t.Cleanup(documents.Close)
	documentURL = documents.URL + "/metadata.json"
	s, err := New(Deps{
		Config:     Config{Enabled: true, ClientIDMetadataDocuments: true},
		PublicBase: "https://zitadel.example.com",
		ProjectID:  domain.PlatformProjectID,
		Fetch:      documents.Client(),
	})
	require.NoError(t, err)

	for redirect, redirected := range map[string]bool{redirects[0]: false, redirects[1]: true} {
		t.Run(redirect, func(t *testing.T) {
			w := authorizeRaw(t, s, url.Values{
				"client_id":     {documentURL},
				"response_type": {"token"},
				"redirect_uri":  {redirect},
			}.Encode())

			if !redirected {
				assert.Equal(t, http.StatusBadRequest, w.Code)
				assert.Empty(t, w.Header().Get("Location"))
				return
			}
			assert.Equal(t, http.StatusSeeOther, w.Code)
			assert.True(t, strings.HasPrefix(w.Header().Get("Location"), redirect+"?"), w.Header().Get("Location"))
		})
	}
}
