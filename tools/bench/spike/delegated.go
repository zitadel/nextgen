package spike

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.k6.io/k6/v2/lib"
	"go.k6.io/k6/v2/lib/netext/httpext"
	"go.k6.io/k6/v2/metrics"
)

// delegatedDoer is the hybrid: the generated ogen client still encodes the
// request and decodes the response, but the call itself is handed to
// httpext.MakeRequest — the same function k6/http calls from JavaScript. k6
// therefore owns the transport, the tracer, the cookie jar, the http_req_*
// samples and the failure classification; the module only chooses the tags.
type delegatedDoer struct {
	m  *ModuleInstance
	st *lib.State
}

func (d *delegatedDoer) Do(r *http.Request) (*http.Response, error) {
	op := opFrom(r)
	r.Header.Set("Origin", d.m.root.cfg.Origin)

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
	// The name tag is set explicitly so k6 never tags by the raw URL: with a
	// manually set name, httpext sets the url system tag to the same value.
	tm := d.st.Tags.GetCurrentValues()
	tm.SetSystemTagOrMetaIfEnabled(d.st.Options.SystemTags, metrics.TagName, op)
	tm.SetTag("op", op)
	tm.SetTag("shape", "delegated")

	preq := &httpext.ParsedHTTPRequest{
		URL:              &u,
		Req:              r,
		Body:             body,
		Timeout:          60 * time.Second,
		Throw:            true,
		ResponseType:     httpext.ResponseTypeText,
		ResponseCallback: func(status int) bool { return status < 400 },
		Redirects:        d.st.Options.MaxRedirects,
		ActiveJar:        d.st.CookieJar,
		TagsAndMeta:      tm,
	}
	resp, err := httpext.MakeRequest(d.m.vu.Context(), d.st, preq)
	if err != nil {
		return nil, err
	}
	return toHTTPResponse(resp)
}

// toHTTPResponse rebuilds enough of an *http.Response for the generated
// decoder. k6's Response joins repeated header values with ", ", which is
// lossy for Set-Cookie; the cookies survive separately in resp.Cookies, so
// Set-Cookie is rebuilt from there (one header per cookie).
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
		return nil, fmt.Errorf("nextgen-spike: unexpected k6 body type %T", resp.Body)
	}
	u, _ := url.Parse(resp.URL)
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
