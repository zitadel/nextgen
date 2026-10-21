package ui

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

// timelineView is the display model for the Latest hop panel.
type timelineView struct {
	At        string
	AtShort   string
	Action    string
	Note      string
	TotalMs   int64
	StepCount int
	Outcome   string
	Steps     []timelineStep
	Swimlanes []timelineSwimlane
}

type timelineStep struct {
	N            int
	Caller       string
	CellLabel    string
	Method       string
	ProjectID    string
	Result       string
	ResultClass  string
	IsHit        bool
	WireMs       int64
	PairDelayMs  int64
	PairHint     string // "entry" or "us-1↔us-2"
	StepMs       int64
	CumulativeMs int64
	HomeHint     string
	Parent       *timelineParent
}

type timelineParent struct {
	Caller    string
	CellLabel string
	Method    string
	Result    string
	Ms        int64
	NextHint  string
}

type timelineSwimlane struct {
	Label   string
	DelayMs int64
	Result  string
	IsHit   bool
}

type rawTimelineStep struct {
	cellURL   string
	projectID string
	get       *cell.TraceHop
	lookup    *cell.TraceHop
}

var (
	reGetProject = regexp.MustCompile(`(?i)^GET\s+/v1/projects/([^?\s]+)`)
	reHomeInNote = regexp.MustCompile(`(?i)\bhome=([^\s]+)`)
)

func (a *App) latestTimeline() *timelineView {
	te := a.latestTrace()
	if te == nil {
		return nil
	}
	return a.buildTimeline(*te)
}

func (a *App) buildTimeline(entry traceEntry) *timelineView {
	return buildTimeline(entry, a.labelMap(), a.copyDelayPairs())
}

// buildTimeline groups raw OnHop + semantic LookupWalk hops into one step per site visit.
func buildTimeline(entry traceEntry, labels map[string]string, delays map[string]int) *timelineView {
	v := &timelineView{
		At:      entry.At,
		AtShort: shortTime(entry.At),
		Action:  entry.Action,
		Note:    entry.Note,
		Outcome: strings.TrimSpace(entry.Note),
	}
	if len(entry.Hops) == 0 {
		return v
	}

	raw := groupHopsIntoSteps(entry.Hops)
	if len(raw) == 0 {
		return v
	}

	homeHint := ""
	if m := reHomeInNote.FindStringSubmatch(entry.Note); len(m) == 2 {
		homeHint = m[1]
	}

	var prevLabel string
	var cumulative int64
	steps := make([]timelineStep, 0, len(raw))
	for i, r := range raw {
		label := labelForCell(r.cellURL, labels)
		pairDelay := int64(0)
		pairHint := "entry"
		if i > 0 && prevLabel != "" && label != "" {
			pairDelay = int64(delayBetweenLabels(prevLabel, label, delays))
			if pairDelay > 0 || prevLabel != label {
				pairHint = prevLabel + "↔" + label
			}
		}

		result := "—"
		wireMs := int64(0)
		method := "POST /v1/lookup"
		projectID := r.projectID
		if r.lookup != nil {
			result = r.lookup.Result
			wireMs = r.lookup.Ms
			if r.lookup.Method != "" {
				method = r.lookup.Method
			}
		} else if r.get != nil {
			// Site visit with parent resolve only (unusual).
			method = r.get.Method
			result = r.get.Result
			wireMs = r.get.Ms
		}

		stepMs := pairDelay
		if wireMs > 0 {
			stepMs += wireMs
		}
		cumulative += stepMs

		resultNorm := strings.ToLower(strings.TrimSpace(result))
		isHit := resultNorm == "hit"
		class := "hop-miss"
		switch resultNorm {
		case "hit":
			class = "hop-hit"
		case "tombstone":
			class = "hop-tombstone"
		case "miss":
			class = "hop-miss"
		default:
			if isHTTPStatusResult(result) {
				class = "hop-miss"
			}
		}

		step := timelineStep{
			N:            i + 1,
			Caller:       "UI",
			CellLabel:    label,
			Method:       method,
			ProjectID:    projectID,
			Result:       result,
			ResultClass:  class,
			IsHit:        isHit,
			WireMs:       wireMs,
			PairDelayMs:  pairDelay,
			PairHint:     pairHint,
			StepMs:       stepMs,
			CumulativeMs: cumulative,
		}
		if isHit && homeHint != "" {
			step.HomeHint = homeHint
		}
		if r.get != nil {
			step.Parent = &timelineParent{
				Caller:    "UI",
				CellLabel: label,
				Method:    r.get.Method,
				Result:    r.get.Result,
				Ms:        r.get.Ms,
			}
		}
		steps = append(steps, step)
		prevLabel = label
	}

	for i := range steps {
		if steps[i].Parent == nil {
			continue
		}
		if i+1 < len(steps) {
			next := steps[i+1]
			steps[i].Parent.NextHint = fmt.Sprintf("next parent %s@%s", next.ProjectID, next.CellLabel)
		} else {
			steps[i].Parent.NextHint = "root (no parent)"
		}
	}

	lanes := make([]timelineSwimlane, 0, len(steps))
	for _, s := range steps {
		lanes = append(lanes, timelineSwimlane{
			Label:   s.CellLabel,
			DelayMs: s.PairDelayMs,
			Result:  s.Result,
			IsHit:   s.IsHit,
		})
	}

	v.Steps = steps
	v.Swimlanes = lanes
	v.StepCount = len(steps)
	v.TotalMs = cumulative
	return v
}

