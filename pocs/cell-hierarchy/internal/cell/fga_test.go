package cell_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

// Group chain: eu-2 group:A ← joe; eu group:B ← A@eu-2; us app:chat#viewer ← B@eu.
func setupGroupChain(t *testing.T) (eu, eu2, us *httptest.Server, cleanup func()) {
	t.Helper()
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	euCell, euURL, c2 := startCell(t, "http://eu", "eu", true)
	eu2Cell, eu2URL, c3 := startCell(t, "http://eu-2", "eu-2", false)
	usCell, _, c4 := startCell(t, "http://us", "us", false)

	createProject(t, platform, "platform", true, true)
	createProject(t, euCell, "eu", true, true)
	createProject(t, eu2Cell, "team-eu-2", false, false)
	createProject(t, usCell, "us", false, false)
	attachProject(t, euCell, "eu", "platform", platformURL)
	attachProject(t, eu2Cell, "team-eu-2", "eu", euURL)
	attachProject(t, usCell, "us", "platform", platformURL)

	created := postJSON(t, eu2Cell, "/v1/projects/team-eu-2/users", map[string]any{
		"email": "joe@example.com",
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create joe status=%d body=%s", created.StatusCode, body)
	}

	appRes := postJSON(t, usCell, "/v1/projects/us/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()

	// 1) group:A#member@user:joe on eu-2 / team-eu-2
	t1 := postJSON(t, eu2Cell, "/v1/projects/team-eu-2/tuples", map[string]any{
		"object": "group:A", "relation": "member", "user_key": "joe@example.com",
		"subject_kind":    "user",
		"home_project_id": "team-eu-2", "home_cell_url": eu2URL,
		"skip_interest": true,
	})
	defer t1.Body.Close()
	if t1.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(t1.Body)
		t.Fatalf("tuple A status=%d body=%s", t1.StatusCode, body)
	}

	// 2) group:B#member@group:A@team-eu-2 on eu
	t2 := postJSON(t, euCell, "/v1/projects/eu/tuples", map[string]any{
		"object": "group:B", "relation": "member",
		"subject_kind": "group", "user_key": "A",
		"home_project_id": "team-eu-2", "home_cell_url": eu2URL,
	})
	defer t2.Body.Close()
	if t2.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(t2.Body)
		t.Fatalf("tuple B status=%d body=%s", t2.StatusCode, body)
	}

	// 3) app:chat#viewer@group:B@eu on us
	t3 := postJSON(t, usCell, "/v1/projects/us/tuples", map[string]any{
		"object": "app:chat", "relation": "viewer",
		"subject_kind": "group", "user_key": "B",
		"home_project_id": "eu", "home_cell_url": euURL,
	})
	defer t3.Body.Close()
	if t3.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(t3.Body)
		t.Fatalf("tuple chat status=%d body=%s", t3.StatusCode, body)
	}

	cleanup = func() { c1(); c2(); c3(); c4() }
	return euCell, eu2Cell, usCell, cleanup
}

func TestGroupChainAllowsJoe(t *testing.T) {
	_, _, us, cleanup := setupGroupChain(t)
	defer cleanup()

	check := postJSON(t, us, "/v1/fga/check", map[string]any{
		"project_id": "us",
		"object":     "app:chat",
		"relation":   "viewer",
		"user_key":   "joe@example.com",
		"delay_ms":   0,
	})
	defer check.Body.Close()
	if check.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(check.Body)
		t.Fatalf("status=%d body=%s", check.StatusCode, body)
	}
	var body cell.FGACheckResponse
	decode(t, check, &body)
	if !body.Allowed {
		t.Fatalf("expected allowed, reason=%s trace=%+v", body.Reason, body.Trace)
	}
	if body.CrossCellHops < 2 {
		t.Fatalf("cross_cell_hops=%d want >=2 trace=%+v", body.CrossCellHops, body.Trace)
	}
}

func TestGroupChainTraceHasCrossCellHops(t *testing.T) {
	_, _, us, cleanup := setupGroupChain(t)
	defer cleanup()

	check := postJSON(t, us, "/v1/fga/check", map[string]any{
		"project_id": "us", "object": "app:chat", "relation": "viewer",
		"user_key": "joe@example.com",
	})
	defer check.Body.Close()
	var body cell.FGACheckResponse
	decode(t, check, &body)
	rpcHops := 0
	for _, hop := range body.Trace {
		if hop.Method == "POST /v1/fga/expand" {
			rpcHops++
		}
	}
	if rpcHops < 2 {
		t.Fatalf("rpc expand hops=%d want >=2 trace=%+v", rpcHops, body.Trace)
	}
}

