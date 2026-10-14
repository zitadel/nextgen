package harness

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
)

// Where a Fact came from. The distinction is the point of the report: the
// server API exposes neither its dialect nor its image tag nor its replica
// count, so for a target the harness did not start those are only what the
// operator declared, and the record must not pass them off as measured.
const (
	// SourceObserved facts were read from the target by this check.
	SourceObserved = "observed"
	// SourceHarness facts are what the harness itself configured when it
	// started the server.
	SourceHarness = "harness"
	// SourceDeclared facts were passed by the operator with --declare.
	SourceDeclared = "declared"
	// SourceUnknown marks a required fact nobody supplied.
	SourceUnknown = "unknown"
)

// Fact is one named property of the target and where it came from.
type Fact struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Source string `json:"source"`
}

// Probe is one health endpoint request.
type Probe struct {
	Path      string  `json:"path"`
	Status    int     `json:"status"`
	LatencyMS float64 `json:"latency_ms"`
	Error     string  `json:"error,omitempty"`
}

// DoctorReport is the record of what a benchmark ran against. A sweep
// captures it into its run metadata before the first run, so the numbers
// carry the description of the target they were measured on.
type DoctorReport struct {
	CheckedAt time.Time `json:"checked_at"`
	Base      string    `json:"base"`
	Lane      string    `json:"lane"`
	// Reachable is true when every health endpoint answered 200.
	Reachable bool    `json:"reachable"`
	Probes    []Probe `json:"probes"`
	Facts     []Fact  `json:"facts"`
	// Fixtures describes the manifest's resources as found on the target.
	Fixtures *DoctorFixtures `json:"fixtures,omitzero"`
	Warnings []string        `json:"warnings,omitempty"`
}

// DoctorFixtures reports whether the manifest's resources are on the target.
type DoctorFixtures struct {
	ProjectFound     bool `json:"project_found"`
	PrimaryUserFound bool `json:"primary_user_found"`
	Users            int  `json:"users"`
	Sessions         int  `json:"sessions"`
}

// RequiredFacts are the properties of a target that decide how its numbers
// read: a SQLite figure and a PostgreSQL figure are different measurements,
// and so are one replica and three. Each is reported, as "unknown" when no
// one said.
var RequiredFacts = []string{"dialect", "image_tag", "replicas", "log_level"}

// DoctorOptions says what to check.
type DoctorOptions struct {
	Target Target
	// Manifest, when set, adds a check that its resources exist.
	Manifest *Manifest
	// Declared are facts the harness or operator knows about the target,
	// keyed by name, with the source of each in DeclaredSource (default
	// SourceDeclared).
	Declared       map[string]string
	DeclaredSource string
}

// healthPaths are checked in order; all must answer 200.
var healthPaths = []string{"/livez", "/readyz", "/healthz"}

