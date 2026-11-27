package cell_test

import (
	"io"
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestCreateUserWithLifecycleTeam(t *testing.T) {
	srv, _, cleanup := startCell(t, "http://eu-1", "eu-1", false)
	defer cleanup()
	createProject(t, srv, "acme-fra", false, false)

	teamRes := postJSON(t, srv, "/v1/projects/acme-fra/teams", map[string]any{"name": "Engineering"})
	defer teamRes.Body.Close()
	if teamRes.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(teamRes.Body)
		t.Fatalf("create team status=%d body=%s", teamRes.StatusCode, body)
	}
	var team cell.TeamView
	decode(t, teamRes, &team)

	created := postJSON(t, srv, "/v1/projects/acme-fra/users", map[string]any{
		"email":                   "owner@example.com",
		"lifecycle_owner_team_id": team.ID,
		"defer_float":             true,
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create user status=%d body=%s", created.StatusCode, body)
	}
	var out cell.CreateUserResponse
	decode(t, created, &out)
	if out.User.LifecycleOwnerTeamID != team.ID {
		t.Fatalf("lifecycle_owner_team_id=%q want %q", out.User.LifecycleOwnerTeamID, team.ID)
	}

	bad := postJSON(t, srv, "/v1/projects/acme-fra/users", map[string]any{
		"email":                   "bad@example.com",
		"lifecycle_owner_team_id": "missing-team",
		"defer_float":             true,
	})
	defer bad.Body.Close()
	assertError(t, bad, "lifecycle_owner_team_not_in_project")

	detail := getJSON(t, srv, "/v1/projects/acme-fra")
	defer detail.Body.Close()
	var body struct {
		Users []cell.UserView `json:"users"`
	}
	decode(t, detail, &body)
	found := false
	for _, u := range body.Users {
		if u.Email == "owner@example.com" {
			found = true
			if u.LifecycleOwnerTeamID != team.ID {
				t.Fatalf("detail team=%q", u.LifecycleOwnerTeamID)
			}
		}
	}
	if !found {
		t.Fatal("user missing from project detail")
	}
}

func TestDeleteTeamBlockedWhenUserReferencesIt(t *testing.T) {
	srv, _, cleanup := startCell(t, "http://eu-1", "eu-1", false)
	defer cleanup()
	createProject(t, srv, "acme-fra", false, false)

	teamRes := postJSON(t, srv, "/v1/projects/acme-fra/teams", map[string]any{"name": "Ops"})
	defer teamRes.Body.Close()
	var team cell.TeamView
	decode(t, teamRes, &team)

	userRes := postJSON(t, srv, "/v1/projects/acme-fra/users", map[string]any{
		"email": "ops@example.com", "lifecycle_owner_team_id": team.ID, "defer_float": true,
	})
	defer userRes.Body.Close()
	if userRes.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(userRes.Body)
		t.Fatalf("create user status=%d body=%s", userRes.StatusCode, body)
	}

	del := deleteJSON(t, srv, "/v1/projects/acme-fra/teams/"+team.ID)
	defer del.Body.Close()
	if del.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(del.Body)
		t.Fatalf("delete team status=%d want 409 body=%s", del.StatusCode, body)
	}
	assertError(t, del, "team_has_users")

	// After user delete, team delete succeeds.
	gone := postJSON(t, srv, "/v1/projects/acme-fra/users/ops@example.com/delete", map[string]any{})
	defer gone.Body.Close()
	if gone.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(gone.Body)
		t.Fatalf("delete user status=%d body=%s", gone.StatusCode, body)
	}
	del2 := deleteJSON(t, srv, "/v1/projects/acme-fra/teams/"+team.ID)
	defer del2.Body.Close()
	if del2.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(del2.Body)
		t.Fatalf("delete team after user gone status=%d body=%s", del2.StatusCode, body)
	}
}

