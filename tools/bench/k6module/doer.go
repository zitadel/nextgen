package k6module

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"go.k6.io/k6/v2/lib"
	"go.k6.io/k6/v2/lib/netext/httpext"
	"go.k6.io/k6/v2/metrics"

	"github.com/zitadel/nextgen/tools/bench/harness"
)

// doer is the request path ADR 066 fixes: the generated client encodes the
// request and decodes the response, and the call in between is k6's own
// httpext.MakeRequest — the function k6/http calls from JavaScript. k6 owns
// the transport, the tracer, the per-VU cookie jar, the http_req_* samples
// and the failure classification; this type only chooses the tags.
type doer struct {
	st     *lib.State
	ctx    func() contextT
	origin string
	lane   string
}

func (d *doer) Do(r *http.Request) (*http.Response, error) {
	op := harness.OpFromRequest(r)
	r.Header.Set("Origin", d.origin)

	var body *bytes.Buffer
	if r.Body != nil {
		b, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, err
		}
		body = bytes.NewBuffer(b)
	}

	u, err := httpext.NewURL(r.URL.String(), op)
	if err != nil {
		return nil, err
	}
	// MakeRequest stores response cookies in the jar and consults it on
	// redirects, but leaves the first request as given; k6/http merges the
	// jar in before calling it, and so does this. A cookie the generated
	// client set explicitly (the flow's _zflow parameter) wins over the jar.
	addJarCookies(r, d.st.CookieJar)
	// Tag cardinality is bounded here, by construction: the name tag is set
	// to the operation id, and with a manually set name httpext sets the url
	// system tag to that same value, so neither ever carries a raw path.
	tm := d.st.Tags.GetCurrentValues()
	tm.SetSystemTagOrMetaIfEnabled(d.st.Options.SystemTags, metrics.TagName, op)
	tm.SetTag("op", op)
	tm.SetTag("lane", d.lane)

	preq := &httpext.ParsedHTTPRequest{
		URL:          &u,
		Req:          r,
		Body:         body,
		Timeout:      harness.RequestTimeout,
		Throw:        true,
		ResponseType: httpext.ResponseTypeText,
		// k6's own default: 2xx and 3xx are expected. Status 0 — a dial
		// failure, a timeout, a body read error — is not, so http_req_failed
		// counts an outage instead of hiding it.
		ResponseCallback: func(status int) bool { return status >= 200 && status < 400 },
		Redirects:        d.st.Options.MaxRedirects,
		ActiveJar:        d.st.CookieJar,
		TagsAndMeta:      tm,
	}
	resp, err := httpext.MakeRequest(d.ctx(), d.st, preq)
	if err != nil {
		return nil, err
	}
	return toHTTPResponse(resp)
}

// addJarCookies adds the jar's cookies for the request URL that the request
// does not already carry by name.
func addJarCookies(r *http.Request, jar http.CookieJar) {
	if jar == nil {
		return
	}
	explicit := map[string]struct{}{}
	for _, c := range r.Cookies() {
		explicit[c.Name] = struct{}{}
	}
	for _, c := range jar.Cookies(r.URL) {
		if _, ok := explicit[c.Name]; !ok {
			r.AddCookie(c)
		}
	}
}

// toHTTPResponse rebuilds enough of an *http.Response for the generated
// decoder. k6's Response joins repeated header values with ", ", which is
// lossy for Set-Cookie; the cookies survive separately in resp.Cookies, so
// Set-Cookie is rebuilt from there, one header per cookie.
func toHTTPResponse(resp *httpext.Response) (*http.Response, error) {
	h := make(http.Header, len(resp.Headers))
	for k, v := range resp.Headers {
		if strings.EqualFold(k, "Set-Cookie") {
			continue
		}
		h.Set(k, v)
	}
	for name, cs := range resp.Cookies {
		for _, c := range cs {
			h.Add("Set-Cookie", (&http.Cookie{Name: name, Value: c.Value, Path: c.Path, HttpOnly: c.HTTPOnly}).String())
		}
	}
	var body string
	switch b := resp.Body.(type) {
	case string:
		body = b
	case []byte:
		body = string(b)
	case nil:
	default:
		return nil, fmt.Errorf("k6/x/nextgen: unexpected k6 body type %T", resp.Body)
	}
	u, err := url.Parse(resp.URL)
	if err != nil {
		return nil, err
	}
	return &http.Response{
		StatusCode:    resp.Status,
		Status:        resp.StatusText,
		Proto:         resp.Proto,
		Header:        h,
		Body:          io.NopCloser(strings.NewReader(body)),
		ContentLength: int64(len(body)),
		Request:       &http.Request{URL: u},
	}, nil
}
