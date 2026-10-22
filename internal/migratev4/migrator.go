package migratev4

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Migrator runs the migrate-v4 commands for one v4 database.
type Migrator struct {
	src   *v4.Source
	store *stage.Store
	deps  Deps
}

// New returns a migrator reading src, keeping its state in store and writing
// nextgen through deps.
func New(src *v4.Source, store *stage.Store, deps Deps) *Migrator {
	return &Migrator{src: src, store: store, deps: deps}
}

// Instances lists the source's instances.
func (m *Migrator) Instances(ctx context.Context) ([]v4.Instance, error) {
	return m.src.Instances(ctx)
}

// session is one command's hold on an instance: the lock, the capability
// check, and a freshly ingested stage.
type session struct {
	opts   Options
	report *Report
	caps   v4.Capabilities
	unlock func()
}

func (m *Migrator) begin(ctx context.Context, opts Options, command string, live bool) (*session, error) {
	opts.defaults()
	if opts.InstanceID == "" {
		return nil, errors.New("no v4 instance given")
	}
	caps, err := m.src.Capabilities(ctx)
	if err != nil {
		return nil, err
	}
	if live && !caps.GapFree && !opts.SourceStopped {
		return nil, fmt.Errorf("the v4 database predates setup step %s (v4.18): a running v4 can commit events a reader misses. Stop v4 and pass --v4-stopped, or upgrade v4 first", v4.StepGapFree)
	}
	if err := m.store.Migrate(ctx); err != nil {
		return nil, err
	}
	unlock, err := m.store.Lock(ctx, opts.InstanceID)
	if err != nil {
		return nil, err
	}
	return &session{
		opts:   opts,
		caps:   caps,
		unlock: unlock,
		report: &Report{
			ReportVersion: reportVersion,
			Command:       command,
			Source:        SourceInfo{LastSetupStep: caps.LastStep, GapFree: caps.GapFree},
			Instance:      InstanceInfo{ID: opts.InstanceID},
		},
	}, nil
}

// ingestAndPlan folds new v4 events into the stage and derives the plan.
func (m *Migrator) ingestAndPlan(ctx context.Context, s *session) (*plan, map[stage.MappingKey]*stage.Mapping, error) {
	stats, err := stage.Ingest(ctx, m.src, m.store, s.opts.InstanceID, s.opts.BatchSize)
	if err != nil {
		return nil, nil, err
	}
	s.report.Ingest = IngestInfo{Events: stats.Events, Batches: stats.Batches, Aggregates: stats.Aggregates, Position: stats.Cursor.Position, Restaged: stats.Restaged}
	snap, err := loadSnapshot(ctx, m.store, s.opts.InstanceID)
	if err != nil {
		return nil, nil, err
	}
	mappings, err := m.store.Mappings(ctx, s.opts.InstanceID)
	if err != nil {
		return nil, nil, err
	}
	slugs, err := m.existingSlugs(ctx, mappings)
	if err != nil {
		return nil, nil, err
	}
	p, err := buildPlan(snap, s.opts, m.deps.Hasher, m.deps.BuiltinPublicBase, slugs, s.report)
	if err != nil {
		return nil, nil, err
	}
	if err := m.inventory(ctx, s); err != nil {
		return nil, nil, err
	}
	return p, mappings, nil
}

// existingSlugs reads the slugs of the connections earlier runs created.
func (m *Migrator) existingSlugs(ctx context.Context, mappings map[stage.MappingKey]*stage.Mapping) (map[string]string, error) {
	slugs := map[string]string{}
	var projectID string
	for key, mapping := range mappings {
		if key.Kind == kindProject && mapping.Applied {
			projectID = mapping.TargetID
		}
	}
	for key, mapping := range mappings {
		if key.Kind != kindIDP || !mapping.Applied || projectID == "" {
			continue
		}
		connection, err := m.deps.IDPs.Get(ctx, projectID, mapping.TargetID)
		if err != nil {
			return nil, fmt.Errorf("read connection %s: %w", mapping.TargetID, err)
		}
		slugs[key.ID] = connection.Slug
	}
	return slugs, nil
}

