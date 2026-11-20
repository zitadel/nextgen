package cell_test

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestBlockDeniesOnlineAllowsOfflineUntilExpiry(t *testing.T) {
	home, us, cleanup := setupJoeAuthBase(t, true)
	defer cleanup()

	issue := postJSON(t, home, "/v1/token/issue", map[string]any{
		"project_id": "team-eu-2", "sub": "joe@example.com", "aud": "app:chat",
	})
	defer issue.Body.Close()
	var issued cell.IssueTokenResponse
	decode(t, issue, &issued)
	if issued.Claims.Epoch != 1 {
		t.Fatalf("epoch=%d", issued.Claims.Epoch)
	}

	block := postJSON(t, home, "/v1/projects/team-eu-2/users/joe@example.com/block", map[string]any{})
	defer block.Body.Close()
	if block.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(block.Body)
		t.Fatalf("block status=%d body=%s", block.StatusCode, body)
	}
	var blocked cell.BlockUserResponse
	decode(t, block, &blocked)
	if !blocked.User.Blocked || blocked.User.Epoch != 2 {
		t.Fatalf("user=%+v", blocked.User)
	}
	foundPush := false
	for _, hop := range blocked.Trace {
		if hop.Method == "POST /v1/events/user" && strings.Contains(hop.Result, "user.blocked") {
			foundPush = true
			if hop.Cell != us.URL {
				t.Fatalf("block fan-out cell=%s want %s", hop.Cell, us.URL)
			}
		}
	}
	if !foundPush {
		t.Fatalf("expected user.blocked push to us in trace=%+v", blocked.Trace)
	}

	online := postJSON(t, us, "/v1/auth/check", map[string]any{
		"token": issued.Token, "project_id": "us", "object": "app:chat", "relation": "viewer", "online": true,
	})
	defer online.Body.Close()
	var onlineAuth cell.AuthCheckResponse
	decode(t, online, &onlineAuth)
	if onlineAuth.Allowed {
		t.Fatal("online check must deny after block")
	}
	if onlineAuth.Reason != "principal_inactive" && onlineAuth.Reason != "epoch_mismatch" {
		// denylist or principal check both surface as inactive / epoch
		if onlineAuth.Reason != cell.ErrPrincipalInactive.Error() && onlineAuth.Reason != cell.ErrEpochMismatch.Error() {
			t.Fatalf("online reason=%s", onlineAuth.Reason)
		}
	}

	offline := postJSON(t, us, "/v1/auth/check", map[string]any{
		"token": issued.Token, "project_id": "us", "object": "app:chat", "relation": "viewer", "online": false,
	})
	defer offline.Body.Close()
	var offlineAuth cell.AuthCheckResponse
	decode(t, offline, &offlineAuth)
	if !offlineAuth.Allowed {
		t.Fatalf("offline must still allow until exp; reason=%s", offlineAuth.Reason)
	}

	// Simulate expiry: sig still valid, but exp passed → offline would deny.
	jwksRes := getJSON(t, home, "/v1/jwks")
	defer jwksRes.Body.Close()
	var jwks cell.JWKS
	decode(t, jwksRes, &jwks)
	pub, err := cell.PublicKeyFromJWK(jwks.Keys[0])
	if err != nil {
		t.Fatal(err)
	}
	_, err = cell.VerifyToken(issued.Token, pub, time.Unix(issued.Claims.Exp+1, 0))
	if err == nil || err.Error() != "token_expired" {
		t.Fatalf("expected token_expired after simulated exp, got %v", err)
	}

	reissue := postJSON(t, home, "/v1/token/issue", map[string]any{
		"project_id": "team-eu-2", "sub": "joe@example.com", "aud": "app:chat",
	})
	defer reissue.Body.Close()
	if reissue.StatusCode != http.StatusForbidden {
		body, _ := io.ReadAll(reissue.Body)
		t.Fatalf("reissue after block status=%d body=%s", reissue.StatusCode, body)
	}
	assertError(t, reissue, "user_blocked")

	pr := postJSON(t, home, "/v1/principal/check", map[string]any{
		"project_id": "team-eu-2", "sub": "joe@example.com",
	})
	defer pr.Body.Close()
	var principal cell.PrincipalCheckResponse
	decode(t, pr, &principal)
	if principal.Active || !principal.Blocked || principal.Epoch != 2 {
		t.Fatalf("principal=%+v", principal)
	}
}

