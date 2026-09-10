package domain

import (
	"context"
	"errors"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/httputil"
)

// White-box: classifyFetchError must map every transport failure mode to its
// fetch_* code, including errors as http.Client returns them (wrapped in
// *url.Error). The downgrade case has no end-to-end test because the
// hardened transport does not trust httptest's TLS certificate.
func TestClassifyFetchError(t *testing.T) {
	const schemaURL = "https://schemas.example.test/user.json"
	wrap := func(err error) error {
		return &url.Error{Op: "Get", URL: schemaURL, Err: err}
	}

	tests := []struct {
		name string
		err  error
		want Error
	}{
		{"denied address", wrap(httputil.NewAddressDeniedError("127.0.0.0/8")), ErrJSONSchemaFetchDenied()},
		{"response too large", httputil.ErrResponseTooLarge, ErrJSONSchemaFetchTooLarge()},
		{"too many redirects", wrap(httputil.ErrTooManyRedirects), ErrJSONSchemaFetchTooManyRedirects()},
		{"https downgrade", wrap(httputil.ErrHTTPSDowngrade), ErrJSONSchemaFetchDowngrade()},
		{"context deadline", wrap(context.DeadlineExceeded), ErrJSONSchemaFetchTimeout()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyFetchError(schemaURL, tt.err)
			require.ErrorIs(t, got, tt.want)
			de, ok := errors.AsType[Error](got)
			require.True(t, ok)
			assert.Equal(t, SchemaFetchDetails{URL: schemaURL}, de.Details)
			assert.ErrorIs(t, de.Parent, tt.err)
		})
	}

	t.Run("unclassified errors pass through untouched", func(t *testing.T) {
		plain := errors.New("connection refused")
		assert.Equal(t, plain, classifyFetchError(schemaURL, plain))
	})
}

func TestRedactSchemaURL(t *testing.T) {
	assert.Equal(t, "https://host.test/path",
		redactSchemaURL("https://user:secret@host.test/path?sig=token#frag"),
		"userinfo, query, and fragment must not reach client-facing details")
	assert.Equal(t, "https://host.test/plain.json",
		redactSchemaURL("https://host.test/plain.json"))
	assert.Equal(t, "http://bad url/",
		redactSchemaURL("http://bad url/"),
		"an unparseable string passes through unchanged")
}
