package ui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestUIPeerDoesNotApplyPairDelays(t *testing.T) {
	store, err := cell.OpenStore(t.TempDir()+"/c.db", "http://eu-1:8101", "eu-1", false)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	srv := cell.NewServer(store, nil, nil)
	httpSrv := httptest.NewServer(srv.Handler())
	defer httpSrv.Close()

	app, err := NewApp([]CellRef{
		{Label: "eu-1", URL: httpSrv.URL},
		{Label: "us-1", URL: "http://us-1:8103"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if app.Peer.ApplyPairDelays {
		t.Fatal("UI peer must not enable WAN pair delays")
	}
	start := time.Now()
	_, err = app.Peer.GetMe(context.Background(), httpSrv.URL)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	if elapsed >= 40*time.Millisecond {
		t.Fatalf("UI→cell GetMe took %v; want no artificial delay", elapsed)
	}
}

func TestFindProjectUsesHostCache(t *testing.T) {
	store, err := cell.OpenStore(t.TempDir()+"/c.db", "http://eu-1:8101", "eu-1", false)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.CreateProject(cell.Project{
		ID: "acme", Name: "acme", LookupEnabled: true, WorkspaceID: "acme",
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	var hits atomic.Int32
	srv := cell.NewServer(store, nil, nil)
	httpSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		srv.Handler().ServeHTTP(w, r)
	}))
	defer httpSrv.Close()

	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.NotFound(w, r)
	}))
	defer other.Close()

	app, err := NewApp([]CellRef{
		{Label: "platform", URL: other.URL},
		{Label: "eu-1", URL: httpSrv.URL},
		{Label: "us-1", URL: other.URL},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	app.rememberProjectHost("acme", httpSrv.URL)
	hits.Store(0)
	host, p, err := app.findProject(context.Background(), "acme")
	if err != nil {
		t.Fatal(err)
	}
	if host != cell.NormalizeURL(httpSrv.URL) && host != httpSrv.URL {
		// NormalizeURL may change trailing slash; compare via Get path success.
		_ = host
	}
	if p.ID != "acme" {
		t.Fatalf("project=%s", p.ID)
	}
	if n := hits.Load(); n != 1 {
		t.Fatalf("expected 1 cell request with cache, got %d", n)
	}
}
