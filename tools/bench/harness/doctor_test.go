package harness

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func factOf(r DoctorReport, name string) (Fact, bool) {
	for _, f := range r.Facts {
		if f.Name == name {
			return f, true
		}
	}
	return Fact{}, false
}

// TestDoctorSeparatesDeclaredFromUnknown: the server reports none of its
// dialect, image, replicas or logging, so each must read as declared when
// someone said it and as unknown, with a warning, when not.
func TestDoctorSeparatesDeclaredFromUnknown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) }))
	defer srv.Close()

	r, err := Doctor(t.Context(), DoctorOptions{
		Target:   Target{Base: srv.URL, Lane: "ci"},
		Declared: map[string]string{"dialect": "postgres", "session.default_ttl": "10m"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !r.Reachable || len(r.Probes) != 3 {
		t.Fatalf("reachable %t, probes %v", r.Reachable, r.Probes)
	}
	if f, _ := factOf(r, "dialect"); f.Value != "postgres" || f.Source != SourceDeclared {
		t.Errorf("dialect = %+v", f)
	}
	if f, _ := factOf(r, "replicas"); f.Value != "unknown" || f.Source != SourceUnknown {
		t.Errorf("replicas = %+v", f)
	}
	if f, ok := factOf(r, "session.default_ttl"); !ok || f.Value != "10m" {
		t.Errorf("extra declared fact lost: %+v", f)
	}
	warned := strings.Join(r.Warnings, "\n")
	for _, name := range []string{"image_tag", "replicas", "log_level"} {
		if !strings.Contains(warned, name) {
			t.Errorf("no warning for undeclared %s: %q", name, warned)
		}
	}
	if strings.Contains(warned, "dialect") {
		t.Errorf("warned about a declared fact: %q", warned)
	}
}

func TestDoctorHarnessSource(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) }))
	defer srv.Close()

	r, err := Doctor(t.Context(), DoctorOptions{
		Target:         Target{Base: srv.URL},
		Declared:       map[string]string{"dialect": "sqlite", "image_tag": "b", "replicas": "1", "log_level": "warn"},
		DeclaredSource: SourceHarness,
	})
	if err != nil {
		t.Fatal(err)
	}
	if f, _ := factOf(r, "dialect"); f.Source != SourceHarness {
		t.Errorf("dialect source = %q", f.Source)
	}
	if len(r.Warnings) != 0 {
		t.Errorf("warnings for a fully described target: %v", r.Warnings)
	}
}

// TestDoctorReportsUnreachable: an unreachable or unhealthy target is a
// report with Reachable false, so it is recorded as well as printed.
func TestDoctorReportsUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok"))
	}))
	r, err := Doctor(t.Context(), DoctorOptions{Target: Target{Base: srv.URL}})
	if err != nil {
		t.Fatal(err)
	}
	if r.Reachable || !strings.Contains(strings.Join(r.Warnings, "\n"), "/readyz") {
		t.Errorf("reachable %t, warnings %v", r.Reachable, r.Warnings)
	}

	srv.Close()
	r, err = Doctor(t.Context(), DoctorOptions{Target: Target{Base: srv.URL}})
	if err != nil {
		t.Fatal(err)
	}
	if r.Reachable || r.Probes[0].Error == "" {
		t.Errorf("a closed server reported reachable: %+v", r.Probes)
	}
}
