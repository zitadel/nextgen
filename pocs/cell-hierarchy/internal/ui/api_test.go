package ui

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAPIV1CellsReturnsJSON(t *testing.T) {
	_, _, _, mux := startPlatformEU(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cells", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Fatalf("content-type=%q want json", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	tree, ok := body["tree"].([]any)
	if !ok || len(tree) == 0 {
		t.Fatalf("expected tree array, got %+v", body["tree"])
	}
}

func TestSPAAssetsServed(t *testing.T) {
	_, _, _, mux := startPlatformEU(t)
	for _, path := range []string{"/", "/platform", "/workspaces", "/projects/acme", "/assets/app.js", "/assets/app.css"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d", path, rec.Code)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, `/assets/app.js`) {
		t.Fatal("SPA shell must reference app.js")
	}
	if !strings.Contains(body, "id=\"request-log\"") {
		t.Fatal("SPA shell must include request log")
	}
	if strings.Contains(body, "trace-drawer") || strings.Contains(body, "Global Trace") {
		t.Fatal("SPA must not include sticky Global Trace drawer")
	}
}

func TestAPICreateWorkspaceJSON(t *testing.T) {
	app, _, euURL, mux := startPlatformEU(t)
	body := `{"id":"demo","name":"Demo","cell":"eu-1","customer_team_id":"acme"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create workspace status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["ok"] == nil {
		t.Fatalf("expected ok message: %+v", out)
	}
	if out["timeline"] == nil {
		t.Fatal("mutating response should include timeline")
	}
	projects, err := app.Peer.ListProjects(context.Background(), euURL)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range projects {
		if p.ID == "demo" {
			found = true
			if p.ParentProjectID != "" {
				t.Fatalf("parent=%q want empty", p.ParentProjectID)
			}
			break
		}
	}
	if !found {
		t.Fatal("demo project not created on eu-1")
	}
}
