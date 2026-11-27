package ui

import (
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestBuildTimelinePrefersWalkChainCallers(t *testing.T) {
	us1 := "http://127.0.0.1:8101"
	us2 := "http://127.0.0.1:8102"
	eu1 := "http://127.0.0.1:8100"

	// UI OnHop (single entry POST) + server delegated-walk trace with From set.
	hops := []cell.TraceHop{
		{Cell: us1, Method: "POST /v1/lookup/walk", Ms: 0, Result: "200"},
		{From: us1, Cell: us1, Method: "local lookup", Ms: 0, Result: "miss", ProjectID: "test-us1-via-us2"},
		{From: us1, Cell: us2, Method: "POST /v1/lookup/walk", Ms: 10, Result: "hit", ProjectID: "test-us2"},
		{From: us2, Cell: us2, Method: "local lookup", Ms: 0, Result: "miss", ProjectID: "test-us2"},
		{From: us2, Cell: eu1, Method: "POST /v1/lookup/walk", Ms: 200, Result: "hit", ProjectID: "test"},
		{From: eu1, Cell: eu1, Method: "local lookup", Ms: 0, Result: "hit", ProjectID: "test"},
	}

	labels := map[string]string{
		cell.NormalizeURL(us1): "us-1",
		cell.NormalizeURL(us2): "us-2",
		cell.NormalizeURL(eu1): "eu-1",
	}
	delays := cell.DefaultPairDelays()

	view := buildTimeline(traceEntry{
		At:     "2026-10-21T03:11:16.123Z",
		Action: "lookup user@test-ws.ch from test-us1-via-us2",
		Note:   "hit home=test at=test",
		Hops:   hops,
	}, labels, delays)

	if view.StepCount != 6 || len(view.Steps) != 6 {
		t.Fatalf("steps=%d want 6 (got %+v)", view.StepCount, resultsOf(view))
	}

	want := []struct {
		caller, cell, result, project string
		pairDelay                     int64
	}{
		{"UI", "us-1", "200", "", 0},
		{"us-1", "us-1", "miss", "test-us1-via-us2", 0},
		{"us-1", "us-2", "hit", "test-us2", 10},
		{"us-2", "us-2", "miss", "test-us2", 0},
		{"us-2", "eu-1", "hit", "test", 200},
		{"eu-1", "eu-1", "hit", "test", 0},
	}
	for i, w := range want {
		s := view.Steps[i]
		if s.Caller != w.caller {
			t.Errorf("step %d caller=%q want %q", i+1, s.Caller, w.caller)
		}
		if s.CellLabel != w.cell {
			t.Errorf("step %d cell=%q want %q", i+1, s.CellLabel, w.cell)
		}
		if s.Result != w.result {
			t.Errorf("step %d result=%q want %q", i+1, s.Result, w.result)
		}
		if w.project != "" && s.ProjectID != w.project {
			t.Errorf("step %d project=%q want %q", i+1, s.ProjectID, w.project)
		}
		if s.PairDelayMs != w.pairDelay {
			t.Errorf("step %d pair delay=%d want %d", i+1, s.PairDelayMs, w.pairDelay)
		}
	}

	// Middle hops must not show UI as caller.
	for i := 1; i < len(view.Steps); i++ {
		if view.Steps[i].Caller == "UI" {
			t.Errorf("step %d must not be UI→… (got %s → %s)", i+1, view.Steps[i].Caller, view.Steps[i].CellLabel)
		}
	}
	if view.Steps[2].Caller != "us-1" || view.Steps[2].CellLabel != "us-2" {
		t.Errorf("expected us-1 → us-2 walk, got %s → %s", view.Steps[2].Caller, view.Steps[2].CellLabel)
	}
	if !view.Steps[5].IsHit || view.Steps[5].HomeHint != "test" {
		t.Errorf("hit step home=%q isHit=%v", view.Steps[5].HomeHint, view.Steps[5].IsHit)
	}
}

func TestBuildTimelineLegacyNineHopsStillGroups(t *testing.T) {
	us1 := "http://127.0.0.1:8101"
	us2 := "http://127.0.0.1:8102"
	eu1 := "http://127.0.0.1:8100"

	// Legacy OnHop GET+POST plus semantic Trace without From — still groups by site.
	hops := []cell.TraceHop{
		{Cell: us1, Method: "GET /v1/projects/test-us1-via-us2", Ms: 0, Result: "200"},
		{Cell: us1, Method: "POST /v1/lookup", Ms: 0, Result: "200"},
		{Cell: us2, Method: "GET /v1/projects/test-us2", Ms: 0, Result: "200"},
		{Cell: us2, Method: "POST /v1/lookup", Ms: 0, Result: "200"},
		{Cell: eu1, Method: "GET /v1/projects/test", Ms: 0, Result: "200"},
		{Cell: eu1, Method: "POST /v1/lookup", Ms: 0, Result: "200"},
		{Cell: us1, Method: "POST /v1/lookup", Ms: 0, Result: "miss"},
		{Cell: us2, Method: "POST /v1/lookup", Ms: 0, Result: "miss"},
		{Cell: eu1, Method: "POST /v1/lookup", Ms: 0, Result: "hit"},
	}

	labels := map[string]string{
		cell.NormalizeURL(us1): "us-1",
		cell.NormalizeURL(us2): "us-2",
		cell.NormalizeURL(eu1): "eu-1",
	}

	view := buildTimeline(traceEntry{
		At: "2026-10-21T03:11:16.123Z", Action: "lookup", Note: "hit home=test at=test", Hops: hops,
	}, labels, cell.DefaultPairDelays())

	// Semantic hops (miss/hit) are selected as walk-chain; GET fan-out dropped.
	if view.StepCount < 3 {
		t.Fatalf("steps=%d want >=3 (got %+v)", view.StepCount, resultsOf(view))
	}
	last := view.Steps[len(view.Steps)-1]
	if last.Result != "hit" || last.CellLabel != "eu-1" {
		t.Fatalf("last step=%s:%s want eu-1:hit", last.CellLabel, last.Result)
	}
}

func TestPairDelayUs1Us2IsTen(t *testing.T) {
	delays := cell.DefaultPairDelays()
	got := delayBetweenLabels("us-1", "us-2", delays)
	if got != 10 {
		t.Fatalf("us-1↔us-2 delay=%d want 10", got)
	}
	if delayBetweenLabels("us-1", "us-1", delays) != 0 {
		t.Fatal("same-cell delay must be 0")
	}
	if delayBetweenLabels("", "us-2", delays) != 0 {
		t.Fatal("empty label delay must be 0")
	}
}

func resultsOf(v *timelineView) []string {
	out := make([]string, len(v.Steps))
	for i, s := range v.Steps {
		out[i] = s.Caller + "→" + s.CellLabel + ":" + s.Result
	}
	return out
}
