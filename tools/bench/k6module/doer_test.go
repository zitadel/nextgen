package k6module

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"go.k6.io/k6/v2/js/modulestest"
	"go.k6.io/k6/v2/lib"
	"go.k6.io/k6/v2/metrics"
	"gopkg.in/guregu/null.v3"

	"github.com/zitadel/nextgen/tools/bench/harness"
)

// testVU builds a VU in the VU context with the slice of lib.State that
// httpext.MakeRequest reads, and a buffered sample channel the test drains.
// The logger is k6's own test logger: lib.State.Logger is a logrus interface
// by k6's choice, and the test runtime is the one place to get one without
// importing logrus here.
func testVU(t *testing.T) (*modulestest.VU, chan metrics.SampleContainer) {
	t.Helper()
	rt := modulestest.NewRuntime(t)
	registry := metrics.NewRegistry()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	samples := make(chan metrics.SampleContainer, 1024)
	rt.MoveToVUContext(&lib.State{
		Options: lib.Options{
			SystemTags:   &metrics.DefaultSystemTagSet,
			MaxRedirects: null.IntFrom(10),
		},
		BuiltinMetrics: metrics.RegisterBuiltinMetrics(registry),
		Logger:         rt.VU.InitEnvField.Logger,
		//egress:allow test transport against an httptest server
		Transport:  http.DefaultTransport,
		CookieJar:  jar,
		Samples:    samples,
		BufferPool: lib.NewBufferPool(),
		Tags:       lib.NewVUStateTags(registry.RootTagSet()),
	})
	return rt.VU, samples
}

// TestDoerBoundsTagsByOperation is the #1104 cardinality property at the
// request layer: a hundred requests to a hundred distinct /flow/{id}/submit
// paths produce samples whose name and url tags are all the operation id,
// so the time-series count does not grow with the ids.
func TestDoerBoundsTagsByOperation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "http://origin.test" {
			http.Error(w, "missing origin", http.StatusBadRequest)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "_zflow", Value: "sealed-" + strings.TrimPrefix(r.URL.Path, "/flow/"), Path: "/"})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	vu, samples := testVU(t)
	d := &doer{st: vu.State(), ctx: vu.Context, origin: "http://origin.test", lane: "test"}

	const n = 100
	for i := range n {
		req, err := http.NewRequestWithContext(harness.WithOp(t.Context(), harness.OpSubmitIdent), http.MethodPost,
			fmt.Sprintf("%s/flow/flow_%04d/submit", srv.URL, i), strings.NewReader(`{"action":"submit"}`))
		if err != nil {
			t.Fatal(err)
		}
		resp, err := d.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 || string(body) != `{"ok":true}` {
			t.Fatalf("response %d %q", resp.StatusCode, body)
		}
		if got := resp.Header.Values("Set-Cookie"); len(got) != 1 || !strings.HasPrefix(got[0], "_zflow=sealed-") {
			t.Fatalf("Set-Cookie not rebuilt from k6's cookies: %q", got)
		}
	}
	close(samples)

	series := map[string]struct{}{}
	var count int
	for sc := range samples {
		for _, s := range sc.GetSamples() {
			count++
			tags := s.Tags.Map()
			for _, k := range []string{"name", "url"} {
				if tags[k] != harness.OpSubmitIdent {
					t.Fatalf("%s tag = %q, want the operation id", k, tags[k])
				}
			}
			if tags["op"] != harness.OpSubmitIdent || tags["lane"] != "test" {
				t.Fatalf("module tags missing: %v", tags)
			}
			series[s.Metric.Name+"|"+fmt.Sprint(tags)] = struct{}{}
		}
	}
	if count == 0 {
		t.Fatal("no samples were pushed")
	}
	// http_reqs + 6 timings + http_req_failed, one series each.
	if len(series) != 9 {
		t.Errorf("series = %d, want 9 (one per built-in metric); the tag set grew with the request", len(series))
	}
}

// TestDoerStoresCookiesInTheJar checks the per-VU jar receives what the
// server set, which is what lets k6/http-style scenarios skip the explicit
// cookie parameter.
func TestDoerStoresCookiesInTheJar(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "_zflow", Value: "v1", Path: "/"})
	}))
	defer srv.Close()
	vu, _ := testVU(t)
	d := &doer{st: vu.State(), ctx: vu.Context, origin: "http://origin.test", lane: "test"}
	req, _ := http.NewRequestWithContext(harness.WithOp(t.Context(), harness.OpCreateFlow), http.MethodPost, srv.URL+"/flow", strings.NewReader("{}"))
	if _, err := d.Do(req); err != nil {
		t.Fatal(err)
	}
	u := req.URL
	var found bool
	for _, c := range vu.State().CookieJar.Cookies(u) {
		found = found || (c.Name == "_zflow" && c.Value == "v1")
	}
	if !found {
		t.Fatalf("jar does not hold _zflow: %v", vu.State().CookieJar.Cookies(u))
	}
}
