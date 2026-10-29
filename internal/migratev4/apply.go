package migratev4

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

// Kinds of v4 sources in the id map.
const (
	kindProject  = "project"
	kindSchema   = "schema"
	kindTeam     = "team"
	kindIDP      = "idp"
	kindSecret   = "idp_secret"
	kindFlow     = "flow"
	kindUser     = "user"
	kindPassword = "password"
	kindLink     = "link"
)

// actorID is the actor nextgen's events name for everything the migrator
// writes.
const actorID = "migrate-v4"

// applier converges nextgen to a plan. Every resource goes through three
// steps: its id is reserved in the ledger, nextgen is converged to the desired
// state under that id, and the ledger records what was written. A crash
// between any two leaves a state the next run finishes.
type applier struct {
	deps       Deps
	store      *stage.Store
	opts       Options
	report     *Report
	keys       *v4.Keys
	instanceID string
	projectID  string
	// ownsProject is true when the migrator created the project, which
	// makes its login flow the migrator's to rewrite.
	ownsProject bool
	schemaURL   string
	mappings    map[stage.MappingKey]*stage.Mapping
}

func (a *applier) mapping(kind, id string) *stage.Mapping {
	return a.mappings[stage.MappingKey{Kind: kind, ID: id}]
}

// reserve returns the source's mapping, minting and recording a nextgen id
// first when there is none.
func (a *applier) reserve(ctx context.Context, kind, id string, prefix domain.ResourcePrefix) (*stage.Mapping, error) {
	if m := a.mapping(kind, id); m != nil {
		return m, nil
	}
	targetID, err := a.deps.Pool.Statements().NewManagedID(string(prefix))
	if err != nil {
		return nil, err
	}
	return a.record(ctx, kind, id, targetID)
}

// record stores a mapping whose target id nextgen minted.
func (a *applier) record(ctx context.Context, kind, id, targetID string) (*stage.Mapping, error) {
	m := &stage.Mapping{SourceKind: kind, SourceID: id, TargetID: targetID}
	if err := a.store.Reserve(ctx, a.instanceID, m); err != nil {
		return nil, err
	}
	a.mappings[stage.MappingKey{Kind: kind, ID: id}] = m
	return m, nil
}

func (a *applier) markApplied(ctx context.Context, m *stage.Mapping, sequence int64, fingerprint string) error {
	m.AppliedSequence = sequence
	m.Fingerprint = fingerprint
	return a.store.MarkApplied(ctx, a.instanceID, m)
}

func (a *applier) issue(code, severity, kind, id string, err error) {
	detail := ""
	if err != nil && (a.opts.IncludePII || severity == SeverityInfo) {
		detail = err.Error()
	}
	a.report.Issues = append(a.report.Issues, Issue{Code: code, Severity: severity, Kind: kind, SourceID: id, Detail: detail})
}

// actor stamps the migrator on every event written through ctx.
func (a *applier) actor(ctx context.Context) context.Context {
	id, typ := actorID, domain.EventActorTypeSystem
	return audit.WithActorContext(ctx, audit.ActorContext{ProjectID: a.projectID, ActorID: &id, ActorType: &typ})
}

