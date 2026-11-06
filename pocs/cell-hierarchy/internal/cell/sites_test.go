package cell_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestBootstrapTopologyJoinsUnderPlatform(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, _, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()
	eu2, _, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()
	us1, _, c4 := startCell(t, "http://us-1", "us-1", false)
	defer c4()
	us2, _, c5 := startCell(t, "http://us-2", "us-2", false)
	defer c5()

	joinOnce(t, platform, eu1, platformURL)
	joinOnce(t, platform, eu2, platformURL)
	joinOnce(t, platform, us1, platformURL)
	joinOnce(t, platform, us2, platformURL)

	children := getJSON(t, platform, "/v1/children")
	defer children.Body.Close()
	var listed struct {
		Children []struct {
			ChildURL string `json:"child_url"`
		} `json:"children"`
	}
	decode(t, children, &listed)
	if len(listed.Children) != 4 {
		t.Fatalf("platform children=%d want 4", len(listed.Children))
	}
	assertJoinedTo(t, eu1, platformURL)
	assertJoinedTo(t, eu2, platformURL)
	assertJoinedTo(t, us1, platformURL)
	assertJoinedTo(t, us2, platformURL)
}

func assertJoinedTo(t *testing.T, leaf *httptest.Server, parentURL string) {
	t.Helper()
	me := getJSON(t, leaf, "/v1/me")
	defer me.Body.Close()
	var body cell.MeResponse
	decode(t, me, &body)
	if body.ParentURL != parentURL || body.Status != "joined" {
		t.Fatalf("me=%+v want parent=%s joined", body, parentURL)
	}
}

func TestExpandCreatesSiblingSiteOnUS1(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, _, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()
	us1, _, c3 := startCell(t, "http://us-1", "us-1", false)
	defer c3()

	createProject(t, platform, "platform", true, true)
	createProjectWS(t, eu1, "acme-fra", "acme", false, false)
	attachProject(t, eu1, "acme-fra", "platform", platformURL)

	createProjectWS(t, us1, "acme-iowa", "acme", false, false)
	attachProject(t, us1, "acme-iowa", "platform", platformURL)
	appRes := postJSON(t, us1, "/v1/projects/acme-iowa/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()
	if appRes.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(appRes.Body)
		t.Fatalf("create chat status=%d body=%s", appRes.StatusCode, body)
	}

	proj := getJSON(t, us1, "/v1/projects/acme-iowa")
	defer proj.Body.Close()
	var body struct {
		Project struct {
			ID              string `json:"id"`
			WorkspaceID     string `json:"workspace_id"`
			ParentProjectID string `json:"parent_project_id"`
		} `json:"project"`
		Apps []struct {
			Name string `json:"name"`
		} `json:"apps"`
	}
	decode(t, proj, &body)
	if body.Project.WorkspaceID != "acme" {
		t.Fatalf("workspace_id=%s", body.Project.WorkspaceID)
	}
	if body.Project.ParentProjectID != "platform" {
		t.Fatalf("parent=%s", body.Project.ParentProjectID)
	}
	if len(body.Apps) != 1 || body.Apps[0].Name != "chat" {
		t.Fatalf("apps=%+v", body.Apps)
	}
}

func TestOrphanWorkspaceUserDoesNotFloatToPlatform(t *testing.T) {
	platform, _, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, _, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()

	createProject(t, platform, "platform", true, true)
	// Workspace root with lookup enabled but NO attach to platform.
	createProjectWS(t, eu1, "acme", "acme", false, true)

	created := postJSON(t, eu1, "/v1/projects/acme/users", map[string]any{"email": "orphan@example.com"})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("status=%d body=%s", created.StatusCode, body)
	}

	plat := getJSON(t, platform, "/v1/projects/platform")
	defer plat.Body.Close()
	var platBody struct {
		Lookup []struct {
			Key string `json:"key"`
		} `json:"lookup"`
	}
	decode(t, plat, &platBody)
	for _, e := range platBody.Lookup {
		if e.Key == "orphan@example.com" {
			t.Fatalf("platform lookup must stay empty for orphan workspace user; got %+v", platBody.Lookup)
		}
	}

	home := getJSON(t, eu1, "/v1/projects/acme")
	defer home.Body.Close()
	var homeBody struct {
		Lookup []struct {
			Key    string `json:"key"`
			Source string `json:"source"`
		} `json:"lookup"`
	}
	decode(t, home, &homeBody)
	found := false
	for _, e := range homeBody.Lookup {
		if e.Key == "orphan@example.com" {
			found = true
			if e.Source != "local" {
				t.Fatalf("source=%s want local", e.Source)
			}
		}
	}
	if !found {
		t.Fatal("expected local lookup on workspace root")
	}
}

