package client_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/client"
	api "github.com/zitadel/nextgen/api/generated"
)

func TestBaseURL(t *testing.T) {
	t.Parallel()
	for origin, want := range map[string]string{
		"https://zitadel.example.com":         "https://zitadel.example.com/api/v1",
		"https://zitadel.example.com/":        "https://zitadel.example.com/api/v1",
		"http://localhost:8080":               "http://localhost:8080/api/v1",
		"https://example.com/zitadel":         "https://example.com/zitadel/api/v1",
		"https://zitadel.example.com/api/v1":  "https://zitadel.example.com/api/v1",
		"https://zitadel.example.com/api/v1/": "https://zitadel.example.com/api/v1",
	} {
		assert.Equal(t, want, client.BaseURL(origin), origin)
	}
}

// The generated client puts an operation's path after its base URL's own.
func TestNewCallsTheAPIUnderThePrefix(t *testing.T) {
	t.Parallel()
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)

	c, err := client.New(srv.URL, nil, api.WithClient(srv.Client()))
	require.NoError(t, err)
	_, err = c.GetLive(t.Context())
	require.NoError(t, err)
	assert.Equal(t, "/api/v1/livez", path)
}
