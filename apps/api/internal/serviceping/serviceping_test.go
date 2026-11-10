package serviceping

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSendVercelPostsOneCustomEvent(t *testing.T) {
	type received struct {
		header http.Header
		body   vercelEvent
	}
	got := make(chan received, 1)
	intake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body vercelEvent
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("body is not an event: %v", err)
		}
		got <- received{header: r.Header.Clone(), body: body}
		_, _ = io.WriteString(w, "OK")
	}))
	defer intake.Close()

	p := New(Config{Enabled: true, VercelEndpoint: intake.URL}, Facts{Version: "v1.2.3", Dialect: "sqlite"})
	now := time.UnixMilli(1_700_000_000_000)
	if err := p.sendVercel(t.Context(), now); err != nil {
		t.Fatalf("sendVercel: %v", err)
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

func TestSendVercelFailsOnARejectedEvent(t *testing.T) {
	intake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer intake.Close()

	p := New(Config{Enabled: true, VercelEndpoint: intake.URL}, Facts{})
	if err := p.sendVercel(t.Context(), time.Now()); err == nil {
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

	p := New(Config{Enabled: false, VercelEndpoint: intake.URL, MixpanelEndpoint: intake.URL, MixpanelToken: "tok"}, Facts{})
	p.Start()
	p.Close()
}

func TestSendMixpanelPostsOneEventItCannotLocate(t *testing.T) {
	type received struct {
		path   string
		query  url.Values
		header http.Header
		body   []mixpanelEvent
	}
	got := make(chan received, 1)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body []mixpanelEvent
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("body is not a list of events: %v", err)
		}
		got <- received{path: r.URL.Path, query: r.URL.Query(), header: r.Header.Clone(), body: body}
		_, _ = io.WriteString(w, `{"status":1,"error":null}`)
	}))
	defer api.Close()

	p := New(Config{Enabled: true, MixpanelEndpoint: api.URL + "/telemetry/mixpanel/track", MixpanelToken: "tok"}, Facts{Version: "v1.2.3", Dialect: "postgres"})
	now := time.UnixMilli(1_700_000_000_000)
	if err := p.sendMixpanel(t.Context(), now); err != nil {
		t.Fatalf("sendMixpanel: %v", err)
	}

	r := <-got
	if r.path != "/telemetry/mixpanel/track" || r.query.Get("ip") != "0" || r.query.Get("verbose") != "1" || r.header.Get("Content-Type") != "application/json" {
		t.Errorf("path = %s, query = %v, headers = %v", r.path, r.query, r.header)
	}
	if len(r.body) != 1 || r.body[0].Event != EventName {
		t.Fatalf("events = %+v", r.body)
	}
	properties := r.body[0].Properties
	if properties["token"] != "tok" || properties["ip"] != float64(0) || properties["time"] != float64(now.UnixMilli()) ||
		properties["surface"] != "server" || properties["server_version"] != "v1.2.3" || properties["dialect"] != "postgres" {
		t.Errorf("properties = %v", properties)
	}
	if id, _ := properties["$insert_id"].(string); id == "" || len(id) > 36 {
		t.Errorf("$insert_id = %v", properties["$insert_id"])
	}
	if id, ok := properties["distinct_id"]; ok {
		t.Errorf("sent a distinct_id, %v", id)
	}
}

func TestSendMixpanelFailsWhenMixpanelRefuses(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// What Mixpanel answers an event without a token, with HTTP 200.
		_, _ = io.WriteString(w, `{"error":"token, missing or empty","status":0}`)
	}))
	defer api.Close()

	p := New(Config{Enabled: true, MixpanelEndpoint: api.URL, MixpanelToken: "tok"}, Facts{})
	if err := p.sendMixpanel(t.Context(), time.Now()); err == nil || !strings.Contains(err.Error(), "token, missing or empty") {
		t.Fatalf("err = %v, want Mixpanel's refusal", err)
	}
}

func TestSendOnceSkipsADestinationWithoutAnEndpointOrToken(t *testing.T) {
	var requests atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_, _ = io.WriteString(w, `{"status":1}`)
	}))
	defer api.Close()

	New(Config{Enabled: true, VercelEndpoint: api.URL}, Facts{}).sendOnce()
	New(Config{Enabled: true, MixpanelEndpoint: api.URL}, Facts{}).sendOnce()
	if n := requests.Load(); n != 1 {
		t.Fatalf("%d requests, want only Vercel's", n)
	}
}
