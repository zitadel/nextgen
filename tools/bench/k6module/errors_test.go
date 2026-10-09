package k6module

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"go.k6.io/k6/v2/metrics"

	"github.com/zitadel/zitadel/v5/tools/bench/harness"
)

// TestFailedOperationIsCountedAndClassified: a failing operation emits one
// nextgen_errors sample tagged with the operation, the status class and the
// body's error code, and still fails the iteration.
func TestFailedOperationIsCountedAndClassified(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"code":"user.not_found","message":"no such user"}`))
	}))
	defer srv.Close()

	vu, samples := testVU(t)
	root := &RootModule{
		target: harness.Target{Base: srv.URL, Lane: "test", Origin: "http://origin.test", UserID: "user_1", ProjectSecret: "s"},
		creds:  harness.NewCredentials("s"),
		errors: metrics.NewRegistry().MustNewMetric(harness.MetricErrors, metrics.Counter),
	}
	root.once.Do(func() {}) // initialised by hand above
	m := &ModuleInstance{root: root, vu: vu}

	if _, err := m.GetUser(); err == nil {
		t.Fatal("GetUser succeeded against a 404")
	}
	close(samples)

	var found bool
	for sc := range samples {
		for _, s := range sc.GetSamples() {
			if s.Metric.Name != harness.MetricErrors {
				continue
			}
			found = true
			tags := s.Tags.Map()
			if s.Value != 1 || tags["op"] != harness.OpGetUser || tags["status_class"] != "4xx" || tags["code"] != "user.not_found" || tags["lane"] != "test" {
				t.Errorf("error sample value=%v tags=%v", s.Value, tags)
			}
		}
	}
	if !found {
		t.Fatal("no nextgen_errors sample was pushed")
	}
}
