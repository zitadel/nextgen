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
	At        string             `json:"at"`
	AtShort   string             `json:"at_short"`
	Action    string             `json:"action"`
	Note      string             `json:"note"`
	TotalMs   int64              `json:"total_ms"`
	StepCount int                `json:"step_count"`
	Outcome   string             `json:"outcome"`
	Steps     []timelineStep     `json:"steps"`
	Swimlanes []timelineSwimlane `json:"swimlanes"`
}

type timelineStep struct {
	N            int             `json:"n"`
	Caller       string          `json:"caller"`
	CellLabel    string          `json:"cell_label"`
	Method       string          `json:"method"`
	ProjectID    string          `json:"project_id"`
	Result       string          `json:"result"`
	ResultClass  string          `json:"result_class"`
	IsHit        bool            `json:"is_hit"`
	WireMs       int64           `json:"wire_ms"`
	PairDelayMs  int64           `json:"pair_delay_ms"`
	PairHint     string          `json:"pair_hint"` // "entry" or "us-1↔us-2"
	StepMs       int64           `json:"step_ms"`
	CumulativeMs int64           `json:"cumulative_ms"`
	HomeHint     string          `json:"home_hint,omitempty"`
	Parent       *timelineParent `json:"parent,omitempty"`
}

type timelineParent struct {
	Caller    string `json:"caller"`
	CellLabel string `json:"cell_label"`
	Method    string `json:"method"`
	Result    string `json:"result"`
	Ms        int64  `json:"ms"`
	NextHint  string `json:"next_hint"`
}

type timelineSwimlane struct {
	Label   string `json:"label"`
	DelayMs int64  `json:"delay_ms"`
	Result  string `json:"result"`
	IsHit   bool   `json:"is_hit"`
}

type rawTimelineStep struct {
	fromURL   string
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

// buildTimeline prefers the authoritative walk-response chain (From set / semantic
// miss|hit|tombstone) over flattening UI OnHop fan-out duplicates.
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

	var cumulative int64
	steps := make([]timelineStep, 0, len(raw))
	for i, r := range raw {
		label := labelForCell(r.cellURL, labels)
		caller := "UI"
		if strings.TrimSpace(r.fromURL) != "" {
			caller = labelForCell(r.fromURL, labels)
		}

		pairDelay := int64(0)
		pairHint := "entry"
		if caller != "" && label != "" && caller != "UI" && caller != label {
			pairDelay = int64(delayBetweenLabels(caller, label, delays))
			pairHint = caller + "↔" + label
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
			if projectID == "" && r.lookup.ProjectID != "" {
				projectID = r.lookup.ProjectID
			}
		} else if r.get != nil {
			method = r.get.Method
			result = r.get.Result
			wireMs = r.get.Ms
		}

		// Authoritative hop.Ms already includes pairwise sleep on cell→parent walk calls.
		stepMs := wireMs
		if stepMs == 0 && pairDelay > 0 {
			stepMs = pairDelay
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
			Caller:       caller,
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
				Caller:    caller,
				CellLabel: label,
				Method:    r.get.Method,
				Result:    r.get.Result,
				Ms:        r.get.Ms,
			}
		}
		steps = append(steps, step)
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
	chain := selectWalkChainHops(hops)
	if len(chain) > 0 {
		return stepsFromWalkChain(chain)
	}

	var steps []rawTimelineStep
	used := make([]bool, len(hops))

	for i, h := range hops {
		projID, ok := parseGetProject(h.Method)
		if !ok {
			continue
		}
		steps = append(steps, rawTimelineStep{
			fromURL:   h.From,
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
				fromURL: h.From,
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
			fromURL:   h.From,
			cellURL:   h.Cell,
			projectID: firstNonEmpty(h.ProjectID, projectIDFromMethod(h.Method)),
			lookup:    hopPtr(h),
		})
	}
	return steps
}

// selectWalkChainHops prefers authoritative delegated-walk hops (From set and/or
// semantic miss|hit|tombstone / local lookup). Keeps a single UI→entry OnHop
// when present, then the server response chain — drops duplicate GET+POST fan-out.
func selectWalkChainHops(hops []cell.TraceHop) []cell.TraceHop {
	var semantic []cell.TraceHop
	var uiEntry *cell.TraceHop
	for i := range hops {
		h := hops[i]
		if isWalkChainHop(h) {
			semantic = append(semantic, h)
			continue
		}
		if uiEntry == nil && h.From == "" && isWalkMethod(h.Method) && isHTTPStatusResult(h.Result) {
			cp := h
			uiEntry = &cp
		}
	}
	if len(semantic) == 0 {
		return nil
	}
	out := make([]cell.TraceHop, 0, len(semantic)+1)
	if uiEntry != nil {
		// Avoid duplicating the same entry walk if the chain already starts with it.
		first := semantic[0]
		sameTarget := cell.BaseURLOf(uiEntry.Cell) == cell.BaseURLOf(first.Cell)
		if !(sameTarget && isWalkMethod(first.Method) && first.From == "") {
			out = append(out, *uiEntry)
		}
	}
	out = append(out, semantic...)
	return out
}

func stepsFromWalkChain(hops []cell.TraceHop) []rawTimelineStep {
	steps := make([]rawTimelineStep, 0, len(hops))
	for _, h := range hops {
		steps = append(steps, rawTimelineStep{
			fromURL:   h.From,
			cellURL:   h.Cell,
			projectID: firstNonEmpty(h.ProjectID, projectIDFromMethod(h.Method)),
			lookup:    hopPtr(h),
		})
	}
	return steps
}

func isWalkChainHop(h cell.TraceHop) bool {
	if strings.TrimSpace(h.From) != "" {
		return true
	}
	if isLocalLookupMethod(h.Method) {
		return true
	}
	if isSemanticLookupResult(h.Result) {
		return true
	}
	return false
}

func isWalkMethod(method string) bool {
	m := strings.ToLower(strings.TrimSpace(method))
	return strings.Contains(m, "/v1/lookup/walk")
}

func isLocalLookupMethod(method string) bool {
	return strings.EqualFold(strings.TrimSpace(method), "local lookup")
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
		best = i
	}
	if best >= 0 && !isSemanticLookupResult(steps[best].lookup.Result) {
		return best
	}
	for i := range steps {
		if cell.BaseURLOf(steps[i].cellURL) != base {
			continue
		}
		if steps[i].lookup != nil && isSemanticLookupResult(steps[i].lookup.Result) {
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
		if step.fromURL == "" {
			step.fromURL = h.From
		}
		if step.projectID == "" {
			step.projectID = h.ProjectID
		}
		return
	}
	if shouldPreferLookupResult(h.Result, step.lookup.Result) {
		cp := h
		if cp.Ms == 0 && step.lookup.Ms > 0 {
			cp.Ms = step.lookup.Ms
		}
		step.lookup = &cp
		if h.From != "" {
			step.fromURL = h.From
		}
		if h.ProjectID != "" {
			step.projectID = h.ProjectID
		}
	}
}

func shouldPreferLookupResult(next, cur string) bool {
	if isSemanticLookupResult(next) && !isSemanticLookupResult(cur) {
		return true
	}
	if isSemanticLookupResult(next) && isSemanticLookupResult(cur) {
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

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
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