// Assess ingests the instance and reports what would migrate. It writes
// nothing to nextgen.
func (m *Migrator) Assess(ctx context.Context, opts Options) (*Report, error) {
	started := time.Now()
	s, err := m.begin(ctx, opts, "assess", false)
	if err != nil {
		return nil, err
	}
	defer s.unlock()
	p, _, err := m.ingestAndPlan(ctx, s)
	if err != nil {
		return nil, err
	}
	for _, idp := range p.idps {
		s.report.Actions = append(s.report.Actions, fmt.Sprintf("register the redirect URI https://<app origin>/__nextgen/idp/%s/callback at %q (v4 id %s)", idp.slug, idp.idp.Name, idp.idp.ID))
	}
	if len(s.opts.MasterKey) == 0 && len(p.idps) > 0 {
		s.report.Actions = append(s.report.Actions, "pass the v4 master key (--v4-masterkey-file) so run can move the IdP client secrets")
	}
	m.commonActions(s, p)
	return s.report, m.store.SaveRun(ctx, s.opts.InstanceID, "assess", started, s.report)
}

// Run ingests the instance and converges nextgen to it.
func (m *Migrator) Run(ctx context.Context, opts Options) (*Report, error) {
	started := time.Now()
	s, err := m.begin(ctx, opts, "run", true)
	if err != nil {
		return nil, err
	}
	defer s.unlock()
	p, mappings, err := m.ingestAndPlan(ctx, s)
	if err != nil {
		return nil, err
	}
	var keys *v4.Keys
	if len(s.opts.MasterKey) > 0 {
		if keys, err = m.src.LoadKeys(ctx, s.opts.MasterKey); err != nil {
			return nil, err
		}
	}
	a := &applier{
		deps:       m.deps,
		store:      m.store,
		opts:       s.opts,
		report:     s.report,
		keys:       keys,
		instanceID: s.opts.InstanceID,
		mappings:   mappings,
	}
	if err := a.apply(ctx, p); err != nil {
		return s.report, err
	}
	m.commonActions(s, p)
	return s.report, m.store.SaveRun(ctx, s.opts.InstanceID, "run", started, s.report)
}

func (m *Migrator) commonActions(s *session, p *plan) {
	if len(p.originHints) > 0 {
		s.report.Actions = append(s.report.Actions, fmt.Sprintf("add the origins your apps run on (zitadel origin add); v4 served sign-in on %s", strings.Join(p.originHints, ", ")))
	}
	for _, issue := range s.report.Issues {
		if issue.Code == "password_hash_rejected" {
			s.report.Actions = append(s.report.Actions, "widen password_hasher.limits or add verifiers (md5plain) in nextgen's config, then run again, to keep the passwords of the users listed as password_hash_rejected")
			break
		}
	}
	s.report.Actions = append(s.report.Actions, "integrate the apps with nextgen: v4 OIDC clients do not carry over, and each user's id changes (export-ids)")
	s.report.Actions = slices.Compact(s.report.Actions)
}

// inventory reports the v4 settings the migrator only counts: how many changes
// someone made to each, setup's defaults left out.
func (m *Migrator) inventory(ctx context.Context, s *session) error {
	counts, err := m.src.ChangeCounts(ctx, s.opts.InstanceID)
	if err != nil {
		return err
	}
	categories := []struct {
		item     string
		note     string
		prefixes []string
	}{
		{"changes to SMTP, SMS and email providers", "not built in nextgen", []string{"instance.smtp.config", "instance.sms.config", "instance.email.config"}},
		{"changes to branding (label policies)", "branding revisions are a different model", []string{"policy.label."}},
		{"changes to texts and message templates", "translations are a different model", []string{"customtext.", "mail.text"}},
		{"changes to password, lockout and age policies", "operation policies (ADR 066)", []string{"policy.password.", "policy.lockout."}},
		{"changes to instance, org and project members", "nextgen grants are a different model", []string{"instance.member.", "org.member.", "project.member."}},
		{"changes to org login policies", "no team-scoped login yet", []string{"org.policy.login."}},
		{"changes to feature flags, quotas, limits, restrictions", "not migrated", []string{"feature.", "quota.", "limits.", "restrictions."}},
		{"sessions and tokens issued", "never migrated: users sign in again", []string{"session.added", "oidc_session.added", "user.token.added", "user.human.refresh.token.added"}},
	}
	for _, category := range categories {
		var n int64
		for _, types := range counts {
			for eventType, count := range types {
				for _, prefix := range category.prefixes {
					if strings.HasPrefix(eventType, prefix) || strings.Contains(eventType, "."+prefix) {
						n += count
						break
					}
				}
			}
		}
		if n > 0 {
			s.report.NotMigrated = append(s.report.NotMigrated, Line{Item: category.item, Count: int(n), Note: category.note})
		}
	}
	return nil
}

