package errorpage_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/errorpage"
)

func TestWants(t *testing.T) {
	t.Parallel()
	// What a browser sends when it navigates, on every engine.
	const navigation = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"

	tests := []struct {
		name   string
		method string
		accept []string
		want   bool
	}{
		{name: "a browser navigation", method: http.MethodGet, accept: []string{navigation}, want: true},
		{name: "a HEAD of one", method: http.MethodHead, accept: []string{navigation}, want: true},
		{name: "text/html among several headers", method: http.MethodGet, accept: []string{"application/json", "text/html"}, want: true},
		{name: "fetch and curl's default", method: http.MethodGet, accept: []string{"*/*"}},
		{name: "an API client", method: http.MethodGet, accept: []string{"application/json"}},
		{name: "no Accept header", method: http.MethodGet},
		{name: "HTML refused with q=0", method: http.MethodGet, accept: []string{"text/html;q=0, application/json"}},
		{name: "a form post", method: http.MethodPost, accept: []string{navigation}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequest(tt.method, "/nowhere", nil)
			for _, accept := range tt.accept {
				r.Header.Add("Accept", accept)
			}
			assert.Equal(t, tt.want, errorpage.Wants(r))
		})
	}
}

func TestWriteRendersTheAnatomy(t *testing.T) {
	t.Parallel()
	r := httptest.NewRequest(http.MethodGet, "/nowhere", nil)
	r = r.WithContext(middleware.WithRequestContext(r.Context(), middleware.RequestContext{RequestID: "req_01TEST"}))
	rec := httptest.NewRecorder()

	errorpage.Write(rec, r, errorpage.NotFound(&errorpage.Link{Label: "Open the console", Href: "/ui/console/"}))

	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	body := rec.Body.String()
	for _, part := range []string{
		"<title>Page not found · Zitadel</title>",
		`<p class="error-status">Error 404</p>`,
		`<h1 class="error-title">Page not found</h1>`,
		"There is nothing at this address.",
		`<a class="error-action" href="/ui/console/">Open the console</a>`,
		"Request ID <code>req_01TEST</code>",
		// The design tokens, inlined: the page makes no second request.
		"--zl-background:",
	} {
		assert.Contains(t, body, part)
	}
}

func TestWriteKeepsTheCallersCachePolicy(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	rec.Header().Set("Cache-Control", "private, no-store")

	errorpage.Write(rec, httptest.NewRequest(http.MethodGet, "/", nil), errorpage.NotFound(nil))

	assert.Equal(t, "private, no-store", rec.Header().Get("Cache-Control"))
	assert.NotContains(t, rec.Body.String(), `<a class="error-action"`, "no way on, no button")
	assert.NotContains(t, rec.Body.String(), "Request ID", "no request context, no reference")
}

func TestWriteEscapesItsText(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()

	errorpage.Write(rec, httptest.NewRequest(http.MethodGet, "/", nil), errorpage.Page{
		Status:      http.StatusBadRequest,
		Title:       "<script>alert(1)</script>",
		Description: "a & b",
		Action:      &errorpage.Link{Label: "Go", Href: "javascript:alert(1)"},
	})

	body := rec.Body.String()
	assert.NotContains(t, body, "<script>alert(1)</script>")
	assert.Contains(t, body, "&lt;script&gt;alert(1)&lt;/script&gt;")
	assert.Contains(t, body, "a &amp; b")
	assert.NotContains(t, body, `href="javascript:`)
}

func TestWriteSendsNoBodyForHEAD(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()

	errorpage.Write(rec, httptest.NewRequest(http.MethodHead, "/", nil), errorpage.NotFound(nil))

	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Empty(t, rec.Body.String())
}
