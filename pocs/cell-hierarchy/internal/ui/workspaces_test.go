package ui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestWorkspaceCreateAndAddSite(t *testing.T) {
	platformStore, err := cell.OpenStore(t.TempDir()+"/p.db", "http://platform", "platform", true)
	if err != nil {
		t.Fatal(err)
	}
	defer platformStore.Close()
	euStore, err := cell.OpenStore(t.TempDir()+"/eu.db", "http://eu-1", "eu-1", false)
	if err != nil {
		t.Fatal(err)
	}
	defer euStore.Close()

	now := time.Now().UTC()
	if err := platformStore.CreateProject(cell.Project{
		ID: "platform", Name: "platform", IsParent: true, LookupEnabled: true, CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}

	platformSrv := cell.NewServer(platformStore, nil, nil)
	euSrv := cell.NewServer(euStore, nil, nil)
	platformHTTP := httptest.NewServer(platformSrv.Handler())
	defer platformHTTP.Close()
	euHTTP := httptest.NewServer(euSrv.Handler())
	defer euHTTP.Close()

	app, err := NewApp([]CellRef{
		{Label: "platform", URL: platformHTTP.URL},
		{Label: "eu-1", URL: euHTTP.URL},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	app.workspaceFile = t.TempDir() + "/workspaces.json"
	app.seedWorkspaces()

	mux := app.Handler()

	form := url.Values{"id": {"demo"}, "name": {"Demo"}, "home_cell": {"eu-1"}}
	req := httptest.NewRequest(http.MethodPost, "/workspaces", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("create workspace status=%d body=%s", rec.Code, rec.Body.String())
	}
	ws, ok := app.getWorkspace("demo")
	if !ok || ws.HomeCell != "eu-1" {
		t.Fatalf("workspace=%v ok=%v", ws, ok)
	}

	siteForm := url.Values{
		"id": {"demo-fra"}, "name": {"demo-fra"}, "cell": {"eu-1"}, "parent_project_id": {"platform"},
	}
	req = httptest.NewRequest(http.MethodPost, "/workspaces/demo/sites", strings.NewReader(siteForm.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("id", "demo")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("add site status=%d loc=%s body=%s", rec.Code, rec.Header().Get("Location"), rec.Body.String())
	}
	if strings.Contains(rec.Header().Get("Location"), "err=") {
		t.Fatalf("add site redirected with err: %s", rec.Header().Get("Location"))
	}

	ctx := context.Background()
	projects, err := app.Peer.ListProjects(ctx, euHTTP.URL)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range projects {
		if p.ID == "demo-fra" && p.WorkspaceID == "demo" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("demo-fra not found: %+v", projects)
	}

	trace := app.copyTrace()
	if len(trace) == 0 {
		t.Fatal("expected Global Trace entries for workspace/site create")
	}
}
