package migratev4

import (
	"cmp"
	"context"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/cases"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/idp"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
)

// snapshot is everything staged for one instance.
type snapshot struct {
	instance    *stage.Instance
	instanceSeq int64
	orgs        map[string]*stage.Org
	orgSeq      map[string]int64
	users       map[string]*stage.User
	userSeq     map[string]int64
	// objects are the counted aggregates, by aggregate type and id.
	objects map[string]map[string]*stage.Object
}

func loadSnapshot(ctx context.Context, store *stage.Store, instanceID string) (*snapshot, error) {
	var aggregates []*stage.Staged
	for aggregateType := range stage.EventTypes() {
		all, err := store.All(ctx, instanceID, aggregateType)
		if err != nil {
			return nil, err
		}
		aggregates = append(aggregates, all...)
	}
	return snapshotOf(aggregates, instanceID)
}

// sourceSnapshot reconstructs independently of the durable stage. Verify must
// not certify a stale or damaged stage by comparing it only with its own output.
// The caller requires the source stopped, so every read belongs to one cut.
func sourceSnapshot(ctx context.Context, src *v4.Source, instanceID string) (*snapshot, v4.Cursor, error) {
	filter := v4.NewTypeFilter(stage.EventTypes())
	cursor := v4.Start
	all := map[v4.AggregateKey]*stage.Staged{}
	for {
		keys, last, read, err := src.Changed(ctx, instanceID, cursor, filter, stage.DefaultBatchSize)
		if err != nil {
			return nil, cursor, err
		}
		if read == 0 {
			break
		}
		after := map[v4.AggregateKey]int64{}
		for _, key := range keys {
			if all[key] == nil {
				all[key] = &stage.Staged{Key: key, Doc: stage.NewDoc(key.Type)}
			}
			after[key] = all[key].Sequence
		}
		events, err := src.Events(ctx, instanceID, after, filter.EventTypes())
		if err != nil {
			return nil, cursor, err
		}
		byKey := map[v4.AggregateKey][]v4.Event{}
		for _, event := range events {
			key := v4.AggregateKey{Type: event.AggregateType, ID: event.AggregateID}
			byKey[key] = append(byKey[key], event)
		}
		for key, events := range byKey {
			if err := all[key].Fold(events); err != nil {
				return nil, cursor, err
			}
		}
		cursor = last
	}
	aggregates := make([]*stage.Staged, 0, len(all))
	for _, aggregate := range all {
		aggregates = append(aggregates, aggregate)
	}
	snap, err := snapshotOf(aggregates, instanceID)
	return snap, cursor, err
}

func snapshotOf(aggregates []*stage.Staged, instanceID string) (*snapshot, error) {
	snap := &snapshot{
		orgs:    map[string]*stage.Org{},
		orgSeq:  map[string]int64{},
		users:   map[string]*stage.User{},
		userSeq: map[string]int64{},
		objects: map[string]map[string]*stage.Object{},
	}
	for _, st := range aggregates {
		aggregateType := st.Key.Type
		switch doc := st.Doc.(type) {
		case *stage.Instance:
			if st.Key.ID == instanceID {
				snap.instance, snap.instanceSeq = doc, st.Sequence
			}
		case *stage.Org:
			snap.orgs[st.Key.ID], snap.orgSeq[st.Key.ID] = doc, st.Sequence
		case *stage.User:
			snap.users[st.Key.ID], snap.userSeq[st.Key.ID] = doc, st.Sequence
		case *stage.Object:
			if snap.objects[aggregateType] == nil {
				snap.objects[aggregateType] = map[string]*stage.Object{}
			}
			snap.objects[aggregateType][st.Key.ID] = doc
		}
	}
	if snap.instance == nil {
		return nil, fmt.Errorf("instance %s has no staged events: run ingest first, or check the instance id", instanceID)
	}
	return snap, nil
}

type teamPlan struct {
	orgID      string
	name       string
	deactivate bool
	seq        int64
}

type idpPlan struct {
	idp        *stage.IDP
	ownerOrgID string // empty for the instance
	slug       string
	secretVar  string
	// callback is the v4 callback URL the connection keeps, or "".
	callback string
	document map[string]any
	seq      int64
}

