package serviceping

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSendPostsOneCustomEvent(t *testing.T) {
	type received struct {
		header http.Header
		body   event
	}
	got := make(chan received, 1)
	intake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body event
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("body is not an event: %v", err)
		}
		got <- received{header: r.Header.Clone(), body: body}
		_, _ = io.WriteString(w, "OK")
	}))
	defer intake.Close()

	p := New(Config{Enabled: true, Endpoint: intake.URL}, Facts{Version: "v1.2.3", Dialect: "sqlite"})
	now := time.UnixMilli(1_700_000_000_000)
	if err := p.send(t.Context(), now); err != nil {
		t.Fatalf("send: %v", err)
	}

	r := <-got
	if r.body.Name != EventName || r.body.Timestamp != now.UnixMilli() || r.body.Origin != intake.URL {
		t.Errorf("event = %+v", r.body)
	}
	if r.body.Data["surface"] != "server" || r.body.Data["server_version"] != "v1.2.3" || r.body.Data["dialect"] != "sqlite" {
		t.Errorf("data = %v", r.body.Data)
	}
	if r.header.Get("X-Va-Server") != "1" || r.header.Get("Content-Type") != "application/json" {
		t.Errorf("headers = %v", r.header)
	}
}

func TestSendFailsOnARejectedEvent(t *testing.T) {
	intake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer intake.Close()

	p := New(Config{Enabled: true, Endpoint: intake.URL}, Facts{})
	if err := p.send(t.Context(), time.Now()); err == nil {
		t.Fatal("send succeeded on a 400")
	}
}

func TestPropertiesNameTheDeployment(t *testing.T) {
	tests := []struct {
		name        string
		facts       Facts
		wantVersion string
		wantKind    string
	}{
		{name: "self-hosted", facts: Facts{Version: "v1.2.3", Commit: "3f2c1ab", PublicBase: "https://auth.example.com"}, wantVersion: "v1.2.3", wantKind: "self_hosted"},
		{name: "unparsable origin", facts: Facts{Version: "v1.2.3", PublicBase: "://"}, wantVersion: "v1.2.3", wantKind: "self_hosted"},
		{name: "localhost", facts: Facts{Version: "v1.2.3", PublicBase: "http://localhost:8080"}, wantVersion: "v1.2.3", wantKind: "local"},
		{name: "loopback IPv4", facts: Facts{Version: "v1.2.3", PublicBase: "http://127.0.0.1:8080"}, wantVersion: "v1.2.3", wantKind: "local"},
		{name: "loopback IPv6", facts: Facts{Version: "v1.2.3", PublicBase: "http://[::1]:8080"}, wantVersion: "v1.2.3", wantKind: "local"},
		{name: "cloud reports its commit", facts: Facts{Version: "v1.2.3+cloud", Commit: "3f2c1ab", OnVercel: true, PublicBase: "http://localhost:3000"}, wantVersion: "3f2c1ab", wantKind: "cloud"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.facts.Properties()
			if got["server_version"] != tt.wantVersion || got["server_kind"] != tt.wantKind {
				t.Errorf("server_version = %v, server_kind = %v; want %s, %s", got["server_version"], got["server_kind"], tt.wantVersion, tt.wantKind)
			}
		})
	}
}

func TestPlatformIsNamedAsNodeNamesIt(t *testing.T) {
	for goName, want := range map[string]string{"windows": "win32", "linux": "linux", "darwin": "darwin"} {
		if got := nodeOS(goName); got != want {
			t.Errorf("nodeOS(%q) = %q, want %q", goName, got, want)
		}
	}
	for goName, want := range map[string]string{"amd64": "x64", "arm64": "arm64"} {
		if got := nodeArch(goName); got != want {
			t.Errorf("nodeArch(%q) = %q, want %q", goName, got, want)
		}
	}
}

func TestPropertiesFitTheIntakeLimit(t *testing.T) {
	if n := len((Facts{}).Properties()); n > MaxProperties {
		t.Fatalf("%d properties, the intake keeps %d", n, MaxProperties)
	}
}

func TestDisabledPingerSendsNothing(t *testing.T) {
	intake := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("a disabled pinger sent a request")
	}))
	defer intake.Close()

	p := New(Config{Enabled: false, Endpoint: intake.URL}, Facts{})
	p.Start()
	p.Close()
}
