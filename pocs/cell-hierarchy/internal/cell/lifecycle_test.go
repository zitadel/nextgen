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
	home, resource, cleanup := setupJoeAuthBase(t, true)
	defer cleanup()

	issue := postJSON(t, home, "/v1/token/issue", map[string]any{
		"project_id": "acme-fra", "sub": "joe@example.com", "aud": "app:chat",
	})
	defer issue.Body.Close()
	var issued cell.IssueTokenResponse
	decode(t, issue, &issued)
	if issued.Claims.Epoch != 1 {
		t.Fatalf("epoch=%d", issued.Claims.Epoch)
	}

	block := postJSON(t, home, "/v1/projects/acme-fra/users/joe@example.com/block", map[string]any{})
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
			if hop.Cell != resource.URL {
				t.Fatalf("block fan-out cell=%s want %s", hop.Cell, resource.URL)
			}
		}
	}
	if !foundPush {
		t.Fatalf("expected user.blocked push to resource in trace=%+v", blocked.Trace)
	}

	online := postJSON(t, resource, "/v1/auth/check", map[string]any{
		"token": issued.Token, "project_id": "acme-iowa", "object": "app:chat", "relation": "viewer", "online": true,
	})
	defer online.Body.Close()
	var onlineAuth cell.AuthCheckResponse
	decode(t, online, &onlineAuth)
	if onlineAuth.Allowed {
		t.Fatal("online check must deny after block")
	}

	offline := postJSON(t, resource, "/v1/auth/check", map[string]any{
		"token": issued.Token, "project_id": "acme-iowa", "object": "app:chat", "relation": "viewer", "online": false,
	})
	defer offline.Body.Close()
	var offlineAuth cell.AuthCheckResponse
	decode(t, offline, &offlineAuth)
	if !offlineAuth.Allowed {
		t.Fatalf("offline must still allow until exp; reason=%s", offlineAuth.Reason)
	}

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
		"project_id": "acme-fra", "sub": "joe@example.com", "aud": "app:chat",
	})
	defer reissue.Body.Close()
	if reissue.StatusCode != http.StatusForbidden {
		body, _ := io.ReadAll(reissue.Body)
		t.Fatalf("reissue after block status=%d body=%s", reissue.StatusCode, body)
	}
	assertError(t, reissue, "user_blocked")

	pr := postJSON(t, home, "/v1/principal/check", map[string]any{
		"project_id": "acme-fra", "sub": "joe@example.com",
	})
	defer pr.Body.Close()
	var principal cell.PrincipalCheckResponse
	decode(t, pr, &principal)
	if principal.Active || !principal.Blocked || principal.Epoch != 2 {
		t.Fatalf("principal=%+v", principal)
	}
}

func TestDeleteRemovesSubscriberTuplesAndTombstonesLookup(t *testing.T) {
	TestGrantDeleteTombstoneAcrossSites(t)
}

func TestBlockFanOutOnlyToInterestedCells(t *testing.T) {
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

	block := postJSON(t, eu1, "/v1/projects/acme-fra/users/joe@example.com/block", map[string]any{})
	defer block.Body.Close()
	var blocked cell.BlockUserResponse
	decode(t, block, &blocked)

	eventCells := map[string]bool{}
	for _, hop := range blocked.Trace {
		if hop.Method == "POST /v1/events/user" {
			eventCells[hop.Cell] = true
		}
	}
	if !eventCells[us1URL] {
		t.Fatalf("missing us-1 fan-out; cells=%v trace=%+v", eventCells, blocked.Trace)
	}
	if eventCells[spareURL] || eventCells[platformURL] {
		t.Fatalf("fan-out leaked to non-subscribers: %v", eventCells)
	}
}