type userPlan struct {
	userID       string
	user         *stage.User
	seq          int64
	attributes   map[string]any
	team         *teamPlan // owner and membership; nil is self-owned
	passwordHash string
	// passwordVersion names the v4 event that set passwordHash: the ledger
	// records it, never a digest of the hash, to notice a password change.
	passwordVersion string
	deactivate      bool
}

type linkPlan struct {
	user    *userPlan
	idp     *idpPlan
	subject string
}

// plan is the nextgen state the staged v4 state should produce.
type plan struct {
	teams         []*teamPlan
	teamByOrg     map[string]*teamPlan
	idps          []*idpPlan
	idpByID       map[string]*idpPlan
	users         []*userPlan
	links         []*linkPlan
	loginSlugs    []string
	allowRegister bool
	schema        []byte
	// gone are v4 users that no longer migrate: removed, or their org
	// removed. One already in nextgen is deactivated.
	gone []string
	// originHints are the domains v4 served sign-in on, for the report.
	originHints []string
}

// buildPlan derives the plan and fills the report's counts and issues.
// existingSlugs are the slugs of connections an earlier run created, by v4
// IdP id: a slug is fixed for life, so a renamed IdP keeps it.
func buildPlan(snap *snapshot, opts Options, hasher *crypto.PasswapHasher, builtinPublicBase string, existingSlugs map[string]string, report *Report) (*plan, error) {
	p := &plan{teamByOrg: map[string]*teamPlan{}, idpByID: map[string]*idpPlan{}}
	inst := snap.instance
	p.allowRegister = inst.LoginPolicy.AllowRegister
	report.Instance.Name = inst.Name
	report.Instance.DefaultOrgID = inst.DefaultOrgID
	p.originHints = sortedKeys(inst.Domains, strings.Compare)
	issue := func(code, severity, kind, id, detail string) {
		if !opts.IncludePII {
			detail = ""
		}
		report.Issues = append(report.Issues, Issue{Code: code, Severity: severity, Kind: kind, SourceID: id, Detail: detail})
	}

	// ---- organizations → teams
	orgIDs := sortedKeys(snap.orgs, func(a, b string) int {
		return cmp.Or(snap.orgs[a].CreatedAt.Compare(snap.orgs[b].CreatedAt), strings.Compare(a, b))
	})
	var removedOrgs, inactiveOrgs int
	taken := map[string]bool{}
	for _, orgID := range orgIDs {
		org := snap.orgs[orgID]
		switch {
		case org.State == stage.OrgRemoved || org.State == "":
			removedOrgs++
			continue
		case orgID == inst.DefaultOrgID && opts.DefaultOrgUsers == DefaultOrgUsersSelf:
			continue
		}
		name, err := domain.ValidateTeamName(org.Name)
		if err != nil {
			name = "v4 org " + orgID
			issue("team_name_invalid", SeverityWarning, "org", orgID, org.Name)
		}
		if taken[fold(name)] {
			name = truncate(fmt.Sprintf("%s (v4 %s)", name, orgID), domain.TeamNameMaxLength)
			issue("team_name_taken", SeverityInfo, "org", orgID, "renamed to "+name)
			if taken[fold(name)] {
				issue("team_name_conflict", SeverityConflict, "org", orgID, "the derived team name is also taken")
			}
		}
		taken[fold(name)] = true
		team := &teamPlan{orgID: orgID, name: name, deactivate: org.State == stage.OrgInactive, seq: snap.orgSeq[orgID]}
		if team.deactivate {
			inactiveOrgs++
			issue("inactive_org_unsupported", SeverityConflict, "org", orgID, "inactive lifecycle enforcement is not yet complete in nextgen")
		}
		p.teams = append(p.teams, team)
		p.teamByOrg[orgID] = team
	}
	report.Migrates = append(report.Migrates, Line{Item: "organizations -> teams", Count: len(p.teams), Note: noteIf(inactiveOrgs > 0, "%d inactive, deactivated", inactiveOrgs)})
	if opts.DefaultOrgUsers == DefaultOrgUsersSelf && snap.orgs[inst.DefaultOrgID] != nil {
		report.Migrates = append(report.Migrates, Line{Item: "default organization -> no team", Count: 1, Note: "its users are self-owned"})
	}

	// ---- IdPs → connections
	type ownedIDP struct {
		idp   *stage.IDP
		owner string
	}
	var candidates []ownedIDP
	for _, idp := range sortedIDPs(inst.IDPs) {
		candidates = append(candidates, ownedIDP{idp, ""})
	}
	for _, orgID := range orgIDs {
		if org := snap.orgs[orgID]; org.State != stage.OrgRemoved {
			for _, idp := range sortedIDPs(org.IDPs) {
				candidates = append(candidates, ownedIDP{idp, orgID})
			}
		}
	}
	unsupported := map[string]int{}
	slugsTaken := map[string]bool{}
	for _, slug := range existingSlugs {
		slugsTaken[slug] = true
	}
	for _, c := range candidates {
		idp := c.idp
		if idp.Removed {
			continue
		}
		if idp.Type != stage.IDPOIDC && idp.Type != stage.IDPGoogle {
			unsupported[idp.Type]++
			continue
		}
		if idp.Type == stage.IDPOIDC && idp.Issuer == "" {
			issue("idp_without_issuer", SeverityConflict, "idp", idp.ID, idp.Name)
			continue
		}
		slug, ok := existingSlugs[idp.ID]
		if !ok {
			slug = deriveSlug(idp.Name, idp.ID, slugsTaken)
			slugsTaken[slug] = true
		}
		plan := &idpPlan{idp: idp, ownerOrgID: c.owner, slug: slug, seq: snap.instanceSeq}
		if c.owner != "" {
			plan.seq = snap.orgSeq[c.owner]
		}
		// Keep variable identity independent of a display name or a lossy slug conversion.
		plan.secretVar = "V4_IDP_" + strings.ToUpper(fingerprint(idp.ID)) + "_CLIENT_SECRET"
		plan.callback = opts.callbackFor(idp.ID)
		plan.document = connectionDocument(plan)
		if idp.Options.IsCreationAllowed != idp.Options.IsAutoCreation {
			issue("idp_creation_policy_unsupported", SeverityConflict, "idp", idp.ID, "manual creation and inconsistent auto-creation flags cannot be preserved")
		}
		if idp.Options.IsAutoCreation && !p.allowRegister {
			issue("idp_registration_policy_unsupported", SeverityConflict, "idp", idp.ID, "automatic creation conflicts with disabled registration")
		}
		if idp.Options.IsLinkingAllowed || idp.Options.AutoLinkingOption != 0 || idp.Options.IsAutoUpdate {
			issue("idp_linking_policy_unsupported", SeverityConflict, "idp", idp.ID, "provider linking and automatic profile updates need explicit policy mapping")
		}
		if idp.ClientSecret == nil {
			issue("idp_secret_missing", SeverityConflict, "idp", idp.ID, "a usable client secret is required")
		}
		p.idps = append(p.idps, plan)
		p.idpByID[idp.ID] = plan
	}
	if len(p.idps) > 0 {
		slugs := make([]string, 0, len(p.idps))
		for _, idp := range p.idps {
			slugs = append(slugs, idp.slug)
		}
		report.Migrates = append(report.Migrates, Line{Item: "OIDC and Google IdPs -> IdP connections", Count: len(p.idps), Note: strings.Join(slugs, ", ")})
	}
	for _, id := range sortedKeys(opts.V4CallbackFor, strings.Compare) {
		if p.idpByID[id] == nil {
			issue("v4_callback_idp_unknown", SeverityWarning, "idp", id, "--v4-callback-for names no migrated IdP")
		}
	}
	keeping := 0
	for _, plan := range p.idps {
		if plan.callback != "" {
			keeping++
		}
	}
	if keeping > 0 {
		report.Migrates = append(report.Migrates, Line{Item: "v4 callback URLs kept", Count: keeping, Note: "the providers need no new registration"})
	}
	for _, typ := range sortedKeys(unsupported, strings.Compare) {
		report.NotMigrated = append(report.NotMigrated, Line{Item: "IdPs of type " + typ, Count: unsupported[typ], Note: "nextgen connections speak OIDC only"})
	}
	if inst.LoginPolicy.AllowExternalIDP {
		for _, id := range inst.LoginIDPs {
			if idp, ok := p.idpByID[id]; ok && idp.ownerOrgID == "" {
				p.loginSlugs = append(p.loginSlugs, idp.slug)
			}
		}
	}
	orgOwned := 0
	for _, idp := range p.idps {
		if idp.ownerOrgID != "" {
			orgOwned++
		}
	}
	if orgOwned > 0 {
		report.Partial = append(report.Partial, Line{Item: "org-owned IdPs", Count: orgOwned, Note: "created, not offered at sign-in: nextgen has no team-scoped login yet"})
	}

	schema, err := userSchema(builtinPublicBase, opts.Identifier, p.loginSlugs)
	if err != nil {
		return nil, err
	}
	p.schema = schema

	// ---- users
	userIDs := sortedKeys(snap.users, func(a, b string) int {
		return cmp.Or(snap.users[a].CreatedAt.Compare(snap.users[b].CreatedAt), strings.Compare(a, b))
	})
	var (
		machines, deleted, orphaned, deactivated, initialNoPassword       int
		totp, passkeys, u2f, otpSMS, otpEmail, recovery, metadata, avatar int
		address, changeRequired, hashesRejected, invalid, collisions      int
		linksUnsupported, machineKeys, pats                               int
	)
	identifiers := map[string]string{}
	for _, userID := range userIDs {
		u := snap.users[userID]
		org := snap.orgs[u.OrgID]
		switch {
		case u.Machine:
			if u.State != stage.StateDeleted {
				machines++
				machineKeys += len(u.MachineKeys)
				pats += len(u.PATs)
			}
			continue
		case u.State == stage.StateDeleted:
			deleted++
			p.gone = append(p.gone, userID)
			continue
		case org == nil || org.State == stage.OrgRemoved:
			orphaned++
			p.gone = append(p.gone, userID)
			continue
		}
		if org.HasLoginPolicy {
			issue("org_login_policy_unsupported", SeverityConflict, "user", userID, "org-specific login policy cannot be represented by the project login flow")
		}
		if u.State != stage.StateActive {
			issue("user_state_unsupported", SeverityConflict, "user", userID, "initial, inactive and locked users require lifecycle enforcement before import")
		}
		if u.PasswordChangeRequired {
			issue("password_change_required", SeverityConflict, "user", userID, "nextgen cannot enforce the required password change yet")
		}
		if u.TOTP || u.OTPSMS || u.OTPEmail || len(u.U2F) > 0 || u.RecoveryCodes {
			issue("mfa_enrollment_unsupported", SeverityConflict, "user", userID, "dropping enrolled factors can weaken authentication")
		}
		loginName := u.Username
		mustBeDomain := inst.UserLoginMustBeDomain
		if org.UserLoginMustBeDomain != nil {
			mustBeDomain = *org.UserLoginMustBeDomain
		}
		if mustBeDomain && org.PrimaryDomain != "" {
			loginName = u.Username + "@" + org.PrimaryDomain
		}
		up := &userPlan{userID: userID, user: u, seq: snap.userSeq[userID], attributes: userAttributes(userID, u, loginName)}

		identifier, _ := up.attributes[opts.Identifier].(string)
		if identifier == "" {
			issue("identifier_missing", SeverityConflict, "user", userID, "no "+opts.Identifier)
			invalid++
			continue
		}
		if winner, ok := identifiers[fold(identifier)]; ok {
			issue("identifier_conflict", SeverityConflict, "user", userID, fmt.Sprintf("%s %q is also user %s's", opts.Identifier, identifier, winner))
			collisions++
			continue
		}
		if _, err := domain.NewCreateUser(domain.CreateUserParams{
			ProjectID: "validate", ID: "user_validate", SchemaURL: "validate", Schema: schema, Attributes: up.attributes,
		}); err != nil {
			issue("user_invalid", SeverityConflict, "user", userID, err.Error())
			invalid++
			continue
		}
		identifiers[fold(identifier)] = userID

		if team, ok := p.teamByOrg[u.OrgID]; ok {
			up.team = team
		} else {
			issue("user_owner_missing", SeverityConflict, "user", userID, "the source has no usable owning organization")
		}
		if u.PasswordHash != "" {
			if err := hasher.ValidateHash(u.PasswordHash); err != nil {
				hashesRejected++
				issue("password_hash_rejected", SeverityConflict, "user", userID, "password hash is outside configured verifiers or limits")
			} else {
				up.passwordHash = u.PasswordHash
				up.passwordVersion = strconv.FormatInt(u.PasswordSequence, 10)
			}
		}
		switch u.State {
		case stage.StateInactive, stage.StateLocked:
			up.deactivate = true
			deactivated++
		case stage.StateInitial:
			if up.passwordHash == "" && len(u.Links) == 0 {
				initialNoPassword++
				issue("no_credential", SeverityInfo, "user", userID, "")
			}
		}
		count := func(n *int, ok bool) {
			if ok {
				*n++
			}
		}
		count(&totp, u.TOTP)
		count(&passkeys, len(u.Passkeys) > 0)
		count(&u2f, len(u.U2F) > 0)
		count(&otpSMS, u.OTPSMS)
		count(&otpEmail, u.OTPEmail)
		count(&recovery, u.RecoveryCodes)
		count(&metadata, len(u.MetadataKeys) > 0)
		count(&avatar, u.Avatar)
		count(&address, u.Address)
		count(&changeRequired, u.PasswordChangeRequired)
		p.users = append(p.users, up)

		for _, key := range sortedKeys(u.Links, strings.Compare) {
			link := u.Links[key]
			idp, ok := p.idpByID[link.IDPID]
			if !ok {
				linksUnsupported++
				issue("idp_link_unsupported", SeverityConflict, "user", userID, "linked provider cannot be migrated")
				continue
			}
			p.links = append(p.links, &linkPlan{user: up, idp: idp, subject: link.ExternalUserID})
		}
		usableSSO := false
		for _, link := range u.Links {
			if idp := p.idpByID[link.IDPID]; idp != nil && slices.Contains(p.loginSlugs, idp.slug) {
				usableSSO = true
			}
		}
		if up.passwordHash == "" && !usableSSO {
			issue("no_usable_auth_method", SeverityConflict, "user", userID, "no supported password or offered SSO provider")
		}
	}
	withPassword := 0
	for _, u := range p.users {
		if u.passwordHash != "" {
			withPassword++
		}
	}
	report.Migrates = append(report.Migrates,
		Line{Item: "human users -> users", Count: len(p.users), Note: fmt.Sprintf("%d with a password", withPassword)},
		Line{Item: "IdP links -> identity links", Count: len(p.links)},
	)
	report.Partial = appendLines(report.Partial,
		Line{Item: "inactive or locked users", Count: deactivated, Note: "blocks import until authentication enforces lifecycle state"},
		Line{Item: "users without a password or link", Count: initialNoPassword, Note: "cannot sign in until an admin sets a password"},
		Line{Item: "users with TOTP", Count: totp, Note: "factor dropped"},
		Line{Item: "users with passkeys", Count: passkeys, Note: "factor dropped (WebAuthn user handle)"},
		Line{Item: "users with U2F", Count: u2f, Note: "factor dropped"},
		Line{Item: "users with OTP SMS", Count: otpSMS, Note: "factor dropped"},
		Line{Item: "users with OTP email", Count: otpEmail, Note: "factor dropped"},
		Line{Item: "users with recovery codes", Count: recovery, Note: "dropped"},
		Line{Item: "users with metadata", Count: metadata, Note: "dropped"},
		Line{Item: "users with an avatar", Count: avatar, Note: "dropped"},
		Line{Item: "users with an address", Count: address, Note: "dropped"},
		Line{Item: "users who must change their password", Count: changeRequired, Note: "blocks import: not enforced in nextgen"},
		Line{Item: "IdP links to IdPs that do not migrate", Count: linksUnsupported, Note: "dropped"},
	)
	report.NotMigrated = appendLines(report.NotMigrated,
		Line{Item: "machine users", Count: machines, Note: plural(machineKeys, "key") + ", " + plural(pats, "PAT") + "; no equivalent"},
		Line{Item: "users of removed organizations", Count: orphaned, Note: "removed in v4"},
	)
	report.Conflicts = appendLines(report.Conflicts,
		Line{Item: "users whose " + opts.Identifier + " collides", Count: collisions, Note: "blocks the whole import; resolve collisions or choose login_name"},
		Line{Item: "users that fail the user schema", Count: invalid, Note: "blocks the whole import"},
		Line{Item: "password hashes outside nextgen's verifiers or limits", Count: hashesRejected, Note: "blocks import until the hash is supported"},
	)

	// ---- what only gets counted
	live := func(objects map[string]*stage.Object) (n int) {
		for id, o := range objects {
			if o.Live && id != inst.IAMProjectID {
				n++
			}
		}
		return n
	}
	var apps, roles, grants int
	for id, project := range snap.objects[stage.AggregateProject] {
		if project.Live && id != inst.IAMProjectID {
			apps += len(project.Apps)
			roles += len(project.Roles)
			grants += len(project.Grants)
		}
	}
	report.NotMigrated = appendLines(report.NotMigrated,
		Line{Item: "projects (without Zitadel's own)", Count: live(snap.objects[stage.AggregateProject]), Note: fmt.Sprintf("%s, %s, %s; no OIDC provider in nextgen yet", plural(apps, "app"), plural(roles, "role"), plural(grants, "project grant"))},
		Line{Item: "user grants (authorizations)", Count: live(snap.objects[stage.AggregateUserGrant]), Note: "not built in nextgen"},
		Line{Item: "actions v1", Count: live(snap.objects[stage.AggregateAction]), Note: "no equivalent"},
		Line{Item: "actions v2 targets", Count: live(snap.objects[stage.AggregateTarget]), Note: "no equivalent"},
		Line{Item: "actions v2 executions", Count: live(snap.objects[stage.AggregateExecution]), Note: "no equivalent"},
		Line{Item: "v4 user schemas (beta)", Count: live(snap.objects[stage.AggregateSchema]), Note: "no equivalent"},
	)
	if inst.LoginPolicy.ForceMFA || inst.LoginPolicy.ForceMFALocalOnly {
		report.Conflicts = append(report.Conflicts, Line{Item: "v4 forces MFA", Count: 1, Note: "migrated users sign in with one factor: blocks production use"})
	}
	if !inst.LoginPolicy.AllowUsernamePassword {
		issue("password_login_disabled", SeverityConflict, "instance", opts.InstanceID, "the imported flow currently requires password login to be allowed")
	}
	if opts.Identifier == IdentifierEmail && inst.LoginPolicy.DisableLoginWithEmail {
		issue("email_login_disabled", SeverityConflict, "instance", opts.InstanceID, "select login_name to preserve the source login policy")
	}
	if inst.Removed {
		issue("instance_removed", SeverityConflict, "instance", opts.InstanceID, "the source instance was removed")
	}
	return p, nil
}