func fingerprint(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // only JSON-safe values are fingerprinted
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func (a *applier) apply(ctx context.Context, p *plan) error {
	ctx = a.actor(service.WithAuthzListUnrestricted(ctx))
	if err := a.applyProject(ctx); err != nil {
		return err
	}
	ctx = a.actor(ctx) // again, now with the project
	a.report.Target = &TargetInfo{ProjectID: a.projectID}
	if err := a.applySchema(ctx, p.schema); err != nil {
		return err
	}
	a.report.Target.SchemaURL = a.schemaURL
	for _, team := range p.teams {
		if err := a.applyTeam(ctx, team); err != nil {
			return err
		}
	}
	for _, idp := range p.idps {
		if err := a.applyIDP(ctx, idp); err != nil {
			return err
		}
	}
	if err := a.applyFlow(ctx, p.loginSlugs); err != nil {
		return err
	}
	for _, user := range p.users {
		if err := a.applyUser(ctx, user); err != nil {
			return err
		}
	}
	for _, link := range p.links {
		if err := a.applyLink(ctx, link); err != nil {
			return err
		}
	}
	for _, team := range p.teams {
		if err := a.deactivateTeam(ctx, team); err != nil {
			return err
		}
	}
	for _, userID := range p.gone {
		if err := a.deactivateGone(ctx, userID, "v4_user_gone"); err != nil {
			return err
		}
	}
	a.reportOrphans(p)
	return nil
}

// ---- project ---------------------------------------------------------------

func (a *applier) applyProject(ctx context.Context) error {
	m := a.mapping(kindProject, a.instanceID)
	if a.opts.ProjectID != "" {
		if m != nil && m.TargetID != a.opts.ProjectID {
			return fmt.Errorf("instance %s was migrated into project %s before, not %s", a.instanceID, m.TargetID, a.opts.ProjectID)
		}
		if _, err := a.deps.Projects.Get(ctx, a.opts.ProjectID); err != nil {
			return fmt.Errorf("target project %s: %w", a.opts.ProjectID, err)
		}
		a.projectID = a.opts.ProjectID
		if m == nil {
			var err error
			if m, err = a.record(ctx, kindProject, a.instanceID, a.opts.ProjectID); err != nil {
				return err
			}
			a.report.count(kindProject).Unchanged++
			return a.markApplied(ctx, m, 0, "existing")
		}
		a.report.count(kindProject).Unchanged++
		return nil
	}
	m, err := a.reserve(ctx, kindProject, a.instanceID, domain.PrefixProject)
	if err != nil {
		return err
	}
	a.projectID = m.TargetID
	a.ownsProject = m.Fingerprint != "existing"
	if m.Applied {
		a.report.count(kindProject).Unchanged++
		return nil
	}
	name := a.report.Instance.Name
	if name == "" {
		name = "Zitadel v4 " + a.instanceID
	}
	if _, err := a.deps.Projects.CreateWithID(ctx, m.TargetID, name, []domain.Origin{}, true); err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); !ok {
			return fmt.Errorf("create project: %w", err)
		}
		// Created by a run that stopped before marking it.
	}
	a.ownsProject = true
	a.report.count(kindProject).Created++
	return a.markApplied(ctx, m, 0, "created")
}

// ---- user schema -----------------------------------------------------------

func (a *applier) applySchema(ctx context.Context, schema []byte) error {
	fp := fingerprint(json.RawMessage(schema))
	m := a.mapping(kindSchema, objectTypeHuman)
	if m != nil && m.Applied && m.Fingerprint == fp {
		a.schemaURL = m.TargetID
		a.report.count(kindSchema).Unchanged++
		return nil
	}
	created, err := a.deps.Schemas.CreateSchema(ctx, service.CreateSchemaInput{ProjectID: a.projectID, Schema: schema})
	if err != nil {
		return fmt.Errorf("create the v4 user schema: %w", err)
	}
	a.schemaURL = created.URL
	if m == nil {
		if m, err = a.record(ctx, kindSchema, objectTypeHuman, created.URL); err != nil {
			return err
		}
		a.report.count(kindSchema).Created++
	} else {
		m.TargetID = created.URL
		a.report.count(kindSchema).Updated++
	}
	return a.markApplied(ctx, m, 0, fp)
}

// ---- teams -----------------------------------------------------------------