func TestLookupProvenanceChildVsLocal(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, _, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()

	createProject(t, platform, "platform", true, true)
	createProjectWS(t, eu1, "acme-fra", "acme", false, false)
	attachProject(t, eu1, "acme-fra", "platform", platformURL)

	created := postJSON(t, eu1, "/v1/projects/acme-fra/users", map[string]any{"email": "joe@example.com"})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("status=%d body=%s", created.StatusCode, body)
	}

	local := getJSON(t, eu1, "/v1/projects/acme-fra")
	defer local.Body.Close()
	var homeBody struct {
		Lookup []struct {
			Key        string `json:"key"`
			Source     string `json:"source"`
			ViaProject string `json:"via_project"`
		} `json:"lookup"`
	}
	decode(t, local, &homeBody)
	foundLocal := false
	for _, e := range homeBody.Lookup {
		if e.Key == "joe@example.com" {
			foundLocal = true
			if e.Source != "local" {
				t.Fatalf("home source=%s want local", e.Source)
			}
			if e.ViaProject != "" {
				t.Fatalf("home via_project=%q want empty", e.ViaProject)
			}
		}
	}
	if !foundLocal {
		t.Fatal("missing local lookup on home")
	}

	waitLookupHit(t, platformURL, "platform", "joe@example.com")

	plat := getJSON(t, platform, "/v1/projects/platform")
	defer plat.Body.Close()
	var platBody struct {
		Lookup []struct {
			Key        string `json:"key"`
			Source     string `json:"source"`
			ViaProject string `json:"via_project"`
		} `json:"lookup"`
	}
	decode(t, plat, &platBody)
	foundChild := false
	for _, e := range platBody.Lookup {
		if e.Key == "joe@example.com" {
			foundChild = true
			if e.Source != "child" {
				t.Fatalf("platform source=%s want child", e.Source)
			}
			if e.ViaProject != "acme-fra" {
				t.Fatalf("via_project=%s want acme-fra", e.ViaProject)
			}
		}
	}
	if !foundChild {
		t.Fatal("missing floated lookup on platform")
	}
}

func TestGlobalLoginDiscoveryFindsJoeAtAcmeFra(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, eu1URL, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()

	createProject(t, platform, "platform", true, true)
	createProjectWS(t, eu1, "acme-fra", "acme", false, false)
	attachProject(t, eu1, "acme-fra", "platform", platformURL)

	created := postJSON(t, eu1, "/v1/projects/acme-fra/users", map[string]any{"email": "joe@example.com"})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("status=%d body=%s", created.StatusCode, body)
	}
	waitLookupHit(t, platformURL, "platform", "joe@example.com")

	walk := postJSON(t, platform, "/v1/lookup/walk", map[string]any{
		"project_id": "platform", "key": "joe@example.com",
	})
	defer walk.Body.Close()
	var body struct {
		Hit           bool   `json:"hit"`
		HomeProjectID string `json:"home_project_id"`
		HomeCellURL   string `json:"home_cell_url"`
		FoundAt       string `json:"found_at"`
	}
	decode(t, walk, &body)
	if !body.Hit {
		t.Fatal("expected hit from platform")
	}
	if body.HomeProjectID != "acme-fra" {
		t.Fatalf("home_project=%s", body.HomeProjectID)
	}
	if body.HomeCellURL != eu1URL {
		t.Fatalf("home_cell=%s want %s", body.HomeCellURL, eu1URL)
	}
	if body.FoundAt != "platform" {
		t.Fatalf("found_at=%s", body.FoundAt)
	}
}

