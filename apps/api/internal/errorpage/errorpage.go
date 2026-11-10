// Package errorpage renders the HTML error page the server shows a person: a
// browser that navigated to a path no API operation answers, or a sign-in
// callback that failed. Programs get the API's JSON envelope instead; the
// split and the page's anatomy are ADR 076.
package errorpage

import (
	"bytes"
	_ "embed"
	"html/template"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/errlog"
	"github.com/zitadel/nextgen/internal/securityheaders"
	designtokens "github.com/zitadel/nextgen/packages/design-tokens"
)

// Page is what an error page says. Every field is the server's own text: a
// page never reflects anything read from the request.
type Page struct {
	Status      int
	Title       string
	Description string
	// Action is the page's way on; a page without one renders no button.
	Action *Link
}

// Link is a page's way on.
type Link struct {
	Label string
	Href  string
}

// NotFound is the page for a path nothing on this server answers. home is
// where a person goes from there, or nil for no way on.
func NotFound(home *Link) Page {
	return Page{
		Status:      http.StatusNotFound,
		Title:       "Page not found",
		Description: "There is nothing at this address. The link may be broken, or the page may have moved.",
		Action:      home,
	}
}

// Wants reports whether r is a browser navigation, which gets a page rather
// than the JSON envelope: a GET or HEAD whose Accept header lists text/html.
// A fetch, curl and the SDKs send `*/*` or `application/json`, which never
// match, so a program keeps getting the envelope it can parse.
func Wants(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	for _, value := range r.Header.Values("Accept") {
		for _, part := range strings.Split(value, ",") {
			mediaType, params, err := mime.ParseMediaType(strings.TrimSpace(part))
			if err != nil || mediaType != "text/html" {
				continue
			}
			// q=0 is the client saying it cannot take HTML.
			if q, err := strconv.ParseFloat(params["q"], 64); err == nil && q == 0 {
				continue
			}
			return true
		}
	}
	return false
}

//go:embed page.html
var pageHTML string

//go:embed page.css
var pageCSS string

var pageTemplate = template.Must(template.New("page").Parse(pageHTML))

// styles is inlined so the page needs no second request, which on a path
// nothing answers would only fail again. Both stylesheets are embedded files,
// never request data, which is what makes the template.CSS conversion safe.
var styles = template.CSS(designtokens.TokensCSS + pageCSS)

// policy lets the page run its own inline script and style, each by hash, and
// load its favicons; nothing else.
var policy = securityheaders.Policy(
	"default-src 'none'",
	"script-src "+strings.Join(securityheaders.InlineScriptHashes(pageHTML), " "),
	"style-src "+securityheaders.Hash(string(styles)),
	"img-src 'self'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
	"report-uri "+securityheaders.ReportPath,
)

// Write renders p with p.Status. The request ID the request-context middleware
// minted is printed under it, so a person can quote it to whoever reads the
// server's logs.
func Write(w http.ResponseWriter, r *http.Request, p Page) {
	data := struct {
		Page
		RequestID string
		CSS       template.CSS
	}{Page: p, CSS: styles}
	if rc, ok := middleware.GetRequestContext(r.Context()); ok {
		data.RequestID = rc.RequestID
	}

	var body bytes.Buffer
	if err := pageTemplate.Execute(&body, data); err != nil {
		// The template is parsed at start-up and fed only the fields above, so
		// this is a bug: answer with the status at least.
		errlog.LogFault(r.Context(), domain.ErrInternal(err).WithMessage("failed to render the error page"))
		http.Error(w, http.StatusText(p.Status), p.Status)
		return
	}

	header := w.Header()
	header.Set("Content-Type", "text/html; charset=utf-8")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set(securityheaders.PolicyHeader, policy)
	// The request ID makes every page unique.
	if header.Get("Cache-Control") == "" {
		header.Set("Cache-Control", "no-store")
	}
	w.WriteHeader(p.Status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body.Bytes())
	}
}
