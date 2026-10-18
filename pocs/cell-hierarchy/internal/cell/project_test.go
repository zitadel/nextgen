package cell_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestFloatUpCreatesAncestorRows(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	defer c2()
	eu2, eu2URL, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu2, "team-eu-2", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)

	res := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{
		"email": "joe@example.com",
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("create user status=%d body=%s", res.StatusCode, body)
	}

	assertLookupHit(t, eu2URL, "team-eu-2", "joe@example.com")
	assertLookupHit(t, euURL, "eu", "joe@example.com")
	assertLookupHit(t, platformURL, "platform", "joe@example.com")
}

func TestLookupFromUSFindsJoeAfterFloat(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	defer c2()
	eu2, _, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()
	us, _, c4 := startCell(t, "http://us", "us", false)
	defer c4()

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu2, "team-eu-2", false, false)
	createProject(t, us, "us", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)
	attachProject(t, us, "us", "platform", platformURL)

	miss := postJSON(t, us, "/v1/lookup/walk", map[string]any{
		"project_id": "us",
		"key":        "joe@example.com",
	})
	defer miss.Body.Close()
	var missBody struct {
		Hit bool `json:"hit"`
	}
	decode(t, miss, &missBody)
	if missBody.Hit {
		t.Fatal("expected miss before float")
	}

	created := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{
		"email": "joe@example.com",
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create status=%d body=%s", created.StatusCode, body)
	}

	hit := postJSON(t, us, "/v1/lookup/walk", map[string]any{
		"project_id": "us",
		"key":        "joe@example.com",
	})
	defer hit.Body.Close()
	var hitBody struct {
		Hit           bool   `json:"hit"`
		HomeProjectID string `json:"home_project_id"`
		FoundAt       string `json:"found_at"`
	}
	decode(t, hit, &hitBody)
	if !hitBody.Hit {
		t.Fatal("expected hit after float")
	}
	if hitBody.HomeProjectID != "team-eu-2" {
		t.Fatalf("home_project_id=%s", hitBody.HomeProjectID)
	}
	if hitBody.FoundAt != "platform" {
		t.Fatalf("found_at=%s want platform", hitBody.FoundAt)
	}
}

func TestLookupMissWhenEntryAbsentAndConflictOnDuplicate(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	defer c2()
	eu1, _, c3 := startCell(t, "http://eu-1", "eu-1", false)
	defer c3()
	eu2, _, c4 := startCell(t, "http://eu-2", "eu-2", false)
	defer c4()

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu1, "team-eu-1", false, false)
	createProject(t, eu2, "team-eu-2", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu1, "team-eu-1", "eu", euURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)

	localMiss := postJSON(t, platform, "/v1/lookup", map[string]any{
		"project_id": "platform",
		"key":        "missing@example.com",
	})
	defer localMiss.Body.Close()
	var missBody struct {
		Hit bool `json:"hit"`
	}
	decode(t, localMiss, &missBody)
	if missBody.Hit {
		t.Fatal("expected local miss")
	}

	a := postJSON(t, eu1, "/v1/projects/team-eu-1/users", map[string]any{"email": "alice@example.com"})
	defer a.Body.Close()
	if a.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(a.Body)
		t.Fatalf("alice status=%d body=%s", a.StatusCode, body)
	}

	b := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{"email": "alice@example.com"})
	defer b.Body.Close()
	if b.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(b.Body)
		t.Fatalf("duplicate status=%d body=%s want conflict", b.StatusCode, body)
	}
	assertError(t, b, "lookup_conflict")
}

func TestLookupNeverCallsChildren(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	defer c2()
	eu2, eu2URL, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu2, "team-eu-2", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)

	created := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{
		"email":       "joe@example.com",
		"defer_float": true,
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create status=%d body=%s", created.StatusCode, body)
	}

	res := postJSON(t, platform, "/v1/lookup", map[string]any{
		"project_id": "platform",
		"key":        "joe@example.com",
	})
	defer res.Body.Close()
	var body struct {
		Hit   bool            `json:"hit"`
		Trace []cell.TraceHop `json:"trace"`
	}
	decode(t, res, &body)
	if body.Hit {
		t.Fatal("platform lookup must not find child-only rows")
	}
	if len(body.Trace) != 1 || body.Trace[0].Result != "miss" {
		t.Fatalf("trace=%+v", body.Trace)
	}

	walk := postJSON(t, platform, "/v1/lookup/walk", map[string]any{
		"project_id": "platform",
		"key":        "joe@example.com",
	})
	defer walk.Body.Close()
	var walkBody struct {
		Hit   bool            `json:"hit"`
		Trace []cell.TraceHop `json:"trace"`
	}
	decode(t, walk, &walkBody)
	if walkBody.Hit {
		t.Fatal("walk from root must not descend")
	}
	for _, hop := range walkBody.Trace {
		if hop.Cell == eu2URL || hop.Cell == euURL {
			t.Fatalf("walk visited child cell %s", hop.Cell)
		}
	}
	_ = platformURL
}