func (a *applier) applyTeam(ctx context.Context, t *teamPlan) error {
	m, err := a.reserve(ctx, kindTeam, t.orgID, domain.PrefixTeam)
	if err != nil {
		return err
	}
	fp := fingerprint(t.name)
	stmts := a.deps.Pool.Statements()
	existing, err := stmts.GetTeamByID(ctx, a.projectID, m.TargetID)
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		existing, err = nil, nil
	}
	if err != nil {
		return fmt.Errorf("read team for org %s: %w", t.orgID, err)
	}
	switch {
	case existing == nil:
		err = a.deps.Pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			team, err := domain.NewTeam(a.projectID, t.name)
			if err != nil {
				return err
			}
			team.ID = m.TargetID
			if err := tx.Statements().CreateTeam(ctx, team); err != nil {
				return err
			}
			return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
				Type: domain.EventTypeTeamCreated, Category: domain.EventCategoryAdmin, ProjectID: a.projectID,
				EntityType: "team", EntityID: team.ID, Payload: domain.TeamPayload{Name: team.Name},
			})
		})
		if err != nil {
			a.issue("team_create_failed", SeverityConflict, "org", t.orgID, err)
			a.report.count(kindTeam).Failed++
			return nil
		}
		a.report.count(kindTeam).Created++
	case m.Applied && m.Fingerprint == fp:
		a.report.count(kindTeam).Unchanged++
		return nil
	case existing.Name != t.name:
		err = a.deps.Pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			existing.Name = t.name
			if err := tx.Statements().UpdateTeam(ctx, existing); err != nil {
				return err
			}
			return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
				Type: domain.EventTypeTeamUpdated, Category: domain.EventCategoryAdmin, ProjectID: a.projectID,
				EntityType: "team", EntityID: existing.ID, Payload: domain.TeamPayload{Name: t.name},
			})
		})
		if err != nil {
			a.issue("team_update_failed", SeverityWarning, "org", t.orgID, err)
			a.report.count(kindTeam).Failed++
			return nil
		}
		a.report.count(kindTeam).Updated++
	default:
		a.report.count(kindTeam).Unchanged++
	}
	return a.markApplied(ctx, m, t.seq, fp)
}

func (a *applier) deactivateTeam(ctx context.Context, t *teamPlan) error {
	m := a.mapping(kindTeam, t.orgID)
	if m == nil || !m.Applied {
		return nil
	}
	if !t.deactivate {
		team, err := a.deps.Pool.Statements().GetTeamByID(ctx, a.projectID, m.TargetID)
		if err == nil && team.Status == domain.TeamStatusDeactivated {
			a.issue("team_reactivation_unsupported", SeverityWarning, "org", t.orgID, errors.New("the org is active again in v4; nextgen cannot reactivate a team"))
		}
		return nil
	}
	return a.deps.Pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		changed, err := tx.Statements().DeactivateTeam(ctx, a.projectID, m.TargetID)
		if err != nil || !changed {
			return err
		}
		a.report.count(kindTeam).Updated++
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type: domain.EventTypeTeamDeactivated, Category: domain.EventCategoryAdmin, ProjectID: a.projectID,
			EntityType: "team", EntityID: m.TargetID, Payload: struct{}{},
		})
	})
}

// ---- IdPs ------------------------------------------------------------------