func TestDeleteRemovesSubscriberTuplesAndTombstonesLookup(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	defer c2()
	eu2, _, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()
	us, usURL, c4 := startCell(t, "http://us", "us", false)
	defer c4()
	aus, _, c5 := startCell(t, "http://aus", "aus", false)
	defer c5()

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu2, "team-eu-2", false, false)
	createProject(t, us, "us", false, false)
	createProject(t, aus, "aus", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)
	attachProject(t, us, "us", "platform", platformURL)
	attachProject(t, aus, "aus", "platform", platformURL)

	created := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{"email": "joe@example.com"})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create joe status=%d body=%s", created.StatusCode, body)
	}

	// Seed group membership on home (skip interest) + direct grant on us (registers interest).
	group := postJSON(t, eu2, "/v1/projects/team-eu-2/tuples", map[string]any{
		"object": "group:A", "relation": "member", "user_key": "joe@example.com",
		"subject_kind": "user", "home_project_id": "team-eu-2", "home_cell_url": eu2.URL,
		"skip_interest": true,
	})
	defer group.Body.Close()
	if group.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(group.Body)
		t.Fatalf("group membership status=%d body=%s", group.StatusCode, body)
	}

	appRes := postJSON(t, us, "/v1/projects/us/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()
	grant := postJSON(t, us, "/v1/projects/us/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer", "user_key": "joe@example.com",
	})
	defer grant.Body.Close()
	if grant.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(grant.Body)
		t.Fatalf("grant status=%d body=%s", grant.StatusCode, body)
	}

	del := postJSON(t, eu2, "/v1/projects/team-eu-2/users/joe@example.com/delete", map[string]any{})
	defer del.Body.Close()
	if del.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(del.Body)
		t.Fatalf("delete status=%d body=%s", del.StatusCode, body)
	}
	var deleted cell.DeleteUserResponse
	decode(t, del, &deleted)
	if deleted.User.DeletedAt == nil || !deleted.User.Blocked {
		t.Fatalf("user=%+v", deleted.User)
	}

	pushedUS, pushedAUS := false, false
	for _, hop := range deleted.Trace {
		if hop.Method == "POST /v1/events/user" {
			if hop.Cell == usURL && strings.Contains(hop.Result, "user.deleted") {
				pushedUS = true
			}
			if hop.Cell == aus.URL {
				pushedAUS = true
			}
		}
	}
	if !pushedUS {
		t.Fatalf("expected user.deleted push to us only; trace=%+v", deleted.Trace)
	}
	if pushedAUS {
		t.Fatal("must not push lifecycle events to cells without interests")
	}

	// Direct grant on us gone.
	tuples := getJSON(t, us, "/v1/projects/us/tuples")
	defer tuples.Body.Close()
	var usTuples struct {
		Tuples []cell.TupleView `json:"tuples"`
	}
	decode(t, tuples, &usTuples)
	for _, tup := range usTuples.Tuples {
		if tup.UserKey == "joe@example.com" {
			t.Fatalf("us still has joe tuple: %+v", tup)
		}
	}

	// Home group membership gone → expand finds no joe.
	homeTuples := getJSON(t, eu2, "/v1/projects/team-eu-2/tuples")
	defer homeTuples.Body.Close()
	var eu2Tuples struct {
		Tuples []cell.TupleView `json:"tuples"`
	}
	decode(t, homeTuples, &eu2Tuples)
	for _, tup := range eu2Tuples.Tuples {
		if tup.UserKey == "joe@example.com" {
			t.Fatalf("home still has joe tuple: %+v", tup)
		}
	}

	// Interests unregistered on home.
	interests := getJSON(t, eu2, "/v1/interests?home_project_id=team-eu-2")
	defer interests.Body.Close()
	var interestList struct {
		Interests []cell.InterestView `json:"interests"`
	}
	decode(t, interests, &interestList)
	for _, i := range interestList.Interests {
		if i.PrincipalKey == "joe@example.com" {
			t.Fatalf("interest still present: %+v", i)
		}
	}

	// Lookup tombstoned at platform (float-up).
	look := postJSON(t, platform, "/v1/lookup", map[string]any{
		"project_id": "platform", "key": "joe@example.com",
	})
	defer look.Body.Close()
	var lookBody struct {
		Hit        bool   `json:"hit"`
		Tombstoned bool   `json:"tombstoned"`
		State      string `json:"state"`
	}
	decode(t, look, &lookBody)
	if lookBody.Hit || !lookBody.Tombstoned || lookBody.State != "tombstone" {
		t.Fatalf("lookup=%+v", lookBody)
	}

	// Group expand on home no longer includes joe.
	expand := postJSON(t, eu2, "/v1/fga/expand", map[string]any{
		"project_id": "team-eu-2", "object": "group:A", "relation": "member",
	})
	defer expand.Body.Close()
	var expanded cell.FGAExpandResponse
	decode(t, expand, &expanded)
	for _, m := range expanded.Members {
		if m.Key == "joe@example.com" {
			t.Fatalf("expand still has joe: %+v", expanded.Members)
		}
	}
}

func TestBlockFanOutOnlyToInterestedCells(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	defer c2()
	eu2, _, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()
	us, usURL, c4 := startCell(t, "http://us", "us", false)
	defer c4()
	aus, ausURL, c5 := startCell(t, "http://aus", "aus", false)
	defer c5()

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu2, "team-eu-2", false, false)
	createProject(t, us, "us", false, false)
	createProject(t, aus, "aus", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)
	attachProject(t, us, "us", "platform", platformURL)
	attachProject(t, aus, "aus", "platform", platformURL)

	created := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{"email": "joe@example.com"})
	defer created.Body.Close()

	appRes := postJSON(t, us, "/v1/projects/us/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()
	grant := postJSON(t, us, "/v1/projects/us/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer", "user_key": "joe@example.com",
	})
	defer grant.Body.Close()
	if grant.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(grant.Body)
		t.Fatalf("grant status=%d body=%s", grant.StatusCode, body)
	}

	block := postJSON(t, eu2, "/v1/projects/team-eu-2/users/joe@example.com/block", map[string]any{})
	defer block.Body.Close()
	var blocked cell.BlockUserResponse
	decode(t, block, &blocked)

	eventCells := map[string]bool{}
	for _, hop := range blocked.Trace {
		if hop.Method == "POST /v1/events/user" {
			eventCells[hop.Cell] = true
		}
	}
	if !eventCells[usURL] {
		t.Fatalf("missing us fan-out; cells=%v trace=%+v", eventCells, blocked.Trace)
	}
	if eventCells[ausURL] || eventCells[platformURL] || eventCells[euURL] {
		t.Fatalf("fan-out leaked to non-subscribers: %v", eventCells)
	}
}

