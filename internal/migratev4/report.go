package migratev4

import (
	"fmt"
	"io"
	"slices"
	"strings"
	"text/tabwriter"
)

// reportVersion versions the JSON report; bump it when a key changes meaning.
const reportVersion = 1

// Report is what assess, run and verify print, and what runs record.
type Report struct {
	ReportVersion int          `json:"report_version"`
	Command       string       `json:"command"`
	Source        SourceInfo   `json:"source"`
	Instance      InstanceInfo `json:"instance"`
	Ingest        IngestInfo   `json:"ingest"`
	Target        *TargetInfo  `json:"target,omitempty"`
	Migrates      []Line       `json:"migrates"`
	Partial       []Line       `json:"partial"`
	NotMigrated   []Line       `json:"not_migrated"`
	Conflicts     []Line       `json:"conflicts"`
	Actions       []string     `json:"actions"`
	// Applied counts what run wrote per kind of resource.
	Applied map[string]*Counts `json:"applied,omitempty"`
	// Verify lists verify's checks.
	Verify []Check `json:"verify,omitempty"`
	Issues []Issue `json:"issues,omitempty"`
}

// SourceInfo describes the v4 database.
type SourceInfo struct {
	LastSetupStep string `json:"last_setup_step"`
	GapFree       bool   `json:"gap_free"`
}

// InstanceInfo describes the v4 instance.
type InstanceInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	DefaultOrgID string `json:"default_org_id,omitempty"`
}

// IngestInfo counts what ingest read.
type IngestInfo struct {
	Events     int    `json:"events"`
	Batches    int    `json:"batches"`
	Aggregates int    `json:"aggregates"`
	Position   string `json:"position"`
	// Restaged is true when newer reducers re-read v4 from the start.
	Restaged bool `json:"restaged,omitempty"`
}

// TargetInfo names what the instance became in nextgen.
type TargetInfo struct {
	ProjectID string `json:"project_id"`
	SchemaURL string `json:"schema_url,omitempty"`
}

// Line is one counted row of the report.
type Line struct {
	Item  string `json:"item"`
	Count int    `json:"count"`
	Note  string `json:"note,omitempty"`
}

// Counts are run's writes for one kind of resource.
type Counts struct {
	Created   int `json:"created"`
	Updated   int `json:"updated"`
	Unchanged int `json:"unchanged"`
	Skipped   int `json:"skipped"`
	Failed    int `json:"failed"`
}

// Check is one comparison verify made.
type Check struct {
	Name     string `json:"name"`
	Expected int    `json:"expected"`
	Actual   int    `json:"actual"`
	OK       bool   `json:"ok"`
}

// Issue is a problem with one v4 source. Detail names people or values only
// when the operator asked for PII.
type Issue struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Kind     string `json:"kind"`
	SourceID string `json:"source_id"`
	Detail   string `json:"detail,omitempty"`
}

// Issue severities.
const (
	SeverityConflict = "conflict"
	SeverityWarning  = "warning"
	SeverityInfo     = "info"
)

func (r *Report) count(kind string) *Counts {
	if r.Applied == nil {
		r.Applied = map[string]*Counts{}
	}
	c, ok := r.Applied[kind]
	if !ok {
		c = &Counts{}
		r.Applied[kind] = c
	}
	return c
}

// WriteText renders the report for a terminal.
func (r *Report) WriteText(w io.Writer) error {
	tw := tabwriter.NewWriter(w, 2, 4, 2, ' ', 0)
	sync := "continuous sync supported"
	if !r.Source.GapFree {
		sync = "stop v4 while migrating (older than 4.18)"
	}
	fmt.Fprintf(tw, "instance %s  %q  (%s, last setup step %s)\n", r.Instance.ID, r.Instance.Name, sync, r.Source.LastSetupStep)
	restaged := ""
	if r.Ingest.Restaged {
		restaged = " (restaged from the start: the reducers changed)"
	}
	fmt.Fprintf(tw, "ingest: %d events read in %d batches, %d aggregates staged%s\n", r.Ingest.Events, r.Ingest.Batches, r.Ingest.Aggregates, restaged)
	if r.Target != nil {
		fmt.Fprintf(tw, "target: project %s, user schema %s\n", r.Target.ProjectID, r.Target.SchemaURL)
	}
	for _, section := range []struct {
		title string
		lines []Line
	}{
		{"MIGRATES", r.Migrates},
		{"PARTIAL (migrated, something stays behind)", r.Partial},
		{"NOT MIGRATED", r.NotMigrated},
		{"CONFLICTS", r.Conflicts},
	} {
		if len(section.lines) == 0 {
			continue
		}
		fmt.Fprintf(tw, "\n%s\n", section.title)
		for _, line := range section.lines {
			fmt.Fprintf(tw, "  %s\t%d\t%s\n", line.Item, line.Count, line.Note)
		}
	}
	if len(r.Applied) > 0 {
		fmt.Fprintf(tw, "\nAPPLIED\n  kind\tcreated\tupdated\tunchanged\tskipped\tfailed\n")
		kinds := make([]string, 0, len(r.Applied))
		for kind := range r.Applied {
			kinds = append(kinds, kind)
		}
		slices.Sort(kinds)
		for _, kind := range kinds {
			c := r.Applied[kind]
			fmt.Fprintf(tw, "  %s\t%d\t%d\t%d\t%d\t%d\n", kind, c.Created, c.Updated, c.Unchanged, c.Skipped, c.Failed)
		}
	}
	if len(r.Verify) > 0 {
		fmt.Fprintf(tw, "\nVERIFY\n  check\texpected\tactual\t\n")
		for _, c := range r.Verify {
			status := "ok"
			if !c.OK {
				status = "MISMATCH"
			}
			fmt.Fprintf(tw, "  %s\t%d\t%d\t%s\n", c.Name, c.Expected, c.Actual, status)
		}
	}
	if len(r.Actions) > 0 {
		fmt.Fprintf(tw, "\nACTIONS\n")
		for _, action := range r.Actions {
			fmt.Fprintf(tw, "  - %s\n", action)
		}
	}
	if len(r.Issues) > 0 {
		fmt.Fprintf(tw, "\nISSUES\n")
		for _, issue := range r.Issues {
			detail := ""
			if issue.Detail != "" {
				detail = ": " + issue.Detail
			}
			fmt.Fprintf(tw, "  %s %s %s %s%s\n", strings.ToUpper(issue.Severity), issue.Code, issue.Kind, issue.SourceID, detail)
		}
	}
	return tw.Flush()
}
