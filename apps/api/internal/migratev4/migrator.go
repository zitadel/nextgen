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

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"

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
	if opts.Identifier != IdentifierEmail && opts.Identifier != IdentifierLoginName {
		return nil, errors.New("identifier must be email or login_name")
	}
	if opts.DefaultOrgUsers != DefaultOrgUsersTeam {
		return nil, errors.New("default-org users must remain team-owned; self ownership is not supported")
	}
	if err := opts.validateCallbacks(); err != nil {
		return nil, err
	}
	if live && (!opts.SourceStopped || !opts.TargetStopped) {
		return nil, errors.New("offline import requires --v4-stopped and --target-stopped; stop both servers and other target writers first")
	}
	if opts.InstanceID == "" {
		return nil, errors.New("no v4 instance given")
	}
	caps, err := m.src.Capabilities(ctx)
	if err != nil {
		return nil, err
	}
	if err := m.store.Migrate(ctx); err != nil {
		return nil, err
	}
	unlock, err := m.store.Lock(ctx, opts.InstanceID)
	if err != nil {
		return nil, err
	}
	identity, err := m.src.Identity(ctx, opts.InstanceID)
	if err == nil {
		err = m.store.Bind(ctx, opts.InstanceID, fingerprint([]any{2, stage.ReducerVersion, identity, opts.ProjectID, opts.Identifier, opts.DefaultOrgUsers, m.deps.BuiltinPublicBase}))
	}
	if err != nil {
		unlock()
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
	pending, err := m.store.Pending(ctx, s.opts.InstanceID)
	if err != nil {
		return nil, nil, err
	}
	if pending {
		if s.report.Command != "run" {
			return nil, nil, errors.New("resume the pending run before assess, dry-run or verify")
		}
		s.report.Resumed = true
	} else {
		stats, err := stage.Ingest(ctx, m.src, m.store, s.opts.InstanceID, s.opts.BatchSize)
		if err != nil {
			return nil, nil, err
		}
		s.report.Ingest = IngestInfo{Events: stats.Events, Batches: stats.Batches, Aggregates: stats.Aggregates, Position: stats.Cursor.Position, Restaged: stats.Restaged}
	}
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
	if err := m.preflight(ctx, s, p, mappings); err != nil {
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
		s.report.Actions = append(s.report.Actions, callbackAction(idp))
	}
	if s.opts.V4Callback == "" && len(p.idps) > 0 && len(p.originHints) > 0 {
		s.report.Actions = append(s.report.Actions, "to leave the providers unchanged, pass --v4-callback with the URL they have registered: "+strings.Join(v4CallbackCandidates(p.originHints), ", "))
	}
	if len(s.opts.MasterKey) == 0 && len(p.idps) > 0 {
		s.report.Actions = append(s.report.Actions, "pass the v4 master key (--v4-masterkey-file) so run can move the IdP client secrets")
		s.report.Issues = append(s.report.Issues, Issue{Code: "idp_secrets_unverified", Severity: SeverityConflict, Kind: kindIDP})
	} else if len(p.idps) > 0 {
		keys, keyErr := m.src.LoadKeys(ctx, s.opts.MasterKey)
		for _, idp := range p.idps {
			err := keyErr
			if err == nil {
				_, err = keys.DecryptString(idp.idp.ClientSecret)
			}
			if err != nil {
				s.report.Issues = append(s.report.Issues, Issue{Code: "idp_secret_decryption_failed", Severity: SeverityConflict, Kind: kindIDP, SourceID: idp.idp.ID})
			}
		}
	}
	m.commonActions(s, p)
	err = m.store.SaveRun(ctx, s.opts.InstanceID, "assess", started, s.report)
	if s.report.blocked() {
		err = errors.Join(err, errors.New("assessment found blockers; no target resources were written"))
	}
	return s.report, err
}