func TestEnableParentFlipsLeaf(t *testing.T) {
	leaf, _, cleanup := startCell(t, "http://eu-1", "eu-1", false)
	defer cleanup()

	prep := postJSON(t, leaf, "/v1/join/prepare", map[string]any{})
	defer prep.Body.Close()
	if prep.StatusCode != http.StatusBadRequest {
		t.Fatalf("leaf prepare before enable status=%d", prep.StatusCode)
	}

	en := postJSON(t, leaf, "/v1/admin/enable-parent", map[string]any{})
	defer en.Body.Close()
	if en.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(en.Body)
		t.Fatalf("enable-parent status=%d body=%s", en.StatusCode, body)
	}

	prep2 := postJSON(t, leaf, "/v1/join/prepare", map[string]any{})
	defer prep2.Body.Close()
	if prep2.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(prep2.Body)
		t.Fatalf("prepare after enable status=%d body=%s", prep2.StatusCode, body)
	}
}

func TestGrantDeleteTombstoneAcrossSites(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, _, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()
	us1, us1URL, c3 := startCell(t, "http://us-1", "us-1", false)
	defer c3()
	spare, spareURL, c4 := startCell(t, "http://spare", "spare", false)
	defer c4()

	createProject(t, platform, "platform", true, true)
	createProjectWS(t, eu1, "acme-fra", "acme", false, false)
	createProjectWS(t, us1, "acme-iowa", "acme", false, false)
	createProject(t, spare, "orphan", false, false)
	attachProject(t, eu1, "acme-fra", "platform", platformURL)
	attachProject(t, us1, "acme-iowa", "platform", platformURL)

	created := postJSON(t, eu1, "/v1/projects/acme-fra/users", map[string]any{"email": "joe@example.com"})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create joe status=%d body=%s", created.StatusCode, body)
	}
	// Create returns before parent float finishes.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if lookupHit(t, platformURL, "platform", "joe@example.com") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !lookupHit(t, platformURL, "platform", "joe@example.com") {
		t.Fatal("expected async float of joe onto platform")
	}

	appRes := postJSON(t, us1, "/v1/projects/acme-iowa/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()
	grant := postJSON(t, us1, "/v1/projects/acme-iowa/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer", "user_key": "joe@example.com",
	})
	defer grant.Body.Close()
	if grant.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(grant.Body)
		t.Fatalf("grant status=%d body=%s", grant.StatusCode, body)
	}

	del := postJSON(t, eu1, "/v1/projects/acme-fra/users/joe@example.com/delete", map[string]any{})
	defer del.Body.Close()
	if del.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(del.Body)
		t.Fatalf("delete status=%d body=%s", del.StatusCode, body)
	}
	var deleted cell.DeleteUserResponse
	decode(t, del, &deleted)
	async := false
	for _, hop := range deleted.Trace {
		if hop.Method == "remote cleanup" && strings.Contains(hop.Result, "started_async") {
			async = true
		}
	}
	if !async {
		t.Fatalf("expected async remote cleanup marker; trace=%+v", deleted.Trace)
	}
	_ = us1URL
	_ = spareURL

	// Subscriber tombstone is async — poll.
	found := false
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tuples := getJSON(t, us1, "/v1/projects/acme-iowa/tuples")
		var listed struct {
			Tuples []cell.TupleView `json:"tuples"`
		}
		decode(t, tuples, &listed)
		_ = tuples.Body.Close()
		for _, tup := range listed.Tuples {
			if tup.UserKey == "joe@example.com" {
				if tup.Tombstoned {
					found = true
				}
				break
			}
		}
		if found {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !found {
		t.Fatal("expected tombstoned grant still listed on acme-iowa after async fan-out")
	}
}