// connectionDocument is the nextgen IdP connection for a v4 IdP.
func connectionDocument(p *idpPlan) map[string]any {
	idp := p.idp
	scopes := slices.Clone(idp.Scopes)
	if !slices.Contains(scopes, "openid") {
		scopes = append([]string{"openid"}, scopes...)
	}
	issuer := idp.Issuer
	doc := map[string]any{
		"slug":         p.slug,
		"protocol":     "oidc",
		"display_name": cmp.Or(idp.Name, p.slug),
		"claim_mapping": map[string]any{
			"email":              "email",
			"given_name":         "given_name",
			"family_name":        "family_name",
			"nickname":           "nickname",
			"display_name":       "name",
			"preferred_language": "locale",
			"phone":              "phone_number",
		},
		"verified_claims": map[string]any{"email": "email_verified"},
		"provisioning":    map[string]any{"creation": "disabled"},
	}
	if idp.Options.IsCreationAllowed && idp.Options.IsAutoCreation {
		doc["provisioning"] = map[string]any{"creation": "auto"}
	}
	if idp.Type == stage.IDPGoogle {
		doc["template"] = "google"
		issuer = "https://accounts.google.com"
		if len(idp.Scopes) == 0 {
			scopes = []string{"openid", "profile", "email"}
		}
	}
	doc["oidc"] = map[string]any{
		"issuer":           issuer,
		"client_id":        idp.ClientID,
		"client_secret":    "${{ " + p.secretVar + " }}",
		"scopes":           scopes,
		"pkce_enabled":     idp.UsePKCE,
		"id_token_mapping": idp.IDTokenMapping,
	}
	if p.callback != "" {
		doc["oidc"].(map[string]any)["redirect_uri"] = p.callback
	}
	return doc
}

