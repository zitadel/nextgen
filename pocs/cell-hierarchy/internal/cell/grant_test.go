package cell_test

import (
	"io"
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestGrantJoeOnUSChatCreatesTupleAndHomeInterest(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	defer c2()
	eu2, eu2URL, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()
	us, usURL, c4 := startCell(t, "http://us", "us", false)
	defer c4()

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu2, "team-eu-2", false, false)
	createProject(t, us, "us", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)
	attachProject(t, us, "us", "platform", platformURL)

	created := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{
		"email": "joe@example.com",
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create joe status=%d body=%s", created.StatusCode, body)
	}

	appRes := postJSON(t, us, "/v1/projects/us/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()
	if appRes.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(appRes.Body)
		t.Fatalf("create app status=%d body=%s", appRes.StatusCode, body)
	}

	grant := postJSON(t, us, "/v1/projects/us/tuples", map[string]any{
		"object":   "app:chat",
		"relation": "viewer",
		"user_key": "joe@example.com",
	})
	defer grant.Body.Close()
	if grant.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(grant.Body)
		t.Fatalf("grant status=%d body=%s", grant.StatusCode, body)
	}
	var grantBody struct {
		Tuple cell.TupleView  `json:"tuple"`
		Trace []cell.TraceHop `json:"trace"`
	}
	decode(t, grant, &grantBody)
	if grantBody.Tuple.ProjectID != "us" {
		t.Fatalf("tuple project=%s", grantBody.Tuple.ProjectID)
	}
	if grantBody.Tuple.HomeProjectID != "team-eu-2" {
		t.Fatalf("home_project_id=%s", grantBody.Tuple.HomeProjectID)
	}
	if grantBody.Tuple.Object != "app:chat" || grantBody.Tuple.Relation != "viewer" {
		t.Fatalf("tuple=%+v", grantBody.Tuple)
	}
	foundInterestHop := false
	for _, hop := range grantBody.Trace {
		if hop.Method == "POST /v1/interests" && hop.Result == "registered" {
			foundInterestHop = true
			if hop.Cell != eu2URL {
				t.Fatalf("interest hop cell=%s want %s", hop.Cell, eu2URL)
			}
		}
	}
	if !foundInterestHop {
		t.Fatalf("expected interest register hop in trace=%+v", grantBody.Trace)
	}

	// Tuple only on us cell store.
	usTuples := getJSON(t, us, "/v1/projects/us/tuples")
	defer usTuples.Body.Close()
	var usList struct {
		Tuples []cell.TupleView `json:"tuples"`
	}
	decode(t, usTuples, &usList)
	if len(usList.Tuples) != 1 {
		t.Fatalf("us tuples=%d want 1", len(usList.Tuples))
	}

	eu2Tuples := getJSON(t, eu2, "/v1/projects/team-eu-2/tuples")
	defer eu2Tuples.Body.Close()
	var eu2List struct {
		Tuples []cell.TupleView `json:"tuples"`
	}
	decode(t, eu2Tuples, &eu2List)
	if len(eu2List.Tuples) != 0 {
		t.Fatalf("eu-2 must have no tuples, got %d", len(eu2List.Tuples))
	}

	// Interest appears on home (eu-2).
	interests := getJSON(t, eu2, "/v1/interests?home_project_id=team-eu-2")
	defer interests.Body.Close()
	var interestList struct {
		Interests []cell.InterestView `json:"interests"`
	}
	decode(t, interests, &interestList)
	if len(interestList.Interests) != 1 {
		t.Fatalf("interests=%d want 1", len(interestList.Interests))
	}
	i := interestList.Interests[0]
	if i.PrincipalKey != "joe@example.com" {
		t.Fatalf("principal=%s", i.PrincipalKey)
	}
	if i.SubscriberProjectID != "us" {
		t.Fatalf("subscriber_project=%s", i.SubscriberProjectID)
	}
	if i.TupleID != grantBody.Tuple.ID {
		t.Fatalf("tuple_id=%s want %s", i.TupleID, grantBody.Tuple.ID)
	}
	if cell.NormalizeURL(i.SubscriberCellURL) != cell.NormalizeURL(usURL) {
		t.Fatalf("subscriber_cell=%s want %s", i.SubscriberCellURL, usURL)
	}

	// Joe user row still only on eu-2.
	eu2Proj := getJSON(t, eu2, "/v1/projects/team-eu-2")
	defer eu2Proj.Body.Close()
	var eu2Detail struct {
		Users []struct {
			Email string `json:"email"`
		} `json:"users"`
	}
	decode(t, eu2Proj, &eu2Detail)
	foundJoe := false
	for _, u := range eu2Detail.Users {
		if u.Email == "joe@example.com" {
			foundJoe = true
		}
	}
	if !foundJoe {
		t.Fatal("joe must remain a user on team-eu-2")
	}

	usProj := getJSON(t, us, "/v1/projects/us")
	defer usProj.Body.Close()
	var usDetail struct {
		Users []struct {
			Email string `json:"email"`
		} `json:"users"`
	}
	decode(t, usProj, &usDetail)
	for _, u := range usDetail.Users {
		if u.Email == "joe@example.com" {
			t.Fatal("joe user row must not exist on us")
		}
	}

	platformInterests := getJSON(t, platform, "/v1/interests")
	defer platformInterests.Body.Close()
	var platList struct {
		Interests []cell.InterestView `json:"interests"`
	}
	decode(t, platformInterests, &platList)
	if len(platList.Interests) != 0 {
		t.Fatalf("platform must not store interests, got %d", len(platList.Interests))
	}
}

func TestCreateAppAndListOnProject(t *testing.T) {
	us, _, c := startCell(t, "http://us", "us", false)
	defer c()
	createProject(t, us, "us", false, false)

	res := postJSON(t, us, "/v1/projects/us/apps", map[string]any{"name": "chat"})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}

	dup := postJSON(t, us, "/v1/projects/us/apps", map[string]any{"name": "chat"})
	defer dup.Body.Close()
	if dup.StatusCode != http.StatusConflict {
		t.Fatalf("dup status=%d", dup.StatusCode)
	}

	listed := getJSON(t, us, "/v1/projects/us/apps")
	defer listed.Body.Close()
	var body struct {
		Apps []cell.AppView `json:"apps"`
	}
	decode(t, listed, &body)
	if len(body.Apps) != 1 || body.Apps[0].Name != "chat" {
		t.Fatalf("apps=%+v", body.Apps)
	}
}

func TestGrantFailsWhenPrincipalNotFloated(t *testing.T) {
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

	// Local-only joe (defer float) — walk from us misses at platform.
	created := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{
		"email": "joe@example.com", "defer_float": true,
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d", created.StatusCode)
	}

	appRes := postJSON(t, us, "/v1/projects/us/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()

	grant := postJSON(t, us, "/v1/projects/us/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer", "user_key": "joe@example.com",
	})
	defer grant.Body.Close()
	if grant.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(grant.Body)
		t.Fatalf("status=%d body=%s want 404", grant.StatusCode, body)
	}
	assertError(t, grant, "principal_not_found")
}
