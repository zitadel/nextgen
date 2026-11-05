package migratev4

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// preflight refuses what the migration cannot make nextgen match v4 in: the
// conflicts v4's data has among itself, and the changes nextgen has no writer
// for yet (reactivation, moving a user between teams, removals). v4 is the
// truth, so an edit made in nextgen is not refused: the apply overwrites it.
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
	for _, u := range p.users {
		mapping := mappings[stage.MappingKey{Kind: kindUser, ID: u.userID}]
		if mapping == nil || !mapping.Applied {
			continue
		}
		current, err := m.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: project.TargetID, UserID: mapping.TargetID})
		if errors.Is(err, domain.ErrUserNotFound()) {
			continue // deleted in nextgen: the apply creates it again
		}
		if err != nil {
			return err
		}
		team := ""
		if u.team != nil {
			if mapping := mappings[stage.MappingKey{Kind: kindTeam, ID: u.team.orgID}]; mapping != nil {
				team = mapping.TargetID
			}
		}
		if current.Metadata.Status != domain.UserStatusActive {
			block("user_reactivation_unsupported", kindUser, u.userID)
		}
		if current.LifecycleOwnerTeamID == nil || *current.LifecycleOwnerTeamID != team {
			block("user_team_change_unsupported", kindUser, u.userID)
		} else {
			membership, err := stmts.GetTeamMembership(ctx, project.TargetID, team, mapping.TargetID)
			if err != nil {
				return err
			}
			if membership.Status != domain.MembershipStatusActive {
				block("user_membership_change_unsupported", kindUser, u.userID)
			}
		}
		if pw := mappings[stage.MappingKey{Kind: kindPassword, ID: u.userID}]; pw != nil && pw.Applied && u.passwordHash == "" {
			block("password_removal_unsupported", kindUser, u.userID)
		}
	}
	for _, t := range p.teams {
		mapping := mappings[stage.MappingKey{Kind: kindTeam, ID: t.orgID}]
		if mapping == nil || !mapping.Applied {
			continue
		}
		team, err := stmts.GetTeamByID(ctx, project.TargetID, mapping.TargetID)
		if _, missing := errors.AsType[*database.NoRowFoundError](err); missing {
			continue // deleted in nextgen: the apply creates it again
		}
		if err != nil {
			return err
		}
		if team.Status != domain.TeamStatusActive && !t.deactivate {
			block("team_reactivation_unsupported", kindTeam, t.orgID)
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

// passwordWriteKey names the reserved row of one password write: v4's password
// version over the row it replaces, so writing v4's password back over a row
// set in nextgen gets a row of its own.
func passwordWriteKey(u *userPlan, replacing string) string {
	return fmt.Sprintf("%s|%d|%d|%s", u.userID, u.seq, u.passwordSequence, replacing)
}
