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
	if r.body.Data["version"] != "v1.2.3" || r.body.Data["dialect"] != "sqlite" || r.body.Data["platform"] != "self_hosted" {
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
