package httputil_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/httputil"
)

func newClient(t *testing.T, cfg httputil.ClientConfig) *http.Client {
	t.Helper()
	client, err := cfg.NewClient()
	require.NoError(t, err)
	return client
}

func TestClientConfig_Validate(t *testing.T) {
	require.NoError(t, httputil.ClientConfig{DenyList: httputil.DefaultDenyList}.Validate())
	require.Error(t, httputil.ClientConfig{DenyList: []string{"10.0.0.0/99"}}.Validate())
	// Negative limits must not pass: max_body_size: -1 would silently
	// disable the response cap.
	require.Error(t, httputil.ClientConfig{MaxBodySize: -1}.Validate())
	require.Error(t, httputil.ClientConfig{Timeout: -time.Second}.Validate())
	require.Error(t, httputil.ClientConfig{MaxRedirects: -1}.Validate())
	_, err := httputil.ClientConfig{MaxBodySize: -1}.NewClient()
	require.Error(t, err, "NewClient must run the same validation")
}

func TestNewClient_LiteralIPBlockedBeforeDial(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// srv.URL carries a literal loopback IP, so the request-level precheck
	// already matches the CIDR before any dial.
	client := newClient(t, httputil.ClientConfig{DenyList: []string{"127.0.0.0/8", "::1/128"}})
	_, err := client.Get(srv.URL)
	var denied *httputil.AddressDeniedError
	require.ErrorAs(t, err, &denied)
}

func TestNewClient_ResolvedAddressBlockedAtDial(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	srvURL, err := url.Parse(srv.URL)
	require.NoError(t, err)

	// "localhost" passes the name-level precheck (the deny list holds only
	// CIDRs, and the precheck does not resolve), so the denial can only
	// come from the Control hook seeing the resolved loopback address at
	// connect time. This is the DNS-rebinding defense.
	client := newClient(t, httputil.ClientConfig{DenyList: []string{"127.0.0.0/8", "::1/128"}})
	_, err = client.Get("http://localhost:" + srvURL.Port() + "/")
	var denied *httputil.AddressDeniedError
	require.ErrorAs(t, err, &denied)
}

func TestNewClient_AllowListOverridesDenyAtDial(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	srvURL, err := url.Parse(srv.URL)
	require.NoError(t, err)

	client := newClient(t, httputil.ClientConfig{
		DenyList:  []string{"127.0.0.0/8", "::1/128"},
		AllowList: []string{srvURL.Hostname()},
	})
	resp, err := client.Get(srv.URL)
	require.NoError(t, err)
	resp.Body.Close()
}

func TestNewClient_DeniedHostnameBlockedBeforeAnyConnection(t *testing.T) {
	// No server exists for this name; a hostname deny entry must reject the
	// request at the transport, before DNS or dialing could even fail.
	client := newClient(t, httputil.ClientConfig{DenyList: []string{"blocked.test"}})
	_, err := client.Get("http://blocked.test/schema.json")
	var denied *httputil.AddressDeniedError
	require.ErrorAs(t, err, &denied)
}

func TestNewClient_EmptyDenyListAllowsEverything(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	resp, err := newClient(t, httputil.ClientConfig{}).Get(srv.URL)
	require.NoError(t, err)
	resp.Body.Close()
}

func TestNewClient_RedirectToDeniedAddressBlocked(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A literal-IP target so the redirect check needs no DNS.
		http.Redirect(w, r, "http://10.255.255.1/steal", http.StatusFound)
	}))
	defer srv.Close()

	client := newClient(t, httputil.ClientConfig{
		DenyList:     []string{"10.0.0.0/8"},
		MaxRedirects: 5,
	})
	_, err := client.Get(srv.URL)
	var denied *httputil.AddressDeniedError
	require.ErrorAs(t, err, &denied)
}

