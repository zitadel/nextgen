package ui

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

// projectOnCell finds a project hosted on cellLabel: prefer id==label, else first local project.
// Known site defaults: eu-1→acme (workspace root), then legacy acme-* names.
func (a *App) projectOnCell(ctx context.Context, cellLabel string) (hostURL, projectID string, err error) {
	hostURL, err = a.cellURLByLabel(cellLabel)
	if err != nil {
		return "", "", err
	}
	projects, err := a.Peer.ListProjects(ctx, hostURL)
	if err != nil {
		return "", "", err
	}
	if len(projects) == 0 {
		return "", "", fmt.Errorf("no projects on cell %s", cellLabel)
	}
	prefer := map[string]string{
		"eu-1": "acme",
		"us-1": "acme-iowa",
		"us-2": "acme-us2",
		"eu-2": "acme-lis",
	}
	if want, ok := prefer[cellLabel]; ok {
		for _, p := range projects {
			if p.ID == want {
				return hostURL, p.ID, nil
			}
		}
	}
	for _, p := range projects {
		if p.ID == cellLabel {
			return hostURL, p.ID, nil
		}
	}
	return hostURL, projects[0].ID, nil
}

func (a *App) parseEntryCell(formValue, defaultLabel string) string {
	v := strings.TrimSpace(formValue)
	if v == "" {
		return defaultLabel
	}
	if _, err := a.cellURLByLabel(v); err != nil {
		return defaultLabel
	}
	return v
}

func parseDelayMs(formValue string) int {
	v := strings.TrimSpace(formValue)
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0
	}
	if n < 0 {
		return 0
	}
	if n > 200 {
		return 200
	}
	return n
}

func (a *App) withPeerDelay(delayMs int) func() {
	prev := a.Peer.ExtraDelay
	a.Peer.ExtraDelay = time.Duration(delayMs) * time.Millisecond
	return func() { a.Peer.ExtraDelay = prev }
}

func countActiveJoeTuples(tuples []cell.TupleView) int {
	n := 0
	for _, tup := range tuples {
		if tup.Tombstoned {
			continue
		}
		if tup.UserKey == "joe@example.com" && tup.SubjectKind == cell.SubjectKindUser {
			n++
		}
	}
	return n
}

func countTombstonedJoeTuples(tuples []cell.TupleView) int {
	n := 0
	for _, tup := range tuples {
		if !tup.Tombstoned {
			continue
		}
		if tup.UserKey == "joe@example.com" && tup.SubjectKind == cell.SubjectKindUser {
			n++
		}
	}
	return n
}

func joeTombstonedSubjects(tuples []cell.TupleView) []string {
	var out []string
	for _, tup := range tuples {
		if !tup.Tombstoned {
			continue
		}
		if tup.UserKey == "joe@example.com" && tup.SubjectKind == cell.SubjectKindUser {
			out = append(out, tup.Subject)
		}
	}
	return out
}

func interestsFromDeleteTrace(hops []cell.TraceHop) []string {
	var out []string
	seen := map[string]bool{}
	for _, hop := range hops {
		if hop.Method != "POST /v1/events/user" {
			continue
		}
		if strings.HasPrefix(hop.Result, "error:") {
			continue
		}
		label := hop.Cell
		if strings.Contains(hop.Result, "@") {
			label = hop.Result
		}
		if seen[label] {
			continue
		}
		seen[label] = true
		out = append(out, label)
	}
	return out
}