// Run ingests the instance and converges nextgen to it.
func (m *Migrator) Run(ctx context.Context, opts Options) (*Report, error) {
	started := time.Now()
	s, err := m.begin(ctx, opts, "run", true)
	if err != nil {
		return nil, err
	}
	defer s.unlock()
	if err := m.store.SaveRun(ctx, s.opts.InstanceID, "run_started", started, s.report); err != nil {
		return s.report, err
	}
	p, mappings, err := m.ingestAndPlan(ctx, s)
	if err != nil {
		return nil, err
	}
	if s.report.blocked() {
		return s.report, errors.New("migration blocked before target writes; resolve the reported conflicts")
	}
	var keys *v4.Keys
	if len(s.opts.MasterKey) > 0 {
		if keys, err = m.src.LoadKeys(ctx, s.opts.MasterKey); err != nil {
			return nil, err
		}
	}
	// Decrypt every required secret before creating any target resources.
	for _, idp := range p.idps {
		if keys == nil {
			return s.report, errors.New("the v4 master key is required to migrate IdP secrets")
		}
		secret, err := keys.DecryptString(idp.idp.ClientSecret)
		if err != nil {
			return s.report, fmt.Errorf("cannot decrypt IdP %s secret", idp.idp.ID)
		}
		mapping := mappings[stage.MappingKey{Kind: kindSecret, ID: idp.idp.ID}]
		project := mappings[stage.MappingKey{Kind: kindProject, ID: s.opts.InstanceID}]
		if mapping != nil && mapping.Applied && project != nil {
			variables, err := m.deps.Variables.GetDecryptedVariables(ctx, domain.VariableOwner{ProjectID: project.TargetID}, nil, mapping.TargetID)
			if err != nil {
				return s.report, err
			}
			_, previous, _ := strings.Cut(mapping.Fingerprint, ".")
			if len(variables) != 1 || !variables[0].IsSecret || (variables[0].Value != secret && fingerprint(variables[0].Value) != previous) {
				return s.report, fmt.Errorf("IdP %s secret changed in the target; refusing to overwrite it", idp.idp.ID)
			}
		}
	}
	if err := m.store.SetPending(ctx, s.opts.InstanceID, true); err != nil {
		return s.report, err
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
	if s.report.blocked() {
		return s.report, errors.New("apply has unresolved conflicts; the pending plan is retained for recovery")
	}
	m.commonActions(s, p)
	if s.report.Resumed {
		s.report.Actions = append(s.report.Actions, "recovered the pending source cut; run again to ingest newer events")
	}
	if err := m.store.SaveRun(ctx, s.opts.InstanceID, "run", started, s.report); err != nil {
		return s.report, err
	}
	return s.report, m.store.SetPending(ctx, s.opts.InstanceID, false)
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
	return errors.New("continuous sync is not implemented safely yet; use an offline run with --v4-stopped and --target-stopped")
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
	pending, err := m.store.Pending(ctx, instanceID)
	if err != nil {
		return err
	}
	fmt.Fprintf(w, "pending apply: %t; ready for cutover: false\n", pending)
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

// Verify reconstructs the stopped source independently and compares target
// fields and credential lineage. It is not a deployed-runtime readiness check.
func (m *Migrator) Verify(ctx context.Context, opts Options) (*Report, error) {
	started := time.Now()
	s, err := m.begin(ctx, opts, "verify", true)
	if err != nil {
		return nil, err
	}
	defer s.unlock()
	if err := m.store.SaveRun(ctx, s.opts.InstanceID, "verify_started", started, s.report); err != nil {
		return s.report, err
	}
	if pending, err := m.store.Pending(ctx, s.opts.InstanceID); err != nil {
		return nil, err
	} else if pending {
		return nil, errors.New("resume the pending run before verification")
	}
	snap, cut, err := sourceSnapshot(ctx, m.src, s.opts.InstanceID)
	if err != nil {
		return nil, err
	}
	s.report.Ingest.Position = cut.Position
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
	if err := m.preflight(ctx, s, p, mappings); err != nil {
		return s.report, err
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
			if team, err := stmts.GetTeamByID(ctx, projectID, id); err == nil && team.Name == t.name && team.Status == domain.TeamStatusActive {
				teams++
			}
		}
	}
	users, passwords, attributes, wantPasswords, ownership := 0, 0, 0, 0, 0
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
		if u.team != nil {
			teamID, ok := target(kindTeam, u.team.orgID)
			membership, err := stmts.GetTeamMembership(ctx, projectID, teamID, id)
			if ok && err == nil && membership.Status == domain.MembershipStatusActive && user.LifecycleOwnerTeamID != nil && *user.LifecycleOwnerTeamID == teamID && user.Metadata.Status == domain.UserStatusActive {
				ownership++
			}
		}
		current := map[string]any{}
		for _, attribute := range user.Attributes {
			current[string(attribute.Key)] = attribute.Value
		}
		if equalJSON(current, u.attributes) {
			attributes++
		}
		if u.passwordHash != "" {
			mapping := mappings[stage.MappingKey{Kind: kindPassword, ID: u.userID}]
			if pw, err := currentPassword(ctx, stmts, projectID, id); err == nil && pw != nil && mapping != nil && mapping.Applied && pw.ID == mapping.TargetID && mapping.Fingerprint == fingerprint(u.passwordHash) {
				passwords++
			}
		}
	}
	idps, secrets := 0, 0
	for _, idp := range p.idps {
		if id, ok := target(kindIDP, idp.idp.ID); ok {
			if connection, err := m.deps.IDPs.Get(ctx, projectID, id); err == nil {
				want, _ := json.Marshal(idp.document)
				if same, _ := domain.JSONEqual(connection.Document, want); same {
					idps++
				}
			}
		}
		mapping := mappings[stage.MappingKey{Kind: kindSecret, ID: idp.idp.ID}]
		if mapping != nil && mapping.Applied && idp.idp.ClientSecret != nil {
			sourceFP, targetFP, _ := strings.Cut(mapping.Fingerprint, ".")
			variables, err := m.deps.Variables.GetDecryptedVariables(ctx, domain.VariableOwner{ProjectID: projectID}, nil, mapping.TargetID)
			if err != nil {
				return s.report, err
			}
			if sourceFP == fingerprint(idp.idp.ClientSecret.Crypted) && len(variables) == 1 && variables[0].IsSecret && variables[0].Kind == domain.DeploymentOriginKindPrimary && fingerprint(variables[0].Value) == targetFP {
				secrets++
			}
		}
	}
	links := 0
	for _, l := range p.links {
		if id, ok := target(kindLink, l.idp.idp.ID+"|"+l.subject); ok {
			if link, err := stmts.GetIDPIdentityLink(ctx, database.And(
				database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), projectID),
				database.Equal(database.Col(domain.IDPIdentityLinkFieldID), id),
			)); err == nil {
				userID, uok := target(kindUser, l.user.userID)
				connectionID, iok := target(kindIDP, l.idp.idp.ID)
				if uok && iok && link.UserID == userID && link.ConnectionID == connectionID && link.Subject == l.subject {
					links++
				}
			}
		}
	}
	check := func(name string, expected, actual int) {
		s.report.Verify = append(s.report.Verify, Check{Name: name, Expected: expected, Actual: actual, OK: expected == actual})
	}
	check("teams", len(p.teams), teams)
	check("users", len(p.users), users)
	check("users whose attributes match v4", len(p.users), attributes)
	check("active users with matching owner and membership", len(p.users), ownership)
	check("password row lineage", wantPasswords, passwords)
	check("IdP connections", len(p.idps), idps)
	check("IdP primary secret variables", len(p.idps), secrets)
	check("identity links", len(p.links), links)
	schemaOK, flowOK := 0, 0
	latestSchema, err := service.LatestSchemaByObjectType(ctx, stmts, projectID, objectTypeHuman)
	if err != nil {
		return s.report, err
	}
	if latestSchema != nil {
		if same, _ := domain.JSONEqual(latestSchema.Schema, p.schema, "$id"); same {
			schemaOK = 1
		}
	}
	document, err := migrationLoginFlow(s.opts.Identifier, p.allowRegister, p.loginSlugs)
	if err != nil {
		return s.report, err
	}
	wantFlow, err := flow_definitions.ParseFlowDefinition(m.deps.BuiltinPublicBase, projectID, document)
	if err != nil {
		return s.report, err
	}
	latestFlows, err := m.deps.Flows.List(ctx, service.ListFlowDefinitionsRequest{ProjectID: projectID, Name: wantFlow.Name, LatestRevisionPerName: true})
	if err != nil {
		return s.report, err
	}
	for _, flow := range latestFlows.Items {
		if sameFlow(flow, wantFlow) {
			flowOK = 1
		}
	}
	check("latest user schema", 1, schemaOK)
	check("latest login flow", 1, flowOK)
	s.report.Actions = append(s.report.Actions, "offline data checks only: build and deploy a release with the migrated schema, flow, IdP revisions and primary secret variables, then test the deployed runtime before cutover")
	err = m.store.SaveRun(ctx, s.opts.InstanceID, "verify", started, s.report)
	if s.report.blocked() {
		err = errors.Join(err, errors.New("verification found blockers"))
	}
	for _, check := range s.report.Verify {
		if !check.OK {
			return s.report, errors.Join(err, errors.New("verification found mismatches"))
		}
	}
	return s.report, err
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
func (m *Migrator) Cleanup(ctx context.Context, instanceID string, force bool) error {
	unlock, err := m.store.Lock(ctx, instanceID)
	if err != nil {
		return err
	}
	defer unlock()
	if pending, err := m.store.Pending(ctx, instanceID); err != nil {
		return err
	} else if pending {
		return errors.New("cannot remove the ledger for a pending apply; resume the run first")
	}
	if !force {
		command, _, document, err := m.store.LastRun(ctx, instanceID)
		if err != nil {
			return err
		}
		var report Report
		if command != "verify" || json.Unmarshal(document, &report) != nil || len(report.Verify) == 0 || report.blocked() {
			return errors.New("cleanup requires a successful offline verify or --force")
		}
		for _, check := range report.Verify {
			if !check.OK {
				return errors.New("cleanup requires a successful offline verify or --force")
			}
		}
	}
	return m.store.DropInstance(ctx, instanceID)
}