func (a *applier) applyIDP(ctx context.Context, p *idpPlan) error {
	idp := p.idp
	switch {
	case idp.ClientSecret == nil:
		a.issue("idp_secret_missing", SeverityWarning, "idp", idp.ID, fmt.Errorf("v4 has no client secret; set variable %s", p.secretVar))
	case a.keys == nil:
		a.issue("idp_secret_not_migrated", SeverityWarning, "idp", idp.ID, fmt.Errorf("no v4 master key given; set variable %s", p.secretVar))
		a.report.Actions = append(a.report.Actions, fmt.Sprintf("set the client secret of %q: zitadel variable set %s --secret", p.slug, p.secretVar))
	default:
		fp := fingerprint(idp.ClientSecret.Crypted)
		if m := a.mapping(kindSecret, idp.ID); m == nil || !m.Applied || m.Fingerprint != fp {
			secret, err := a.keys.DecryptString(idp.ClientSecret)
			if err != nil {
				return fmt.Errorf("decrypt the client secret of IdP %s: %w", idp.ID, err)
			}
			if err := a.deps.Variables.SetVariables(ctx, domain.VariableOwner{ProjectID: a.projectID}, nil,
				[]service.VariableToSet{{Name: p.secretVar, Value: secret, IsSecret: true}}); err != nil {
				return fmt.Errorf("store the client secret of IdP %s: %w", idp.ID, err)
			}
			if m == nil {
				if m, err = a.record(ctx, kindSecret, idp.ID, p.secretVar); err != nil {
					return err
				}
			}
			if err := a.markApplied(ctx, m, p.seq, fp); err != nil {
				return err
			}
			a.report.count(kindSecret).Created++
		} else {
			a.report.count(kindSecret).Unchanged++
		}
	}

	document, err := json.Marshal(p.document)
	if err != nil {
		return err
	}
	fp := fingerprint(json.RawMessage(document))
	m := a.mapping(kindIDP, idp.ID)
	if m != nil && m.Applied && m.Fingerprint == fp {
		a.report.count(kindIDP).Unchanged++
	} else {
		out, err := a.deps.IDPs.CreateOrRevise(ctx, a.projectID, document)
		if err != nil {
			a.issue("idp_create_failed", SeverityConflict, "idp", idp.ID, err)
			a.report.count(kindIDP).Failed++
			return nil
		}
		if m == nil {
			if m, err = a.record(ctx, kindIDP, idp.ID, out.Connection.ID); err != nil {
				return err
			}
		}
		m.TargetID = out.Connection.ID
		if err := a.markApplied(ctx, m, p.seq, fp); err != nil {
			return err
		}
		if out.Created {
			a.report.count(kindIDP).Created++
		} else {
			a.report.count(kindIDP).Updated++
		}
	}
	a.report.Actions = append(a.report.Actions, fmt.Sprintf("register the redirect URI https://<app origin>/__nextgen/idp/%s/callback at %q (v4 id %s)", p.slug, idp.Name, idp.ID))
	return nil
}

// applyFlow offers the migrated instance IdPs on the project's login flow,
// as a new revision of the shipped flow. It only touches a project the
// migrator created: anyone else's flow is theirs to edit.
func (a *applier) applyFlow(ctx context.Context, slugs []string) error {
	if len(slugs) == 0 {
		return nil
	}
	if !a.ownsProject {
		a.report.Actions = append(a.report.Actions, fmt.Sprintf("offer the migrated IdPs on the login flow: zitadel auth-method sso enable for %v", slugs))
		return nil
	}
	fp := fingerprint(slugs)
	m := a.mapping(kindFlow, "login")
	if m != nil && m.Applied && m.Fingerprint == fp {
		a.report.count(kindFlow).Unchanged++
		return nil
	}
	document, err := loginFlowWithSSO(configdefaults.DefaultLoginFlowDefinition(), slugs)
	if err != nil {
		return err
	}
	def, err := flow_definitions.ParseFlowDefinition(a.deps.BuiltinPublicBase, a.projectID, document)
	if err != nil {
		return fmt.Errorf("parse the login flow: %w", err)
	}
	purposes := make(map[string]string, len(def.Purposes))
	for purpose, step := range def.Purposes {
		purposes[purpose.String()] = step
	}
	created, err := a.deps.Flows.Create(ctx, service.FlowDefinitionRequest{
		ProjectID:     a.projectID,
		Name:          def.Name,
		Status:        def.Status.String(),
		SchemaVersion: def.SchemaVersion,
		UserSchema:    def.UserSchema,
		Purposes:      purposes,
		Audience:      def.Audience,
		Steps:         def.Steps,
	})
	if err != nil {
		return fmt.Errorf("offer the IdPs on the login flow: %w", err)
	}
	if m == nil {
		if m, err = a.record(ctx, kindFlow, "login", created.ID); err != nil {
			return err
		}
		a.report.count(kindFlow).Created++
	} else {
		m.TargetID = created.ID
		a.report.count(kindFlow).Updated++
	}
	return a.markApplied(ctx, m, 0, fp)
}

// ---- users -----------------------------------------------------------------

// userState is what the user fingerprint covers besides the attributes and
// the password, which has its own mapping so the ledger never holds a hash.
type userState struct {
	Team       string `json:"team,omitempty"`
	Deactivate bool   `json:"deactivate,omitempty"`
}