func groupHopsIntoSteps(hops []cell.TraceHop) []rawTimelineStep {
	var steps []rawTimelineStep
	used := make([]bool, len(hops))

	for i, h := range hops {
		projID, ok := parseGetProject(h.Method)
		if !ok {
			continue
		}
		steps = append(steps, rawTimelineStep{
			cellURL:   h.Cell,
			projectID: projID,
			get:       hopPtr(h),
		})
		used[i] = true
	}

	for i, h := range hops {
		if used[i] || !isLookupMethod(h.Method) {
			continue
		}
		idx := findStepForLookup(steps, h.Cell)
		if idx < 0 {
			steps = append(steps, rawTimelineStep{
				cellURL: h.Cell,
				lookup:  hopPtr(h),
			})
			used[i] = true
			continue
		}
		mergeLookup(&steps[idx], h)
		used[i] = true
	}

	if len(steps) > 0 {
		return steps
	}

	// Fallback for non-walk actions: one step per hop.
	for _, h := range hops {
		steps = append(steps, rawTimelineStep{
			cellURL:   h.Cell,
			projectID: projectIDFromMethod(h.Method),
			lookup:    hopPtr(h),
		})
	}
	return steps
}

func findStepForLookup(steps []rawTimelineStep, hopCell string) int {
	base := cell.BaseURLOf(hopCell)
	best := -1
	for i := range steps {
		if cell.BaseURLOf(steps[i].cellURL) != base {
			continue
		}
		if steps[i].lookup == nil {
			return i
		}
		if !isSemanticLookupResult(steps[i].lookup.Result) {
			return i
		}
		// Keep scanning: later non-semantic slots first; remember last same-cell.
		best = i
	}
	if best >= 0 && !isSemanticLookupResult(steps[best].lookup.Result) {
		return best
	}
	// All same-cell steps already semantic: upgrade the first same-cell without a
	// stronger result, else the first same-cell step.
	for i := range steps {
		if cell.BaseURLOf(steps[i].cellURL) != base {
			continue
		}
		if steps[i].lookup != nil && isSemanticLookupResult(steps[i].lookup.Result) {
			// Prefer leaving existing semantic; allow upgrade only if duplicate cell walk.
			continue
		}
		return i
	}
	for i := range steps {
		if cell.BaseURLOf(steps[i].cellURL) == base {
			return i
		}
	}
	return -1
}

func mergeLookup(step *rawTimelineStep, h cell.TraceHop) {
	if step.lookup == nil {
		step.lookup = hopPtr(h)
		return
	}
	if shouldPreferLookupResult(h.Result, step.lookup.Result) {
		cp := h
		// Keep higher wire ms if semantic hop has 0.
		if cp.Ms == 0 && step.lookup.Ms > 0 {
			cp.Ms = step.lookup.Ms
		}
		step.lookup = &cp
	}
}

func shouldPreferLookupResult(next, cur string) bool {
	if isSemanticLookupResult(next) && !isSemanticLookupResult(cur) {
		return true
	}
	if isSemanticLookupResult(next) && isSemanticLookupResult(cur) {
		// Prefer hit/tombstone over miss when both present (unlikely).
		n := strings.ToLower(next)
		c := strings.ToLower(cur)
		if n == c {
			return false
		}
		if n == "hit" || n == "tombstone" {
			return true
		}
		return false
	}
	return false
}

func isSemanticLookupResult(r string) bool {
	switch strings.ToLower(strings.TrimSpace(r)) {
	case "miss", "hit", "tombstone", "local":
		return true
	default:
		return false
	}
}

func isHTTPStatusResult(r string) bool {
	r = strings.TrimSpace(r)
	if r == "" {
		return false
	}
	for _, c := range r {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isLookupMethod(method string) bool {
	m := strings.ToLower(strings.TrimSpace(method))
	return strings.Contains(m, "/v1/lookup") && !strings.Contains(m, "/v1/lookup/")
}

func parseGetProject(method string) (string, bool) {
	m := reGetProject.FindStringSubmatch(strings.TrimSpace(method))
	if len(m) != 2 {
		return "", false
	}
	return m[1], true
}

func projectIDFromMethod(method string) string {
	if id, ok := parseGetProject(method); ok {
		return id
	}
	return ""
}

func hopPtr(h cell.TraceHop) *cell.TraceHop {
	cp := h
	return &cp
}

func labelForCell(raw string, labels map[string]string) string {
	base := cell.BaseURLOf(raw)
	if labels != nil {
		if l, ok := labels[base]; ok && l != "" {
			return l
		}
		if l, ok := labels[cell.NormalizeURL(raw)]; ok && l != "" {
			return l
		}
	}
	if base != "" {
		return base
	}
	return raw
}

func delayBetweenLabels(from, to string, delays map[string]int) int {
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if from == "" || to == "" || from == to {
		return 0
	}
	if delays == nil {
		return 0
	}
	return delays[cell.PairKey(from, to)]
}

func shortTime(at string) string {
	at = strings.TrimSpace(at)
	if at == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		t, err = time.Parse(time.RFC3339, at)
	}
	if err != nil {
		return at
	}
	return t.UTC().Format("15:04:05") + "Z"
}
