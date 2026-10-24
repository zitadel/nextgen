package ui

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func postJSON(t *testing.T, mux http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if strings.Contains(path, "{") {
		t.Fatal("use concrete path")
	}
	// Set path values for Go 1.22+ ServeMux patterns when needed by callers via SetPathValue.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestWorkspaceCreateRequiresCellAndTeam(t *testing.T) {
	app, _, euURL, mux := startPlatformEU(t)

	rec := postJSON(t, mux, "/api/v1/workspaces",
		`{"id":"demo","name":"Demo","cell":"eu-1","customer_team_id":"acme"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create workspace status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if errMsg, _ := out["error"].(string); errMsg != "" {
		t.Fatalf("create failed: %s", errMsg)
	}
	redir, _ := out["redirect"].(string)
	if !strings.HasPrefix(redir, "/projects/demo") {
		t.Fatalf("expected redirect to /projects/demo, got %v", out["redirect"])
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
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/demo/users",
		strings.NewReader(`{"email":"root@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "demo")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create user: %s", rec.Body.String())
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

	rec := postJSON(t, mux, "/api/v1/workspaces",
		`{"id":"acme","name":"Acme","cell":"eu-1","customer_team_id":"acme"}`)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"error"`) {
		t.Fatalf("create workspace: %s", rec.Body.String())
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/acme/sites", strings.NewReader(
		`{"id":"acme-us2","name":"acme-us2","cell":"us-2","parent_project_id":"acme","workspace_id":"acme"}`))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "acme")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"error"`) {
		t.Fatalf("add site: %s", rec.Body.String())
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

	req = httptest.NewRequest(http.MethodPost, "/api/v1/projects/acme-us2/users",
		strings.NewReader(`{"email":"joe@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "acme-us2")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"error"`) {
		t.Fatalf("create user: %s", rec.Body.String())
	}

	// Float to parent is async on the cell — poll until visible.
	var parentRaw struct {
		Lookup []lookupRow `json:"lookup"`
	}
	floated := false
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := app.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(euURL)+"/v1/projects/acme", nil, "", &parentRaw); err != nil {
			t.Fatal(err)
		}
		for _, e := range parentRaw.Lookup {
			if e.Key == "joe@example.com" && e.HomeProjectID == "acme-us2" {
				floated = true
				if e.Source != "child" {
					t.Fatalf("provenance source=%s want child", e.Source)
				}
				break
			}
		}
		if floated {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !floated {
		t.Fatalf("expected floated key on parent acme: %+v", parentRaw.Lookup)
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
		if e.Key == "joe@example.com" {
			t.Fatalf("platform lookup must not hold customer float; got %+v", e)
		}
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/projects/acme/lookup",
		strings.NewReader(`{"key":"joe@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "acme")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("lookup: %s", rec.Body.String())
	}
	var lookOut map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &lookOut); err != nil {
		t.Fatal(err)
	}
	okMsg, _ := lookOut["ok"].(string)
	if !strings.Contains(okMsg, "hit") {
		t.Fatalf("lookup ok=%q want hit", okMsg)
	}
	tlRaw, ok := lookOut["timeline"].(map[string]any)
	if !ok || tlRaw == nil {
		t.Fatal("lookup response must include timeline")
	}

	lt := app.latestTrace()
	if lt == nil {
		t.Fatal("expected latest trace after lookup")
	}
	tl := app.latestTimeline()
	if tl == nil || tl.StepCount < 1 {
		t.Fatalf("expected timeline steps after lookup, got %+v", tl)
	}
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
	if !strings.Contains(body, `href="/platform"`) && !strings.Contains(body, `data-nav="platform"`) {
		t.Fatal("nav must link Platform")
	}
}