func TestExpandCycleDoesNotInfiniteLoop(t *testing.T) {
	a, aURL, c1 := startCell(t, "http://a", "a", false)
	defer c1()
	b, bURL, c2 := startCell(t, "http://b", "b", false)
	defer c2()
	createProject(t, a, "pa", false, false)
	createProject(t, b, "pb", false, false)

	// pa group:X#member@group:Y@pb  and  pb group:Y#member@group:X@pa  (cycle)
	t1 := postJSON(t, a, "/v1/projects/pa/tuples", map[string]any{
		"object": "group:X", "relation": "member",
		"subject_kind": "group", "user_key": "Y",
		"home_project_id": "pb", "home_cell_url": bURL,
	})
	defer t1.Body.Close()
	if t1.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(t1.Body)
		t.Fatalf("t1 status=%d body=%s", t1.StatusCode, body)
	}
	t2 := postJSON(t, b, "/v1/projects/pb/tuples", map[string]any{
		"object": "group:Y", "relation": "member",
		"subject_kind": "group", "user_key": "X",
		"home_project_id": "pa", "home_cell_url": aURL,
	})
	defer t2.Body.Close()
	if t2.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(t2.Body)
		t.Fatalf("t2 status=%d body=%s", t2.StatusCode, body)
	}

	done := make(chan cell.FGAExpandResponse, 1)
	go func() {
		res := postJSON(t, a, "/v1/fga/expand", map[string]any{
			"project_id": "pa", "object": "group:X", "relation": "member",
			"delay_ms": 0, "max_depth": 8,
		})
		defer res.Body.Close()
		var body cell.FGAExpandResponse
		decode(t, res, &body)
		done <- body
	}()

	select {
	case body := <-done:
		if !body.CycleStopped && !body.DepthCapHit {
			// Must stop somehow — cycle flag is preferred.
			t.Fatalf("expected cycle_stopped or depth_cap_hit, got members=%d trace=%+v", len(body.Members), body.Trace)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("expand hung on cycle — infinite loop")
	}
}

func TestFGADelayIncreasesLatency(t *testing.T) {
	_, _, us, cleanup := setupGroupChain(t)
	defer cleanup()

	start0 := time.Now()
	check0 := postJSON(t, us, "/v1/fga/check", map[string]any{
		"project_id": "us", "object": "app:chat", "relation": "viewer",
		"user_key": "joe@example.com", "delay_ms": 0,
	})
	defer check0.Body.Close()
	var body0 cell.FGACheckResponse
	decode(t, check0, &body0)
	elapsed0 := time.Since(start0)
	if !body0.Allowed {
		t.Fatalf("delay0 denied: %s", body0.Reason)
	}

	start1 := time.Now()
	check1 := postJSON(t, us, "/v1/fga/check", map[string]any{
		"project_id": "us", "object": "app:chat", "relation": "viewer",
		"user_key": "joe@example.com", "delay_ms": 40,
	})
	defer check1.Body.Close()
	var body1 cell.FGACheckResponse
	decode(t, check1, &body1)
	elapsed1 := time.Since(start1)
	if !body1.Allowed {
		t.Fatalf("delay40 denied: %s", body1.Reason)
	}
	if body1.TotalMs <= body0.TotalMs {
		t.Fatalf("expected delayed total_ms (%d) > undelayed (%d)", body1.TotalMs, body0.TotalMs)
	}
	// At least one hop sleeps 40ms; wall clock should clearly grow.
	if elapsed1 < elapsed0+30*time.Millisecond {
		t.Fatalf("elapsed delayed=%v undelayed=%v — delay not applied", elapsed1, elapsed0)
	}
}

func TestFGACheckDeniesUnknownUser(t *testing.T) {
	_, _, us, cleanup := setupGroupChain(t)
	defer cleanup()

	check := postJSON(t, us, "/v1/fga/check", map[string]any{
		"project_id": "us", "object": "app:chat", "relation": "viewer",
		"user_key": "eve@example.com",
	})
	defer check.Body.Close()
	var body cell.FGACheckResponse
	decode(t, check, &body)
	if body.Allowed {
		t.Fatal("eve must be denied")
	}
	if body.Reason != "grant_denied" {
		t.Fatalf("reason=%s", body.Reason)
	}
}
