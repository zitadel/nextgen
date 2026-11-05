package migratev4

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// preflight deliberately refuses lifecycle changes this POC cannot preserve.
// It also reads unchanged target rows: a matching ledger is not proof that a
// target administrator has not changed a resource since the previous run.
func (m *Migrator) preflight(ctx context.Context, s *session, p *plan, mappings map[stage.MappingKey]*stage.Mapping) error {
	block := func(code, kind, id string) {
		if kind == kindLink && !s.opts.IncludePII {
			id = fingerprint(id)
		}
		s.report.Issues = append(s.report.Issues, Issue{Code: code, Severity: SeverityConflict, Kind: kind, SourceID: id})
	}
	if s.opts.ProjectID != "" {
		block("existing_project_import_unsupported", kindProject, s.opts.InstanceID)
	}
	loginNames := map[string]bool{}
	for _, u := range p.users {
		name, _ := u.attributes[IdentifierLoginName].(string)
		if loginNames[fold(name)] {
			block("login_name_conflict", kindUser, u.userID)
		}
		loginNames[fold(name)] = true
	}
	wantedLinks := map[string]*linkPlan{}
	for _, link := range p.links {
		key := stage.LinkKey(link.idp.idp.ID, link.subject)
		if old := wantedLinks[key]; old != nil && old.user.userID != link.user.userID {
			block("link_conflict", kindLink, key)
		}
		wantedLinks[key] = link
	}
	project := mappings[stage.MappingKey{Kind: kindProject, ID: s.opts.InstanceID}]
	if project == nil {
		return nil
	}
	ctx = service.WithAuthzListUnrestricted(ctx)
	stmts := m.deps.Pool.Statements()
	if mapping := mappings[stage.MappingKey{Kind: kindSchema, ID: objectTypeHuman}]; mapping != nil && mapping.Applied {
		latest, err := service.LatestSchemaByObjectType(ctx, stmts, project.TargetID, objectTypeHuman)
		if err != nil {
			return err
		}
		if latest == nil {
			block("target_schema_missing", kindSchema, objectTypeHuman)
		} else if latest.URL != mapping.TargetID {
			if same, _ := domain.JSONEqual(latest.Schema, p.schema, "$id"); !same {
				block("schema_edited_in_nextgen", kindSchema, objectTypeHuman)
			}
		}
	}
	if mapping := mappings[stage.MappingKey{Kind: kindFlow, ID: "login"}]; mapping != nil && mapping.Applied {
		written, err := m.deps.Flows.Get(ctx, project.TargetID, mapping.TargetID)
		if err != nil {
			return err
		}
		latest, err := m.deps.Flows.List(ctx, service.ListFlowDefinitionsRequest{ProjectID: project.TargetID, Name: written.Name, LatestRevisionPerName: true})
		if err != nil {
			return err
		}
		document, err := migrationLoginFlow(s.opts.Identifier, p.allowRegister, p.loginSlugs)
		if err != nil {
			return err
		}
		wanted, err := flow_definitions.ParseFlowDefinition(m.deps.BuiltinPublicBase, project.TargetID, document)
		if err != nil {
			return err
		}
		if len(latest.Items) != 1 || (!sameFlow(latest.Items[0], written) && !sameFlow(latest.Items[0], wanted)) {
			block("flow_edited_in_nextgen", kindFlow, "login")
		}
	}
	for _, u := range p.users {
		mapping := mappings[stage.MappingKey{Kind: kindUser, ID: u.userID}]
		if mapping == nil {
			continue
		}
		current, err := m.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: project.TargetID, UserID: mapping.TargetID})
		if errors.Is(err, domain.ErrUserNotFound()) {
			if mapping.Applied {
				block("target_user_missing", kindUser, u.userID)
			}
			continue
		}
		if err != nil {
			return err
		}
		attrs := map[string]any{}
		for _, attr := range current.Attributes {
			attrs[string(attr.Key)] = attr.Value
		}
		written, oldState, _ := strings.Cut(mapping.Fingerprint, ".")
		if !equalJSON(attrs, u.attributes) && (!mapping.Applied || fingerprint(attrs) != written) {
			block("user_edited_in_nextgen", kindUser, u.userID)
		}
		state := userState{CreatedAt: u.user.CreatedAt}
		if u.team != nil {
			team := mappings[stage.MappingKey{Kind: kindTeam, ID: u.team.orgID}]
			if team != nil {
				state.Team = team.TargetID
			}
		}
		// A record this build cannot read says nothing about the last write;
		// the target comparison below still holds, and the apply renews it.
		if mapping.Applied && isFingerprint(oldState) && oldState != fingerprint(state) {
			block("user_lifecycle_change_unsupported", kindUser, u.userID)
		}
		if current.Metadata.Status != domain.UserStatusActive || current.LifecycleOwnerTeamID == nil || *current.LifecycleOwnerTeamID != state.Team {
			block("target_user_state_changed", kindUser, u.userID)
		}
		membership, err := stmts.GetTeamMembership(ctx, project.TargetID, state.Team, mapping.TargetID)
		if err != nil {
			return err
		}
		if membership.Status != domain.MembershipStatusActive {
			block("target_membership_changed", kindUser, u.userID)
		}
		pwMapping := mappings[stage.MappingKey{Kind: kindPassword, ID: u.userID}]
		if pwMapping != nil && pwMapping.Applied {
			if u.passwordHash == "" {
				block("password_removal_unsupported", kindUser, u.userID)
				continue
			}
			pw, err := currentPassword(ctx, stmts, project.TargetID, mapping.TargetID)
			if err != nil {
				return err
			}
			// Rehash-on-login keeps the row ID; a password replacement does not.
			if pw == nil || pw.ID != pwMapping.TargetID {
				// A pending password write may already have committed.
				pending := mappings[stage.MappingKey{Kind: kindPasswordWrite, ID: passwordWriteKey(u)}]
				if pw == nil || pending == nil || pending.TargetID != pw.ID {
					block("password_edited_in_nextgen", kindUser, u.userID)
				}
			}
		}
	}
	for _, t := range p.teams {
		mapping := mappings[stage.MappingKey{Kind: kindTeam, ID: t.orgID}]
		if mapping == nil {
			continue
		}
		team, err := stmts.GetTeamByID(ctx, project.TargetID, mapping.TargetID)
		if _, missing := errors.AsType[*database.NoRowFoundError](err); missing && !mapping.Applied {
			continue
		}
		if err != nil {
			return err
		}
		if team.Status != domain.TeamStatusActive || (team.Name != t.name && fingerprint(team.Name) != mapping.Fingerprint) {
			block("team_edited_in_nextgen", kindTeam, t.orgID)
		}
	}
	for _, idp := range p.idps {
		mapping := mappings[stage.MappingKey{Kind: kindIDP, ID: idp.idp.ID}]
		if mapping == nil || !mapping.Applied {
			continue
		}
		connection, err := m.deps.IDPs.Get(ctx, project.TargetID, mapping.TargetID)
		if err != nil {
			return err
		}
		fp := fingerprint(json.RawMessage(connection.Document))
		if fp != mapping.Fingerprint && fp != fingerprint(idp.document) {
			block("idp_edited_in_nextgen", kindIDP, idp.idp.ID)
		}
	}
	for _, gone := range p.gone {
		if mappings[stage.MappingKey{Kind: kindUser, ID: gone}] != nil {
			block("user_removal_unsupported", kindUser, gone)
		}
	}
	for key, mapping := range mappings {
		if !mapping.Applied {
			continue
		}
		if key.Kind == kindLink {
			wanted := wantedLinks[key.ID]
			if wanted == nil {
				block("link_removal_unsupported", kindLink, key.ID)
				continue
			}
			link, err := stmts.GetIDPIdentityLink(ctx, database.And(
				database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), project.TargetID),
				database.Equal(database.Col(domain.IDPIdentityLinkFieldID), mapping.TargetID)))
			if err != nil {
				return fmt.Errorf("read mapped identity link: %w", err)
			}
			user := mappings[stage.MappingKey{Kind: kindUser, ID: wanted.user.userID}]
			idp := mappings[stage.MappingKey{Kind: kindIDP, ID: wanted.idp.idp.ID}]
			if user == nil || idp == nil || link.UserID != user.TargetID || link.ConnectionID != idp.TargetID || link.Subject != wanted.subject {
				block("link_reassignment_unsupported", kindLink, key.ID)
			}
		}
		if key.Kind == kindIDP && p.idpByID[key.ID] == nil {
			block("idp_removal_unsupported", kindIDP, key.ID)
		}
		if key.Kind == kindTeam && p.teamByOrg[key.ID] == nil {
			block("team_removal_unsupported", kindTeam, key.ID)
		}
	}
	return nil
}

func currentPassword(ctx context.Context, stmts service.AllStatements, projectID, userID string) (*domain.UserPassword, error) {
	pw, err := stmts.GetUserPassword(ctx, database.And(
		database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasswordFieldUserID), userID)))
	if _, missing := errors.AsType[*database.NoRowFoundError](err); missing {
		return nil, nil
	}
	return pw, err
}

func passwordWriteKey(u *userPlan) string {
	return fmt.Sprintf("%s|%d|%d", u.userID, u.seq, u.passwordSequence)
}
