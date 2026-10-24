package cell_test

import (
	"io"
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestGrantJoeOnSiblingSiteCreatesTupleAndHomeInterest(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, eu1URL, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()
	us1, us1URL, c3 := startCell(t, "http://us-1", "us-1", false)
	defer c3()

	createProject(t, platform, "platform", true, true)
	createProjectWS(t, eu1, "acme-fra", "acme", false, false)
	createProjectWS(t, us1, "acme-iowa", "acme", false, false)
	attachProject(t, eu1, "acme-fra", "platform", platformURL)
	attachProject(t, us1, "acme-iowa", "platform", platformURL)

	created := postJSON(t, eu1, "/v1/projects/acme-fra/users", map[string]any{
		"email": "joe@example.com",
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create joe status=%d body=%s", created.StatusCode, body)
	}

	appRes := postJSON(t, us1, "/v1/projects/acme-iowa/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()
	if appRes.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(appRes.Body)
		t.Fatalf("create app status=%d body=%s", appRes.StatusCode, body)
	}

	grant := postJSON(t, us1, "/v1/projects/acme-iowa/tuples", map[string]any{
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
	if grantBody.Tuple.ProjectID != "acme-iowa" {
		t.Fatalf("tuple project=%s", grantBody.Tuple.ProjectID)
	}
	if grantBody.Tuple.HomeProjectID != "acme-fra" {
		t.Fatalf("home_project_id=%s", grantBody.Tuple.HomeProjectID)
	}

	foundInterestHop := false
	for _, hop := range grantBody.Trace {
		if hop.Method == "POST /v1/interests" && hop.Result == "registered" {
			foundInterestHop = true
			if hop.Cell != eu1URL {
				t.Fatalf("interest hop cell=%s want %s", hop.Cell, eu1URL)
			}
		}
	}
	if !foundInterestHop {
		t.Fatalf("expected interest register hop in trace=%+v", grantBody.Trace)
	}

	usTuples := getJSON(t, us1, "/v1/projects/acme-iowa/tuples")
	defer usTuples.Body.Close()
	var usList struct {
		Tuples []cell.TupleView `json:"tuples"`
	}
	decode(t, usTuples, &usList)
	if len(usList.Tuples) != 1 {
		t.Fatalf("iowa tuples=%d want 1", len(usList.Tuples))
	}

	homeTuples := getJSON(t, eu1, "/v1/projects/acme-fra/tuples")
	defer homeTuples.Body.Close()
	var homeList struct {
		Tuples []cell.TupleView `json:"tuples"`
	}
	decode(t, homeTuples, &homeList)
	if len(homeList.Tuples) != 0 {
		t.Fatalf("home must have no grant tuples, got %d", len(homeList.Tuples))
	}

	interests := getJSON(t, eu1, "/v1/interests?home_project_id=acme-fra")
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
	if i.SubscriberProjectID != "acme-iowa" {
		t.Fatalf("subscriber_project=%s", i.SubscriberProjectID)
	}
	if cell.NormalizeURL(i.SubscriberCellURL) != cell.NormalizeURL(us1URL) {
		t.Fatalf("subscriber_cell=%s want %s", i.SubscriberCellURL, us1URL)
	}

	homeProj := getJSON(t, eu1, "/v1/projects/acme-fra")
	defer homeProj.Body.Close()
	var homeDetail struct {
		Users []struct {
			Email string `json:"email"`
		} `json:"users"`
	}
	decode(t, homeProj, &homeDetail)
	foundJoe := false
	for _, u := range homeDetail.Users {
		if u.Email == "joe@example.com" {
			foundJoe = true
		}
	}
	if !foundJoe {
		t.Fatal("joe must remain a user on acme-fra")
	}

	iowaProj := getJSON(t, us1, "/v1/projects/acme-iowa")
	defer iowaProj.Body.Close()
	var iowaDetail struct {
		Users []struct {
			Email string `json:"email"`
		} `json:"users"`
	}
	decode(t, iowaProj, &iowaDetail)
	for _, u := range iowaDetail.Users {
		if u.Email == "joe@example.com" {
			t.Fatal("joe user row must not exist on acme-iowa")
		}
	}
}

func TestCreateAppAndListOnProject(t *testing.T) {
	us1, _, c := startCell(t, "http://us-1", "us-1", false)
	defer c()
	createProjectWS(t, us1, "acme-iowa", "acme", false, false)

	res := postJSON(t, us1, "/v1/projects/acme-iowa/apps", map[string]any{"name": "chat"})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}

	dup := postJSON(t, us1, "/v1/projects/acme-iowa/apps", map[string]any{"name": "chat"})
	defer dup.Body.Close()
	if dup.StatusCode != http.StatusConflict {
		t.Fatalf("dup status=%d", dup.StatusCode)
	}

	listed := getJSON(t, us1, "/v1/projects/acme-iowa/apps")
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
	eu1, _, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()
	us1, _, c3 := startCell(t, "http://us-1", "us-1", false)
	defer c3()

	createProject(t, platform, "platform", true, true)
	createProjectWS(t, eu1, "acme-fra", "acme", false, false)
	createProjectWS(t, us1, "acme-iowa", "acme", false, false)
	attachProject(t, eu1, "acme-fra", "platform", platformURL)
	attachProject(t, us1, "acme-iowa", "platform", platformURL)

	created := postJSON(t, eu1, "/v1/projects/acme-fra/users", map[string]any{
		"email": "joe@example.com", "defer_float": true,
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d", created.StatusCode)
	}

	appRes := postJSON(t, us1, "/v1/projects/acme-iowa/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()

	grant := postJSON(t, us1, "/v1/projects/acme-iowa/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer", "user_key": "joe@example.com",
	})
	defer grant.Body.Close()
	if grant.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(grant.Body)
		t.Fatalf("status=%d body=%s want 404", grant.StatusCode, body)
	}
	assertError(t, grant, "principal_not_found")
}