// userFingerprint is "<attributes>.<state>": the attribute half is compared
// with what nextgen holds, to notice an edit made there since the last run.
func userFingerprint(attributes map[string]any, state userState) string {
	return fingerprint(attributes) + "." + fingerprint(state)
}

func (a *applier) applyUser(ctx context.Context, u *userPlan) error {
	m, err := a.reserve(ctx, kindUser, u.userID, domain.PrefixUser)
	if err != nil {
		return err
	}
	var teamID *string
	if u.team != nil {
		if tm := a.mapping(kindTeam, u.team.orgID); tm != nil && tm.Applied {
			teamID = &tm.TargetID
		}
	}
	state := userState{Deactivate: u.deactivate}
	if teamID != nil {
		state.Team = *teamID
	}
	fp := userFingerprint(u.attributes, state)
	pwFP := ""
	if u.passwordHash != "" {
		pwFP = fingerprint(u.passwordHash)
	}

	exists, err := a.deps.Pool.Statements().UserExists(ctx, a.projectID, m.TargetID)
	if err != nil {
		return fmt.Errorf("check user %s: %w", u.userID, err)
	}
	if !exists {
		actions := []service.UserAction{&ownedCreateUser{
			CreateUserAction: service.NewCreateUserAction(service.CreateUserInput{
				ProjectID:  a.projectID,
				TeamID:     teamID,
				SchemaURL:  a.schemaURL,
				Attributes: u.attributes,
				ID:         m.TargetID,
			}, a.deps.SchemaStore),
			owner: teamID,
		}}
		if u.passwordHash != "" {
			actions = append(actions, setPasswordHash{projectID: a.projectID, userID: m.TargetID, hash: u.passwordHash})
		}
		if u.deactivate {
			actions = append(actions, deactivateUser{projectID: a.projectID, userID: m.TargetID})
		}
		if err := a.deps.Users.ApplyActions(ctx, actions...); err != nil {
			a.issue("user_create_failed", SeverityConflict, "user", u.userID, err)
			a.report.count(kindUser).Failed++
			return nil
		}
		a.report.count(kindUser).Created++
		if err := a.markPassword(ctx, u.userID, m.TargetID, pwFP, u.seq); err != nil {
			return err
		}
		return a.markApplied(ctx, m, u.seq, fp)
	}

	if m.Applied && m.Fingerprint == fp && a.passwordCurrent(u.userID, pwFP) {
		a.report.count(kindUser).Unchanged++
		return nil
	}
	current, err := a.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: a.projectID, UserID: m.TargetID})
	if err != nil {
		return fmt.Errorf("read user %s: %w", u.userID, err)
	}
	patch := map[string]any{}
	currentAttributes := map[string]any{}
	for _, attribute := range current.Attributes {
		currentAttributes[string(attribute.Key)] = attribute.Value
	}
	// v4 is the only writer until cutover: an edit made in nextgen since the
	// last run is reported rather than overwritten.
	if written, _, ok := strings.Cut(m.Fingerprint, "."); m.Applied && ok && fingerprint(currentAttributes) != written {
		a.issue("user_edited_in_nextgen", SeverityConflict, "user", u.userID, errors.New("changed in nextgen since the last run; the v4 changes are not applied over it"))
		a.report.count(kindUser).Skipped++
		return nil
	}
	for key, value := range u.attributes {
		if !equalJSON(currentAttributes[key], value) {
			patch[key] = value
		}
	}
	for key := range currentAttributes {
		if _, ok := u.attributes[key]; !ok {
			patch[key] = nil
		}
	}
	if len(patch) > 0 {
		if _, err := a.deps.Users.PatchUser(ctx, service.PatchUserInput{ProjectID: a.projectID, UserID: m.TargetID, Attributes: patch}); err != nil {
			a.issue("user_update_failed", SeverityConflict, "user", u.userID, err)
			a.report.count(kindUser).Failed++
			return nil
		}
	}
	var actions []service.UserAction
	if u.passwordHash != "" && !a.passwordCurrent(u.userID, pwFP) {
		actions = append(actions, setPasswordHash{projectID: a.projectID, userID: m.TargetID, hash: u.passwordHash})
	}
	switch status := current.Metadata.Status; {
	case u.deactivate && status == domain.UserStatusActive:
		actions = append(actions, deactivateUser{projectID: a.projectID, userID: m.TargetID})
	case !u.deactivate && status == domain.UserStatusDeactivated:
		a.issue("user_reactivation_unsupported", SeverityWarning, "user", u.userID, errors.New("active again in v4; nextgen has no reactivation yet"))
	}
	if len(actions) > 0 {
		if err := a.deps.Users.ApplyActions(ctx, actions...); err != nil {
			a.issue("user_update_failed", SeverityConflict, "user", u.userID, err)
			a.report.count(kindUser).Failed++
			return nil
		}
	}
	if len(patch) > 0 || len(actions) > 0 {
		a.report.count(kindUser).Updated++
	} else {
		a.report.count(kindUser).Unchanged++
	}
	if err := a.markPassword(ctx, u.userID, m.TargetID, pwFP, u.seq); err != nil {
		return err
	}
	return a.markApplied(ctx, m, u.seq, fp)
}