func TestGroupCRUDAndTupleBlocksDelete(t *testing.T) {
	srv, url, cleanup := startCell(t, "http://eu-1", "eu-1", false)
	defer cleanup()
	createProject(t, srv, "acme-fra", false, false)

	gRes := postJSON(t, srv, "/v1/projects/acme-fra/groups", map[string]any{"name": "A"})
	defer gRes.Body.Close()
	if gRes.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(gRes.Body)
		t.Fatalf("create group status=%d body=%s", gRes.StatusCode, body)
	}
	var group cell.GroupView
	decode(t, gRes, &group)
	if group.Name != "A" {
		t.Fatalf("group=%+v", group)
	}

	listed := getJSON(t, srv, "/v1/projects/acme-fra/groups")
	defer listed.Body.Close()
	var list struct {
		Groups []cell.GroupView `json:"groups"`
	}
	decode(t, listed, &list)
	if len(list.Groups) != 1 {
		t.Fatalf("groups=%d", len(list.Groups))
	}

	userRes := postJSON(t, srv, "/v1/projects/acme-fra/users", map[string]any{
		"email": "joe@example.com", "defer_float": true,
	})
	defer userRes.Body.Close()

	tup := postJSON(t, srv, "/v1/projects/acme-fra/tuples", map[string]any{
		"object": "group:A", "relation": "member", "user_key": "joe@example.com",
		"subject_kind": "user", "home_project_id": "acme-fra", "home_cell_url": url,
		"skip_interest": true,
	})
	defer tup.Body.Close()
	if tup.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(tup.Body)
		t.Fatalf("create tuple status=%d body=%s", tup.StatusCode, body)
	}
	var tupBody cell.CreateTupleResponse
	decode(t, tup, &tupBody)

	blocked := deleteJSON(t, srv, "/v1/projects/acme-fra/groups/"+group.ID)
	defer blocked.Body.Close()
	if blocked.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(blocked.Body)
		t.Fatalf("delete group status=%d want 409 body=%s", blocked.StatusCode, body)
	}
	assertError(t, blocked, "group_has_active_tuples")

	tomb := postJSON(t, srv, "/v1/projects/acme-fra/tuples/"+tupBody.Tuple.ID+"/tombstone", map[string]any{})
	defer tomb.Body.Close()
	if tomb.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(tomb.Body)
		t.Fatalf("tombstone status=%d body=%s", tomb.StatusCode, body)
	}
	var tombOut cell.TombstoneTupleResponse
	decode(t, tomb, &tombOut)
	if !tombOut.Tuple.Tombstoned {
		t.Fatal("tuple should be tombstoned")
	}

	ok := deleteJSON(t, srv, "/v1/projects/acme-fra/groups/"+group.ID)
	defer ok.Body.Close()
	if ok.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(ok.Body)
		t.Fatalf("delete group after tombstone status=%d body=%s", ok.StatusCode, body)
	}
}

func TestCreateTupleLocalGroupSubjectRequiresGroup(t *testing.T) {
	srv, url, cleanup := startCell(t, "http://eu-1", "eu-1", false)
	defer cleanup()
	createProject(t, srv, "acme-fra", false, false)

	bad := postJSON(t, srv, "/v1/projects/acme-fra/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer",
		"subject_kind": "group", "user_key": "Missing",
		"home_project_id": "acme-fra", "home_cell_url": url,
	})
	defer bad.Body.Close()
	assertError(t, bad, "group_not_found_in_project")

	gRes := postJSON(t, srv, "/v1/projects/acme-fra/groups", map[string]any{"name": "Missing"})
	defer gRes.Body.Close()
	appRes := postJSON(t, srv, "/v1/projects/acme-fra/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()

	ok := postJSON(t, srv, "/v1/projects/acme-fra/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer",
		"subject_kind": "group", "user_key": "Missing",
	})
	defer ok.Body.Close()
	if ok.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(ok.Body)
		t.Fatalf("create tuple status=%d body=%s", ok.StatusCode, body)
	}
}