func TestNewClient_MaxRedirects(t *testing.T) {
	// /hop/0 -> /hop/1 -> /hop/2 -> 200: exactly two redirects on the way to
	// /hop/2, three to /hop/3.
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	defer srv.Close()
	mux.HandleFunc("/hop/", func(w http.ResponseWriter, r *http.Request) {
		var n int
		_, err := fmt.Sscanf(r.URL.Path, "/hop/%d", &n)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if n <= 0 {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Redirect(w, r, fmt.Sprintf("%s/hop/%d", srv.URL, n-1), http.StatusFound)
	})

	client := newClient(t, httputil.ClientConfig{
		DenyList:     []string{"10.0.0.0/8"}, // enforcing, but loopback stays allowed
		MaxRedirects: 2,
	})

	resp, err := client.Get(srv.URL + "/hop/2")
	require.NoError(t, err, "a chain of exactly max_redirects hops must pass")
	resp.Body.Close()

	_, err = client.Get(srv.URL + "/hop/3")
	require.ErrorIs(t, err, httputil.ErrTooManyRedirects)
}

func TestNewClient_HTTPSDowngrade(t *testing.T) {
	mustReq := func(rawURL string) *http.Request {
		u, err := url.Parse(rawURL)
		require.NoError(t, err)
		return &http.Request{URL: u}
	}
	via := []*http.Request{mustReq("https://example.test/start")}

	t.Run("blocked by default", func(t *testing.T) {
		client := newClient(t, httputil.ClientConfig{MaxRedirects: 5})
		err := client.CheckRedirect(mustReq("http://example.test/next"), via)
		require.ErrorIs(t, err, httputil.ErrHTTPSDowngrade)
	})

	t.Run("allowed when opted in", func(t *testing.T) {
		client := newClient(t, httputil.ClientConfig{MaxRedirects: 5, AllowHTTPSDowngrade: true})
		require.NoError(t, client.CheckRedirect(mustReq("http://example.test/next"), via))
	})
}

func TestNewClient_RedirectHeaderIsolation(t *testing.T) {
	type seen struct{ auth, cookie, referer string }
	record := func(dst *seen) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			*dst = seen{r.Header.Get("Authorization"), r.Header.Get("Cookie"), r.Header.Get("Referer")}
			w.WriteHeader(http.StatusOK)
		}
	}

	t.Run("a cross-origin hop carries nothing sensitive", func(t *testing.T) {
		var got seen
		target := httptest.NewServer(record(&got))
		defer target.Close()
		// A second server is a different port, so a different origin; Go on
		// its own would forward Authorization to the same host.
		src := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, target.URL, http.StatusFound)
		}))
		defer src.Close()

		req, err := http.NewRequest(http.MethodGet, src.URL+"/start?secret=1", nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer token")
		req.Header.Set("Cookie", "session=abc")

		resp, err := newClient(t, httputil.ClientConfig{MaxRedirects: 5}).Do(req)
		require.NoError(t, err)
		resp.Body.Close()

		require.Empty(t, got.auth, "Authorization must not cross origins")
		require.Empty(t, got.cookie, "Cookie must not cross origins")
		require.Empty(t, got.referer, "Referer (carrying the previous URL's query) must not cross origins")
	})

	t.Run("a same-origin hop keeps the caller's credentials", func(t *testing.T) {
		var got seen
		mux := http.NewServeMux()
		srv := httptest.NewServer(mux)
		defer srv.Close()
		mux.HandleFunc("/start", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, srv.URL+"/target", http.StatusFound)
		})
		mux.HandleFunc("/target", record(&got))

		req, err := http.NewRequest(http.MethodGet, srv.URL+"/start", nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer token")

		resp, err := newClient(t, httputil.ClientConfig{MaxRedirects: 5}).Do(req)
		require.NoError(t, err)
		resp.Body.Close()

		require.Equal(t, "Bearer token", got.auth, "same-origin redirects keep what the caller supplied")
	})
}

func TestNewClient_MaxBodySize(t *testing.T) {
	const limit = 10

	t.Run("declared Content-Length over the limit fails at Do", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(strings.Repeat("x", limit+5)))
		}))
		defer srv.Close()

		_, err := newClient(t, httputil.ClientConfig{MaxBodySize: limit}).Get(srv.URL)
		require.ErrorIs(t, err, httputil.ErrResponseTooLarge)
	})

	t.Run("undeclared oversized body fails during read, not silently truncated", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			// Flush first so the response is chunked and carries no Content-Length.
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			_, _ = w.Write([]byte(strings.Repeat("x", limit+5)))
		}))
		defer srv.Close()

		resp, err := newClient(t, httputil.ClientConfig{MaxBodySize: limit}).Get(srv.URL)
		require.NoError(t, err)
		defer resp.Body.Close()
		_, err = io.ReadAll(resp.Body)
		require.ErrorIs(t, err, httputil.ErrResponseTooLarge)
	})

	t.Run("body at exactly the limit passes", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(strings.Repeat("x", limit)))
		}))
		defer srv.Close()

		resp, err := newClient(t, httputil.ClientConfig{MaxBodySize: limit}).Get(srv.URL)
		require.NoError(t, err)
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.Len(t, body, limit)
	})
}