func (a *applier) passwordCurrent(userID, fp string) bool {
	m := a.mapping(kindPassword, userID)
	if fp == "" {
		return true // nothing to set; nextgen cannot remove a password
	}
	return m != nil && m.Applied && m.Fingerprint == fp
}

func (a *applier) markPassword(ctx context.Context, userID, targetID, fp string, sequence int64) error {
	if fp == "" {
		return nil
	}
	m := a.mapping(kindPassword, userID)
	if m == nil {
		var err error
		if m, err = a.record(ctx, kindPassword, userID, targetID); err != nil {
			return err
		}
	}
	return a.markApplied(ctx, m, sequence, fp)
}

// deactivateGone deactivates a migrated user that v4 no longer has.
func (a *applier) deactivateGone(ctx context.Context, userID, code string) error {
	m := a.mapping(kindUser, userID)
	if m == nil || !m.Applied {
		return nil
	}
	user, err := a.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: a.projectID, UserID: m.TargetID})
	if errors.Is(err, domain.ErrUserNotFound()) {
		return nil
	}
	if err != nil {
		return err
	}
	if user.Metadata.Status != domain.UserStatusActive {
		return nil
	}
	if err := a.deps.Users.ApplyActions(ctx, deactivateUser{projectID: a.projectID, userID: m.TargetID}); err != nil {
		return err
	}
	a.issue(code, SeverityInfo, "user", userID, errors.New("removed in v4, deactivated in nextgen"))
	a.report.count(kindUser).Updated++
	return nil
}

// ownedCreateUser is the service's create action with the lifecycle owner,
// which no service sets yet (ADR 024), set between its two phases.
type ownedCreateUser struct {
	*service.CreateUserAction
	owner *string
}

func (o *ownedCreateUser) Prepare(ctx context.Context) error {
	if err := o.CreateUserAction.Prepare(ctx); err != nil {
		return err
	}
	o.CreateUser.LifecycleOwnerTeamID = o.owner
	return nil
}

// setPasswordHash stores a v4 hash as it is. The service only takes
// plaintext, so this is the statement plus the event the service emits.
type setPasswordHash struct {
	projectID, userID, hash string
}

func (setPasswordHash) Prepare(context.Context) error { return nil }

func (s setPasswordHash) Apply(ctx context.Context, stmts service.AllStatements) error {
	pw := &domain.SetUserPassword{ProjectID: s.projectID, UserID: s.userID, EncodedHash: s.hash}
	if err := stmts.SetUserPassword(ctx, pw); err != nil {
		return fmt.Errorf("set password hash: %w", err)
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type: domain.EventTypeAuthFactorPasswordSet, Category: domain.EventCategoryAuth, ProjectID: s.projectID,
		EntityType: "user_password", EntityID: pw.ID, Payload: domain.AuthFactorPayload{UserID: s.userID, FactorID: pw.ID},
	})
}