// Follow runs again and again, pausing interval between runs, until ctx ends.
func (m *Migrator) Follow(ctx context.Context, opts Options, interval time.Duration, each func(*Report, error)) error {
	for {
		report, err := m.Run(ctx, opts)
		each(report, err)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(interval):
		}
	}
}

// Status reports the cursor, how far it lags v4, and the id map.
func (m *Migrator) Status(ctx context.Context, instanceID string, w io.Writer) error {
	if err := m.store.Migrate(ctx); err != nil {
		return err
	}
	cursor, _, err := m.store.Cursor(ctx, instanceID)
	if err != nil {
		return err
	}
	newest, err := m.src.MaxPosition(ctx, instanceID, v4.NewTypeFilter(stage.EventTypes()))
	if err != nil {
		return err
	}
	mappings, err := m.store.Mappings(ctx, instanceID)
	if err != nil {
		return err
	}
	byKind := map[string][2]int{}
	for key, mapping := range mappings {
		c := byKind[key.Kind]
		if mapping.Applied {
			c[0]++
		} else {
			c[1]++
		}
		byKind[key.Kind] = c
	}
	fmt.Fprintf(w, "instance %s\ncursor position %s, newest v4 position %s\n", instanceID, cursor.Position, newest)
	kinds := make([]string, 0, len(byKind))
	for kind := range byKind {
		kinds = append(kinds, kind)
	}
	slices.Sort(kinds)
	for _, kind := range kinds {
		fmt.Fprintf(w, "  %-10s applied %d, reserved %d\n", kind, byKind[kind][0], byKind[kind][1])
	}
	command, finished, _, err := m.store.LastRun(ctx, instanceID)
	if err != nil {
		return err
	}
	if command != "" {
		fmt.Fprintf(w, "last run: %s at %s\n", command, finished.Format(time.RFC3339))
	}
	return nil
}