// Doctor checks the target and returns the report. It returns an error only
// when the check itself could not run; an unreachable target is a report with
// Reachable false, so the failure is recorded as well as printed.
func Doctor(ctx context.Context, o DoctorOptions) (DoctorReport, error) {
	r := DoctorReport{CheckedAt: time.Now().UTC(), Base: o.Target.Base, Lane: o.Target.Lane}
	//egress:allow benchmark harness probing the server under test
	client := &http.Client{Timeout: 5 * time.Second}

	r.Reachable = true
	var header http.Header
	var proto string
	for _, path := range healthPaths {
		p, h, pr := probe(ctx, client, o.Target.Base+path, path)
		r.Probes = append(r.Probes, p)
		if p.Status != http.StatusOK {
			r.Reachable = false
			r.Warnings = append(r.Warnings, fmt.Sprintf("%s did not answer 200 (%s)", path, probeOutcome(p)))
		} else if header == nil {
			header, proto = h, pr
		}
	}
	if header != nil {
		r.Facts = append(r.Facts, Fact{Name: "http_proto", Value: proto, Source: SourceObserved})
		if s := header.Get("Server"); s != "" {
			r.Facts = append(r.Facts, Fact{Name: "server_header", Value: s, Source: SourceObserved})
		}
	}

	source := o.DeclaredSource
	if source == "" {
		source = SourceDeclared
	}
	for _, name := range RequiredFacts {
		v, ok := o.Declared[name]
		if !ok || v == "" {
			r.Facts = append(r.Facts, Fact{Name: name, Value: "unknown", Source: SourceUnknown})
			r.Warnings = append(r.Warnings, fmt.Sprintf("%s is not known: the server does not report it, so pass --declare %s=<value>", name, name))
			continue
		}
		r.Facts = append(r.Facts, Fact{Name: name, Value: v, Source: source})
	}
	// Anything else declared (session.default_ttl and the like) is recorded
	// as given.
	extra := make([]string, 0, len(o.Declared))
	for name := range o.Declared {
		if !slices.Contains(RequiredFacts, name) {
			extra = append(extra, name)
		}
	}
	slices.Sort(extra)
	for _, name := range extra {
		r.Facts = append(r.Facts, Fact{Name: name, Value: o.Declared[name], Source: source})
	}

	if o.Manifest != nil && r.Reachable {
		f, err := checkFixtures(ctx, *o.Manifest)
		if err != nil {
			r.Warnings = append(r.Warnings, fmt.Sprintf("checking fixtures: %v", err))
		} else {
			r.Fixtures = &f
			if !f.ProjectFound || !f.PrimaryUserFound {
				r.Warnings = append(r.Warnings, "the manifest's fixtures are not on the target: run bootstrap")
			}
		}
	}
	return r, nil
}

func probe(ctx context.Context, client *http.Client, url, path string) (Probe, http.Header, string) {
	p := Probe{Path: path}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		p.Error = err.Error()
		return p, nil, ""
	}
	start := time.Now()
	resp, err := client.Do(req)
	p.LatencyMS = float64(time.Since(start).Microseconds()) / 1000
	if err != nil {
		p.Error = err.Error()
		return p, nil, ""
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	p.Status = resp.StatusCode
	return p, resp.Header, resp.Proto
}

func probeOutcome(p Probe) string {
	if p.Error != "" {
		return p.Error
	}
	return fmt.Sprintf("status %d", p.Status)
}

func checkFixtures(ctx context.Context, m Manifest) (DoctorFixtures, error) {
	f := DoctorFixtures{Users: len(m.Users), Sessions: len(m.Sessions)}
	c, err := ClientFor(m.Target)
	if err != nil {
		return f, err
	}
	res, err := c.GetProject(ctx, api.GetProjectParams{ProjectID: api.ProjectID(m.Project.ID)})
	if err != nil {
		return f, err
	}
	_, f.ProjectFound = res.(*api.ProjectResponse)
	if !f.ProjectFound {
		return f, nil
	}
	if primary := primaryOf(m); primary.ID != "" {
		ures, err := c.GetUserByID(ctx, api.GetUserByIDParams{UserID: api.UserID(primary.ID)})
		if err != nil {
			return f, err
		}
		_, f.PrimaryUserFound = ures.(*api.User)
	}
	return f, nil
}

// Format renders the report for a terminal or for summary.md.
func (r DoctorReport) Format() string {
	var b strings.Builder
	fmt.Fprintf(&b, "target %s (lane %s), checked %s\n", r.Base, r.Lane, r.CheckedAt.Format(time.RFC3339))
	for _, p := range r.Probes {
		fmt.Fprintf(&b, "  %-9s %s (%.2f ms)\n", p.Path, probeOutcome(p), p.LatencyMS)
	}
	for _, f := range r.Facts {
		fmt.Fprintf(&b, "  %-18s %s [%s]\n", f.Name, f.Value, f.Source)
	}
	if r.Fixtures != nil {
		fmt.Fprintf(&b, "  fixtures           project found: %t, primary user found: %t, %d users, %d sessions\n",
			r.Fixtures.ProjectFound, r.Fixtures.PrimaryUserFound, r.Fixtures.Users, r.Fixtures.Sessions)
	}
	for _, w := range r.Warnings {
		fmt.Fprintf(&b, "  warning: %s\n", w)
	}
	return b.String()
}