// deactivateUser is the statement alone: user.deactivated is a deferred
// event type (#878).
type deactivateUser struct {
	projectID, userID string
}

func (deactivateUser) Prepare(context.Context) error { return nil }

func (d deactivateUser) Apply(ctx context.Context, stmts service.AllStatements) error {
	return stmts.DeactivateUser(ctx, d.projectID, d.userID)
}

// ---- links -----------------------------------------------------------------

func (a *applier) applyLink(ctx context.Context, l *linkPlan) error {
	user := a.mapping(kindUser, l.user.userID)
	connection := a.mapping(kindIDP, l.idp.idp.ID)
	if user == nil || !user.Applied || connection == nil || !connection.Applied {
		a.report.count(kindLink).Skipped++
		return nil
	}
	key := l.idp.idp.ID + "|" + l.subject
	m, err := a.reserve(ctx, kindLink, key, domain.PrefixIDPIdentityLink)
	if err != nil {
		return err
	}
	if m.Applied {
		a.report.count(kindLink).Unchanged++
		return nil
	}
	link := &domain.IDPIdentityLink{ProjectID: a.projectID, ID: m.TargetID, ConnectionID: connection.TargetID, Subject: l.subject, UserID: user.TargetID}
	err = a.deps.Pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		if err := tx.Statements().CreateIDPIdentityLink(ctx, link); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type: domain.EventTypeIDPIdentityLinkCreated, Category: domain.EventCategoryEntity, ProjectID: a.projectID,
			EntityType: "idp_identity_link", EntityID: link.ID,
			Payload: domain.IDPIdentityLinkCreatedPayload{ConnectionID: link.ConnectionID, UserID: link.UserID},
		})
	})
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		existing, getErr := a.deps.Pool.Statements().GetIDPIdentityLink(ctx, database.And(
			database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), a.projectID),
			database.Equal(database.Col(domain.IDPIdentityLinkFieldConnectionID), connection.TargetID),
			database.Equal(database.Col(domain.IDPIdentityLinkFieldSubject), l.subject),
		))
		if getErr == nil && existing.UserID == user.TargetID {
			// Written by a run that stopped before marking it.
			a.report.count(kindLink).Unchanged++
			return a.markApplied(ctx, m, l.user.seq, existing.ID)
		}
		a.issue("link_conflict", SeverityConflict, "link", key, err)
		a.report.count(kindLink).Failed++
		return nil
	}
	if err != nil {
		return fmt.Errorf("create identity link %s: %w", key, err)
	}
	a.report.count(kindLink).Created++
	return a.markApplied(ctx, m, l.user.seq, link.ID)
}

// reportOrphans names what nextgen still holds but v4 no longer has, and the
// migrator cannot remove.
func (a *applier) reportOrphans(p *plan) {
	links := map[string]bool{}
	for _, l := range p.links {
		links[l.idp.idp.ID+"|"+l.subject] = true
	}
	for key, m := range a.mappings {
		switch {
		case key.Kind == kindLink && m.Applied && !links[key.ID]:
			a.issue("link_removed_in_v4", SeverityWarning, "link", key.ID, errors.New("nextgen cannot delete an identity link yet"))
		case key.Kind == kindIDP && m.Applied && p.idpByID[key.ID] == nil:
			a.issue("idp_removed_in_v4", SeverityWarning, "idp", key.ID, errors.New("nextgen cannot delete a connection yet (#1013)"))
		}
	}
	slices.SortFunc(a.report.Issues, func(x, y Issue) int {
		if x.Code != y.Code {
			if x.Code < y.Code {
				return -1
			}
			return 1
		}
		if x.SourceID < y.SourceID {
			return -1
		}
		if x.SourceID > y.SourceID {
			return 1
		}
		return 0
	})
}

func equalJSON(a, b any) bool {
	x, errA := json.Marshal(a)
	y, errB := json.Marshal(b)
	return errA == nil && errB == nil && string(x) == string(y)
}