// Verify checks that nextgen holds what the stage says should have migrated.
func (m *Migrator) Verify(ctx context.Context, opts Options) (*Report, error) {
	started := time.Now()
	s, err := m.begin(ctx, opts, "verify", false)
	if err != nil {
		return nil, err
	}
	defer s.unlock()
	snap, err := loadSnapshot(ctx, m.store, s.opts.InstanceID)
	if err != nil {
		return nil, err
	}
	mappings, err := m.store.Mappings(ctx, s.opts.InstanceID)
	if err != nil {
		return nil, err
	}
	slugs, err := m.existingSlugs(ctx, mappings)
	if err != nil {
		return nil, err
	}
	p, err := buildPlan(snap, s.opts, m.deps.Hasher, m.deps.BuiltinPublicBase, slugs, s.report)
	if err != nil {
		return nil, err
	}
	project := mappings[stage.MappingKey{Kind: kindProject, ID: s.opts.InstanceID}]
	if project == nil || !project.Applied {
		return nil, errors.New("nothing migrated yet: run first")
	}
	projectID := project.TargetID
	s.report.Target = &TargetInfo{ProjectID: projectID}
	stmts := m.deps.Pool.Statements()
	ctx = service.WithAuthzListUnrestricted(ctx)
	target := func(kind, id string) (string, bool) {
		mapping := mappings[stage.MappingKey{Kind: kind, ID: id}]
		if mapping == nil || !mapping.Applied {
			return "", false
		}
		return mapping.TargetID, true
	}

	teams := 0
	for _, t := range p.teams {
		if id, ok := target(kindTeam, t.orgID); ok {
			if _, err := stmts.GetTeamByID(ctx, projectID, id); err == nil {
				teams++
			}
		}
	}
	users, passwords, attributes, wantPasswords := 0, 0, 0, 0
	for _, u := range p.users {
		if u.passwordHash != "" {
			wantPasswords++
		}
		id, ok := target(kindUser, u.userID)
		if !ok {
			continue
		}
		user, err := m.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: projectID, UserID: id})
		if err != nil {
			continue
		}
		users++
		current := map[string]any{}
		for _, attribute := range user.Attributes {
			current[string(attribute.Key)] = attribute.Value
		}
		if equalJSON(current, u.attributes) {
			attributes++
		}
		if u.passwordHash != "" {
			if setAt, err := m.deps.Users.GetPasswordSetAt(ctx, service.GetPasswordInput{ProjectID: projectID, UserID: id}); err == nil && setAt != nil {
				passwords++
			}
		}
	}
	idps := 0
	for _, idp := range p.idps {
		if id, ok := target(kindIDP, idp.idp.ID); ok {
			if _, err := m.deps.IDPs.Get(ctx, projectID, id); err == nil {
				idps++
			}
		}
	}
	links := 0
	for _, l := range p.links {
		if id, ok := target(kindLink, l.idp.idp.ID+"|"+l.subject); ok {
			if _, err := stmts.GetIDPIdentityLink(ctx, database.And(
				database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), projectID),
				database.Equal(database.Col(domain.IDPIdentityLinkFieldID), id),
			)); err == nil {
				links++
			}
		}
	}
	check := func(name string, expected, actual int) {
		s.report.Verify = append(s.report.Verify, Check{Name: name, Expected: expected, Actual: actual, OK: expected == actual})
	}
	check("teams", len(p.teams), teams)
	check("users", len(p.users), users)
	check("users whose attributes match v4", len(p.users), attributes)
	check("users with a password", wantPasswords, passwords)
	check("IdP connections", len(p.idps), idps)
	check("identity links", len(p.links), links)
	return s.report, m.store.SaveRun(ctx, s.opts.InstanceID, "verify", started, s.report)
}

// ExportIDs writes which nextgen id each migrated v4 user and org got, for
// the owners of data keyed on v4's ids.
func (m *Migrator) ExportIDs(ctx context.Context, instanceID, format string, w io.Writer) error {
	mappings, err := m.store.Mappings(ctx, instanceID)
	if err != nil {
		return err
	}
	type row struct {
		Kind      string `json:"kind"`
		V4ID      string `json:"v4_id"`
		NextgenID string `json:"nextgen_id"`
	}
	var rows []row
	for key, mapping := range mappings {
		if !mapping.Applied {
			continue
		}
		switch key.Kind {
		case kindUser:
			rows = append(rows, row{"user", key.ID, mapping.TargetID})
		case kindTeam:
			rows = append(rows, row{"org", key.ID, mapping.TargetID})
		case kindProject:
			rows = append(rows, row{"instance", key.ID, mapping.TargetID})
		}
	}
	slices.SortFunc(rows, func(a, b row) int {
		return strings.Compare(a.Kind+a.V4ID, b.Kind+b.V4ID)
	})
	if format == "json" {
		return json.NewEncoder(w).Encode(rows)
	}
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"kind", "v4_id", "nextgen_id"})
	for _, r := range rows {
		_ = cw.Write([]string{r.Kind, r.V4ID, r.NextgenID})
	}
	cw.Flush()
	return cw.Error()
}

// Cleanup drops everything the migrator kept for the instance, password
// hashes included. What it created in nextgen stays.
func (m *Migrator) Cleanup(ctx context.Context, instanceID string) error {
	unlock, err := m.store.Lock(ctx, instanceID)
	if err != nil {
		return err
	}
	defer unlock()
	return m.store.DropInstance(ctx, instanceID)
}