// callbackAction is the report's instruction for one connection's redirect
// URI at its provider.
func callbackAction(p *idpPlan) string {
	if p.callback != "" {
		return fmt.Sprintf("keep %s registered at %q (v4 id %s); its host must reach this nextgen server", p.callback, p.idp.Name, p.idp.ID)
	}
	return fmt.Sprintf("register the redirect URI https://<app origin>/__nextgen/idp/%s/callback at %q (v4 id %s)", p.slug, p.idp.Name, p.idp.ID)
}

// v4CallbackCandidates are the callback URLs v4 may have registered: both of
// its callback paths on each domain it served sign-in on. v4 stores none of
// them, so the operator picks the one the providers hold.
func v4CallbackCandidates(domains []string) []string {
	var out []string
	for _, d := range domains {
		for _, path := range idp.LegacyCallbackPaths {
			out = append(out, "https://"+d+path)
		}
	}
	return out
}

var slugInvalid = regexp.MustCompile(`[^a-z0-9_-]+`)

// deriveSlug makes a connection slug from a v4 IdP name, unique in taken.
func deriveSlug(name, id string, taken map[string]bool) string {
	slug := strings.Trim(slugInvalid.ReplaceAllString(strings.ToLower(name), "-"), "-_")
	if slug == "" {
		slug = "idp"
	}
	slug = truncate(slug, 48)
	if !taken[slug] {
		return slug
	}
	suffix := id
	if len(suffix) > 8 {
		suffix = suffix[len(suffix)-8:]
	}
	candidate := slug + "-" + strings.ToLower(suffix)
	if !taken[candidate] {
		return candidate
	}
	// Distinct source IDs may share their last eight characters.
	for n := 1; ; n++ {
		candidate = fmt.Sprintf("%s-%s-%d", slug, strings.ToLower(suffix), n)
		if !taken[candidate] {
			return candidate
		}
	}
}

func sortedIDPs(idps map[string]*stage.IDP) []*stage.IDP {
	list := make([]*stage.IDP, 0, len(idps))
	for _, idp := range idps {
		list = append(list, idp)
	}
	slices.SortFunc(list, func(a, b *stage.IDP) int {
		return cmp.Or(strings.Compare(a.Name, b.Name), strings.Compare(a.ID, b.ID))
	})
	return list
}

func sortedKeys[V any](m map[string]V, compare func(a, b string) int) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, compare)
	return keys
}

// fold compares names and identifiers the way nextgen's uniqueness does.
func fold(s string) string {
	return cases.Fold().String(s)
}

func truncate(s string, runes int) string {
	if utf8.RuneCountInString(s) <= runes {
		return s
	}
	return string([]rune(s)[:runes])
}

func plural(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

func noteIf(ok bool, format string, args ...any) string {
	if !ok {
		return ""
	}
	return fmt.Sprintf(format, args...)
}

// appendLines adds the lines that count something.
func appendLines(lines []Line, add ...Line) []Line {
	for _, line := range add {
		if line.Count > 0 {
			lines = append(lines, line)
		}
	}
	return lines
}