func TestMissBeforePushHitAfterPush(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	defer c2()
	eu2, _, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()
	us, _, c4 := startCell(t, "http://us", "us", false)
	defer c4()

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu2, "team-eu-2", false, false)
	createProject(t, us, "us", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)
	attachProject(t, us, "us", "platform", platformURL)

	created := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{
		"email":       "joe@example.com",
		"defer_float": true,
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d", created.StatusCode)
	}

	before := postJSON(t, us, "/v1/lookup/walk", map[string]any{
		"project_id": "us", "key": "joe@example.com",
	})
	defer before.Body.Close()
	var beforeBody struct {
		Hit bool `json:"hit"`
	}
	decode(t, before, &beforeBody)
	if beforeBody.Hit {
		t.Fatal("expected miss before push")
	}

	floated := postJSON(t, eu2, "/v1/projects/team-eu-2/float", map[string]any{"key": "joe@example.com"})
	defer floated.Body.Close()
	if floated.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(floated.Body)
		t.Fatalf("float status=%d body=%s", floated.StatusCode, body)
	}

	after := postJSON(t, us, "/v1/lookup/walk", map[string]any{
		"project_id": "us", "key": "joe@example.com",
	})
	defer after.Body.Close()
	var afterBody struct {
		Hit bool `json:"hit"`
	}
	decode(t, after, &afterBody)
	if !afterBody.Hit {
		t.Fatal("expected hit after push")
	}
}

func TestFloatDelayHook(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	usStore := mustOpenStore(t, "http://us", "us", false)
	defer usStore.Close()
	srv := cell.NewServer(usStore, cell.NewPeerClient(), nil)
	srv.FloatDelay = 80 * time.Millisecond
	us := httptest.NewServer(srv.Handler())
	defer us.Close()
	rewriteMetaURL(t, usStore, us.URL)

	createProject(t, platform, "platform", true, true)
	createProject(t, us, "us", false, false)
	attachProject(t, us, "us", "platform", platformURL)

	start := time.Now()
	res := postJSON(t, us, "/v1/projects/us/users", map[string]any{"email": "delayed@example.com"})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}
	elapsed := time.Since(start)
	if elapsed < 80*time.Millisecond {
		t.Fatalf("expected float delay, elapsed=%s", elapsed)
	}
	assertLookupHit(t, platformURL, "platform", "delayed@example.com")
}

func createProject(t *testing.T, ts *httptest.Server, id string, isParent, lookup bool) {
	t.Helper()
	res := postJSON(t, ts, "/v1/projects", map[string]any{
		"id": id, "name": id, "is_parent": isParent, "lookup_enabled": lookup,
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("create project %s status=%d body=%s", id, res.StatusCode, body)
	}
}

func attachProject(t *testing.T, ts *httptest.Server, id, parentID, parentCellURL string) {
	t.Helper()
	res := postJSON(t, ts, "/v1/projects/"+id+"/attach", map[string]any{
		"parent_project_id": parentID,
		"parent_cell_url":   parentCellURL,
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("attach %s status=%d body=%s", id, res.StatusCode, body)
	}
}

func assertLookupHit(t *testing.T, cellURL, projectID, key string) {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"project_id": projectID, "key": key})
	res, err := http.Post(cellURL+"/v1/lookup", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body struct {
		Hit bool `json:"hit"`
	}
	decode(t, res, &body)
	if !body.Hit {
		t.Fatalf("expected hit for %s on %s/%s", key, cellURL, projectID)
	}
}

func mustOpenStore(t *testing.T, url, label string, isParent bool) *cell.Store {
	t.Helper()
	dir := t.TempDir()
	store, err := cell.OpenStore(dir+"/cell.db", url, label, isParent)
	if err != nil {
		t.Fatal(err)
	}
	return store
}
