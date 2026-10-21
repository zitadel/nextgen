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

func startPlatformEU(t *testing.T) (app *App, platformURL, euURL string, mux http.Handler) {
	t.Helper()
	platformStore, err := cell.OpenStore(t.TempDir()+"/p.db", "http://platform", "platform", true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = platformStore.Close() })
	euStore, err := cell.OpenStore(t.TempDir()+"/eu.db", "http://eu-1", "eu-1", false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = euStore.Close() })
	usStore, err := cell.OpenStore(t.TempDir()+"/us.db", "http://us-2", "us-2", false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = usStore.Close() })

	now := time.Now().UTC()
	if err := platformStore.CreateProject(cell.Project{
		ID: "platform", Name: "platform", IsParent: true, LookupEnabled: true, CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if err := platformStore.CreateTeam(cell.Team{
		ID: "acme", ProjectID: "platform", Name: "acme", CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}

	platformSrv := cell.NewServer(platformStore, nil, nil)
	euSrv := cell.NewServer(euStore, nil, nil)
	usSrv := cell.NewServer(usStore, nil, nil)
	platformHTTP := httptest.NewServer(platformSrv.Handler())
	t.Cleanup(platformHTTP.Close)
	euHTTP := httptest.NewServer(euSrv.Handler())
	t.Cleanup(euHTTP.Close)
	usHTTP := httptest.NewServer(usSrv.Handler())
	t.Cleanup(usHTTP.Close)

	app, err = NewApp([]CellRef{
		{Label: "platform", URL: platformHTTP.URL},
		{Label: "eu-1", URL: euHTTP.URL},
		{Label: "us-2", URL: usHTTP.URL},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	app.workspaceFile = t.TempDir() + "/workspaces.json"
	app.seedWorkspaces()
	return app, platformHTTP.URL, euHTTP.URL, app.Handler()
}

func TestWorkspaceCreateRequiresCellAndTeam(t *testing.T) {
	app, _, euURL, mux := startPlatformEU(t)

	form := url.Values{
		"id": {"demo"}, "name": {"Demo"}, "cell": {"eu-1"}, "customer_team_id": {"acme"},
	}
	req := httptest.NewRequest(http.MethodPost, "/workspaces", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("create workspace status=%d body=%s", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	if !strings.HasPrefix(loc, "/projects/demo") {
		t.Fatalf("expected redirect to /projects/demo, got %s", loc)
	}
	if strings.Contains(loc, "err=") {
		t.Fatalf("create failed: %s", loc)
	}

	ctx := context.Background()
	projects, err := app.Peer.ListProjects(ctx, euURL)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range projects {
		if p.ID == "demo" {
			found = true
			if p.WorkspaceID != "demo" {
				t.Fatalf("workspace_id=%s want demo", p.WorkspaceID)
			}
			if p.CustomerTeamID != "acme" {
				t.Fatalf("customer_team_id=%s want acme", p.CustomerTeamID)
			}
			if !p.LookupEnabled {
				t.Fatal("lookup_enabled want true on workspace root")
			}
			if p.ParentProjectID != "" {
				t.Fatalf("parent=%q want empty (workspace must not attach to platform)", p.ParentProjectID)
			}
			break
		}
	}
	if !found {
		t.Fatalf("demo project not on eu-1: %+v", projects)
	}
	ws, ok := app.getWorkspace("demo")
	if !ok || ws.CustomerTeamID != "acme" || ws.Cell != "eu-1" {
		t.Fatalf("registry workspace=%v ok=%v", ws, ok)
	}

	// User on orphan workspace root must not float a lookup row onto platform.
	userForm := url.Values{"email": {"root@example.com"}}
	req = httptest.NewRequest(http.MethodPost, "/projects/demo/users", strings.NewReader(userForm.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("id", "demo")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther || strings.Contains(rec.Header().Get("Location"), "err=") {
		t.Fatalf("create user: %s", rec.Header().Get("Location"))
	}
	platformURL, err := app.cellURLByLabel("platform")
	if err != nil {
		t.Fatal(err)
	}
	var platRaw struct {
		Lookup []lookupRow `json:"lookup"`
	}
	if err := app.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(platformURL)+"/v1/projects/platform", nil, "", &platRaw); err != nil {
		t.Fatal(err)
	}
	for _, e := range platRaw.Lookup {
		if e.Key == "root@example.com" {
			t.Fatalf("platform lookup must stay empty for workspace-root user; got %+v", e)
		}
	}
}

func TestAddChildSiteFloatAndLookupWalk(t *testing.T) {
	app, _, euURL, mux := startPlatformEU(t)

	// Create workspace root on eu-1.
	form := url.Values{
		"id": {"acme"}, "name": {"Acme"}, "cell": {"eu-1"}, "customer_team_id": {"acme"},
	}
	req := httptest.NewRequest(http.MethodPost, "/workspaces", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther || strings.Contains(rec.Header().Get("Location"), "err=") {
		t.Fatalf("create workspace: %s", rec.Header().Get("Location"))
	}

	// Add child on us-2 under acme.
	siteForm := url.Values{
		"id": {"acme-us2"}, "name": {"acme-us2"}, "cell": {"us-2"},
		"parent_project_id": {"acme"}, "workspace_id": {"acme"},
	}
	req = httptest.NewRequest(http.MethodPost, "/projects/acme/sites", strings.NewReader(siteForm.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("id", "acme")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther || strings.Contains(rec.Header().Get("Location"), "err=") {
		t.Fatalf("add site: %s", rec.Header().Get("Location"))
	}

	ctx := context.Background()
	usURL, err := app.cellURLByLabel("us-2")
	if err != nil {
		t.Fatal(err)
	}
	child, err := app.Peer.GetProject(ctx, usURL, "acme-us2")
	if err != nil {
		t.Fatal(err)
	}
	if child.ParentProjectID != "acme" {
		t.Fatalf("child parent=%s want acme", child.ParentProjectID)
	}
	if child.WorkspaceID != "acme" || child.CustomerTeamID != "acme" {
		t.Fatalf("child linkage workspace=%s team=%s", child.WorkspaceID, child.CustomerTeamID)
	}

	// Create user on child → float to acme only (not platform).
	userForm := url.Values{"email": {"joe@example.com"}}
	req = httptest.NewRequest(http.MethodPost, "/projects/acme-us2/users", strings.NewReader(userForm.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("id", "acme-us2")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusSeeOther || strings.Contains(rec.Header().Get("Location"), "err=") {
		t.Fatalf("create user: %s", rec.Header().Get("Location"))
	}

	// Parent site lookup table should see floated key.
	var parentRaw struct {
		Lookup []lookupRow `json:"lookup"`
	}
	if err := app.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(euURL)+"/v1/projects/acme", nil, "", &parentRaw); err != nil {
		t.Fatal(err)
	}
	floated := false
	for _, e := range parentRaw.Lookup {
		if e.Key == "joe@example.com" && e.HomeProjectID == "acme-us2" {
			floated = true
			if e.Source != "child" {
				t.Fatalf("provenance source=%s want child", e.Source)
			}
		}
	}
	if !floated {
		t.Fatalf("expected floated key on parent acme: %+v", parentRaw.Lookup)
	}

	// Platform must NOT receive the floated customer key.
	platformURL, err := app.cellURLByLabel("platform")
	if err != nil {
		t.Fatal(err)
	}
	var platRaw struct {
		Lookup []lookupRow `json:"lookup"`
	}
	if err := app.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(platformURL)+"/v1/projects/platform", nil, "", &platRaw); err != nil {
		t.Fatal(err)
	}
	for _, e := range platRaw.Lookup {
		if e.Key == "joe@example.com" {
			t.Fatalf("platform lookup must not hold customer float; got %+v", e)
		}
	}

	// Lookup from parent (sibling/parent walk) finds home.
	lookForm := url.Values{"key": {"joe@example.com"}}
	req = httptest.NewRequest(http.MethodPost, "/projects/acme/lookup", strings.NewReader(lookForm.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("id", "acme")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	loc := rec.Header().Get("Location")
	if rec.Code != http.StatusSeeOther || strings.Contains(loc, "err=") {
		t.Fatalf("lookup: %s", loc)
	}
	u, _ := url.Parse(loc)
	ok := u.Query().Get("ok")
	if !strings.Contains(ok, "hit") {
		t.Fatalf("lookup ok=%q want hit", ok)
	}

	lt := app.latestTrace()
	if lt == nil {
		t.Fatal("expected latest trace after lookup")
	}
	tl := app.latestTimeline()
	if tl == nil || tl.StepCount < 1 {
		t.Fatalf("expected timeline steps after lookup, got %+v", tl)
	}
	// Single UI→entry OnHop plus server walk chain (not one UI caller per site).
	uiCallers := 0
	for _, s := range tl.Steps {
		if s.Caller == "UI" {
			uiCallers++
		}
	}
	if uiCallers > 1 {
		t.Fatalf("expected at most one UI→entry step, got %d UI callers in %+v", uiCallers, resultsOf(tl))
	}
	hasSemantic := false
	for _, h := range lt.Hops {
		if h.From != "" && (h.Result == "miss" || h.Result == "hit" || h.Result == "tombstone") {
			hasSemantic = true
			break
		}
	}
	if !hasSemantic {
		t.Fatalf("expected delegated walk hops with From set, got %+v", lt.Hops)
	}
}

func TestLabRedirectsAndNoTraceDrawer(t *testing.T) {
	_, _, _, mux := startPlatformEU(t)

	for _, path := range []string{"/lab", "/scenarios"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusSeeOther {
			t.Fatalf("%s status=%d", path, rec.Code)
		}
		if loc := rec.Header().Get("Location"); loc != "/workspaces" {
			t.Fatalf("%s loc=%s want /workspaces", path, loc)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/workspaces", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("workspaces status=%d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "trace-drawer") || strings.Contains(body, "Global Trace") {
		t.Fatal("workspaces page must not include sticky Global Trace drawer")
	}
	if strings.Contains(body, `href="/lab"`) {
		t.Fatal("nav must not link Lab")
	}
	if !strings.Contains(body, `href="/platform"`) {
		t.Fatal("nav must link Platform")
	}
}