func TestTombstoneTupleUnregistersInterest(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, _, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()
	us1, _, c3 := startCell(t, "http://us-1", "us-1", false)
	defer c3()

	createProject(t, platform, "platform", true, true)
	createProjectWS(t, eu1, "acme-fra", "acme", false, false)
	createProjectWS(t, us1, "acme-iowa", "acme", false, false)
	attachProject(t, eu1, "acme-fra", "platform", platformURL)
	attachProject(t, us1, "acme-iowa", "platform", platformURL)

	created := postJSON(t, eu1, "/v1/projects/acme-fra/users", map[string]any{"email": "joe@example.com"})
	defer created.Body.Close()
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
	var grantBody cell.CreateTupleResponse
	decode(t, grant, &grantBody)

	interests := getJSON(t, eu1, "/v1/interests?home_project_id=acme-fra")
	defer interests.Body.Close()
	var before struct {
		Interests []cell.InterestView `json:"interests"`
	}
	decode(t, interests, &before)
	if len(before.Interests) != 1 {
		t.Fatalf("interests before=%d want 1", len(before.Interests))
	}

	tomb := postJSON(t, us1, "/v1/projects/acme-iowa/tuples/"+grantBody.Tuple.ID+"/tombstone", map[string]any{})
	defer tomb.Body.Close()
	if tomb.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(tomb.Body)
		t.Fatalf("tombstone status=%d body=%s", tomb.StatusCode, body)
	}
	var tombOut cell.TombstoneTupleResponse
	decode(t, tomb, &tombOut)
	if !tombOut.Tuple.Tombstoned {
		t.Fatal("expected tombstoned")
	}
	if !tombOut.InterestRemoved {
		t.Fatalf("expected interest removed; trace=%+v", tombOut.Trace)
	}

	after := getJSON(t, eu1, "/v1/interests?home_project_id=acme-fra")
	defer after.Body.Close()
	var afterBody struct {
		Interests []cell.InterestView `json:"interests"`
	}
	decode(t, after, &afterBody)
	if len(afterBody.Interests) != 0 {
		t.Fatalf("interests after=%d want 0", len(afterBody.Interests))
	}

	// App delete blocked while active — after tombstone, delete ok.
	apps := getJSON(t, us1, "/v1/projects/acme-iowa/apps")
	defer apps.Body.Close()
	var appList struct {
		Apps []cell.AppView `json:"apps"`
	}
	decode(t, apps, &appList)
	if len(appList.Apps) != 1 {
		t.Fatalf("apps=%d", len(appList.Apps))
	}
	delApp := deleteJSON(t, us1, "/v1/projects/acme-iowa/apps/"+appList.Apps[0].ID)
	defer delApp.Body.Close()
	if delApp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(delApp.Body)
		t.Fatalf("delete app status=%d body=%s", delApp.StatusCode, body)
	}
}

func TestDeleteAppBlockedByActiveTuple(t *testing.T) {
	srv, url, cleanup := startCell(t, "http://eu-1", "eu-1", false)
	defer cleanup()
	createProject(t, srv, "acme-fra", false, false)
	userRes := postJSON(t, srv, "/v1/projects/acme-fra/users", map[string]any{
		"email": "joe@example.com", "defer_float": true,
	})
	defer userRes.Body.Close()
	appRes := postJSON(t, srv, "/v1/projects/acme-fra/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()
	var app cell.AppView
	decode(t, appRes, &app)

	tup := postJSON(t, srv, "/v1/projects/acme-fra/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer", "user_key": "joe@example.com",
		"home_project_id": "acme-fra", "home_cell_url": url, "skip_interest": true,
	})
	defer tup.Body.Close()
	if tup.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(tup.Body)
		t.Fatalf("tuple status=%d body=%s", tup.StatusCode, body)
	}

	del := deleteJSON(t, srv, "/v1/projects/acme-fra/apps/"+app.ID)
	defer del.Body.Close()
	if del.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(del.Body)
		t.Fatalf("delete app status=%d want 409 body=%s", del.StatusCode, body)
	}
	assertError(t, del, "app_has_active_tuples")
}
