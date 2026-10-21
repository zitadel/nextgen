package ui

import (
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestBuildTimelineGroupsNineHopsIntoThreeSteps(t *testing.T) {
	us1 := "http://127.0.0.1:8101"
	us2 := "http://127.0.0.1:8102"
	eu1 := "http://127.0.0.1:8100"

	// OnHop records GET+POST (Result=200), then appendTrace merges LookupWalk
	// semantic Trace (miss/hit) → 9 raw hops for a 3-site walk.
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
	if len(hops) != 9 {
		t.Fatalf("fixture hops=%d want 9", len(hops))
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

	if view.StepCount != 3 || len(view.Steps) != 3 {
		t.Fatalf("steps=%d want 3 (got %+v)", view.StepCount, resultsOf(view))
	}

	wantResults := []string{"miss", "miss", "hit"}
	wantCells := []string{"us-1", "us-2", "eu-1"}
	wantProjects := []string{"test-us1-via-us2", "test-us2", "test"}
	for i, s := range view.Steps {
		if s.Result != wantResults[i] {
			t.Errorf("step %d result=%q want %q", i+1, s.Result, wantResults[i])
		}
		if s.CellLabel != wantCells[i] {
			t.Errorf("step %d cell=%q want %q", i+1, s.CellLabel, wantCells[i])
		}
		if s.ProjectID != wantProjects[i] {
			t.Errorf("step %d project=%q want %q", i+1, s.ProjectID, wantProjects[i])
		}
		if s.Caller != "UI" {
			t.Errorf("step %d caller=%q want UI", i+1, s.Caller)
		}
		if s.Parent == nil {
			t.Errorf("step %d missing Parent resolve", i+1)
		}
	}

	// Entry delay 0; us-1↔us-2 = 10; us-2↔eu-1 = 200.
	if view.Steps[0].PairDelayMs != 0 {
		t.Errorf("step1 pair delay=%d want 0", view.Steps[0].PairDelayMs)
	}
	if view.Steps[1].PairDelayMs != 10 {
		t.Errorf("step2 pair delay=%d want 10 (us-1↔us-2)", view.Steps[1].PairDelayMs)
	}
	if view.Steps[2].PairDelayMs != 200 {
		t.Errorf("step3 pair delay=%d want 200 (us-2↔eu-1)", view.Steps[2].PairDelayMs)
	}
	if view.Steps[1].CumulativeMs != 10 {
		t.Errorf("step2 cumulative=%d want 10", view.Steps[1].CumulativeMs)
	}
	if view.Steps[2].CumulativeMs != 210 {
		t.Errorf("step3 cumulative=%d want 210", view.Steps[2].CumulativeMs)
	}
	if view.TotalMs != 210 {
		t.Errorf("total=%d want 210", view.TotalMs)
	}
	if !view.Steps[2].IsHit || view.Steps[2].HomeHint != "test" {
		t.Errorf("hit step home=%q isHit=%v", view.Steps[2].HomeHint, view.Steps[2].IsHit)
	}
	if view.Steps[0].Parent == nil || view.Steps[0].Parent.NextHint != "next parent test-us2@us-2" {
		t.Errorf("step1 next hint=%v", view.Steps[0].Parent)
	}
	if view.Steps[2].Parent == nil || view.Steps[2].Parent.NextHint != "root (no parent)" {
		t.Errorf("step3 next hint=%v", view.Steps[2].Parent)
	}
	if len(view.Swimlanes) != 3 {
		t.Fatalf("swimlanes=%d want 3", len(view.Swimlanes))
	}
	if view.Swimlanes[1].DelayMs != 10 {
		t.Errorf("swimlane us-2 delay=%d want 10", view.Swimlanes[1].DelayMs)
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
		out[i] = s.CellLabel + ":" + s.Result
	}
	return out
}
