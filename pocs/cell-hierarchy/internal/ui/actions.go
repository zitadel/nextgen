package ui

import (
	"context"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

// Mutating helpers used by the JSON API. Each records a trace and returns
// the latest timeline so the SPA can render Latest hop without a second fetch.

func (a *App) doJoin(ctx context.Context, parentURL, childURL string) (string, *timelineView, error) {
	a.beginTrace("join cell")
	invite, err := a.Peer.Prepare(ctx, parentURL)
	if err != nil {
		a.endTrace(err.Error(), nil)
		return "", a.latestTimeline(), err
	}
	_, err = a.Peer.Accept(ctx, childURL, cell.AcceptRequest{
		ParentURL: invite.ParentURL,
		JoinToken: invite.JoinToken,
	})
	if err != nil {
		a.endTrace(err.Error(), nil)
		return "", a.latestTimeline(), err
	}
	msg := "joined successfully"
	a.endTrace(msg, nil)
	return msg, a.latestTimeline(), nil
}

func (a *App) doCreateTeam(ctx context.Context, name, id string) (cell.TeamView, string, *timelineView, error) {
	name = strings.TrimSpace(name)
	id = strings.TrimSpace(id)
	if name == "" {
		return cell.TeamView{}, "", nil, fmt.Errorf("team name required")
	}
	if id == "" {
		id = strings.ToLower(strings.ReplaceAll(name, " ", "-"))
	}
	platformHost, err := a.cellURLByLabel("platform")
	if err != nil {
		return cell.TeamView{}, "", nil, err
	}
	a.beginTrace("create team " + id)
	team, err := a.Peer.CreateTeam(ctx, platformHost, "platform", map[string]any{"id": id, "name": name})
	if err != nil {
		a.endTrace(err.Error(), nil)
		return cell.TeamView{}, "", a.latestTimeline(), err
	}
	msg := fmt.Sprintf("created team %s (%s)", team.Name, team.ID)
	a.endTrace(msg, nil)
	return team, msg, a.latestTimeline(), nil
}

func (a *App) doCreateWorkspace(ctx context.Context, id, name, cellLabel, teamID string) (cell.ProjectResponse, string, *timelineView, error) {
	id = strings.TrimSpace(id)
	name = strings.TrimSpace(name)
	cellLabel = strings.TrimSpace(cellLabel)
	teamID = strings.TrimSpace(teamID)
	if id == "" {
		return cell.ProjectResponse{}, "", nil, fmt.Errorf("workspace id required")
	}
	if name == "" {
		name = id
	}
	if cellLabel == "" {
		return cell.ProjectResponse{}, "", nil, fmt.Errorf("cell required")
	}
	if teamID == "" {
		return cell.ProjectResponse{}, "", nil, fmt.Errorf("customer team required")
	}
	hostURL, err := a.cellURLByLabel(cellLabel)
	if err != nil {
		return cell.ProjectResponse{}, "", nil, err
	}
	if _, err := a.findPlatformTeam(ctx, teamID); err != nil {
		return cell.ProjectResponse{}, "", nil, err
	}
	a.beginTrace("create workspace " + id)
	proj, err := a.Peer.CreateProject(ctx, hostURL, map[string]any{
		"id": id, "name": name,
		"is_parent": false, "lookup_enabled": true,
		"workspace_id": id, "customer_team_id": teamID,
	})
	if err != nil {
		a.endTrace(err.Error(), nil)
		return cell.ProjectResponse{}, "", a.latestTimeline(), err
	}
	_ = a.putWorkspace(Workspace{
		ID: id, Name: name, Cell: cellLabel, CustomerTeamID: teamID,
	})
	msg := fmt.Sprintf("created workspace/site %s on %s (team %s)", proj.ID, cellLabel, teamID)
	a.endTrace(msg, nil)
	return proj, msg, a.latestTimeline(), nil
}

func (a *App) doCreateUser(ctx context.Context, projectID, email string) (string, *timelineView, error) {
	projectID = strings.TrimSpace(projectID)
	email = strings.TrimSpace(email)
	if email == "" {
		return "", nil, fmt.Errorf("email required")
	}
	host, _, err := a.findProject(ctx, projectID)
	if err != nil {
		return "", nil, err
	}
	a.beginTrace("create user on " + projectID)
	defer a.finishTraceSession()
	out, err := a.Peer.CreateUser(ctx, host, projectID, email, false)
	if err != nil {
		a.appendTrace("create "+email+" on "+projectID, out.Trace, err.Error())
		return "", a.latestTimeline(), err
	}
	a.appendTrace("create "+email+" on "+projectID, out.Trace, "created + floated")
	return "created " + email, a.latestTimeline(), nil
}

func (a *App) doLookup(ctx context.Context, projectID, key string) (map[string]any, string, *timelineView, error) {
	projectID = strings.TrimSpace(projectID)
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, "", nil, fmt.Errorf("lookup key required")
	}
	host, _, err := a.findProject(ctx, projectID)
	if err != nil {
		return nil, "", nil, err
	}
	a.beginTrace("lookup from " + projectID)
	defer a.finishTraceSession()
	res, hops, err := a.Peer.LookupWalk(ctx, host, projectID, key)
	if err != nil {
		a.appendTrace("lookup "+key+" from "+projectID, hops, err.Error())
		return nil, "", a.latestTimeline(), err
	}
	note := "miss"
	if res.Hit {
		note = "hit home=" + res.HomeProjectID + " at=" + res.FoundAtProjectID
		if res.Tombstoned {
			note = "tombstone home=" + res.HomeProjectID
		}
	}
	a.appendTrace("lookup "+key+" from "+projectID, hops, note)
	result := map[string]any{
		"hit":                res.Hit,
		"tombstoned":         res.Tombstoned,
		"home_project_id":    res.HomeProjectID,
		"home_cell_url":      res.HomeCellURL,
		"found_at_project_id": res.FoundAtProjectID,
		"state":              res.State,
		"key":                key,
	}
	return result, note, a.latestTimeline(), nil
}

func (a *App) doDeleteUser(ctx context.Context, projectID, email string) (string, *timelineView, error) {
	projectID = strings.TrimSpace(projectID)
	email = strings.TrimSpace(email)
	if email == "" {
		return "", nil, fmt.Errorf("email required")
	}
	host, _, err := a.findProject(ctx, projectID)
	if err != nil {
		return "", nil, err
	}
	a.beginTrace("delete user on " + projectID)
	defer a.finishTraceSession()
	out, err := a.Peer.DeleteUser(ctx, host, projectID, email)
	if err != nil {
		a.appendTrace("delete "+email+" on "+projectID, out.Trace, err.Error())
		return "", a.latestTimeline(), err
	}
	a.appendTrace("delete "+email+" on "+projectID, out.Trace, "deleted (lookup tombstone)")
	return "deleted " + email, a.latestTimeline(), nil
}

func (a *App) doAddSite(ctx context.Context, fromProject, siteID, name, cellLabel, parentProjectID, workspaceID string) (cell.ProjectResponse, string, *timelineView, error) {
	siteID = strings.TrimSpace(siteID)
	name = strings.TrimSpace(name)
	cellLabel = strings.TrimSpace(cellLabel)
	parentProjectID = strings.TrimSpace(parentProjectID)
	workspaceID = strings.TrimSpace(workspaceID)
	fromProject = strings.TrimSpace(fromProject)

	if parentProjectID == "" {
		parentProjectID = fromProject
	}
	if parentProjectID == "" {
		return cell.ProjectResponse{}, "", nil, fmt.Errorf("parent site required")
	}
	if siteID == "" || cellLabel == "" {
		return cell.ProjectResponse{}, "", nil, fmt.Errorf("site id and cell required")
	}
	if name == "" {
		name = siteID
	}

	parentHost, parent, err := a.findProject(ctx, parentProjectID)
	if err != nil {
		return cell.ProjectResponse{}, "", nil, err
	}
	if workspaceID == "" {
		workspaceID = parent.WorkspaceID
	}
	if workspaceID == "" {
		workspaceID = parent.ID
	}
	teamID := parent.CustomerTeamID
	if teamID == "" {
		if _, root, rerr := a.findProject(ctx, workspaceID); rerr == nil {
			teamID = root.CustomerTeamID
		}
	}

	hostURL, err := a.cellURLByLabel(cellLabel)
	if err != nil {
		return cell.ProjectResponse{}, "", nil, err
	}

	a.beginTrace("add site " + siteID + " under " + parentProjectID)
	proj, err := a.Peer.CreateProject(ctx, hostURL, map[string]any{
		"id": siteID, "name": name,
		"is_parent": false, "lookup_enabled": true,
		"workspace_id": workspaceID, "customer_team_id": teamID,
	})
	if err != nil {
		a.endTrace(err.Error(), nil)
		return cell.ProjectResponse{}, "", a.latestTimeline(), err
	}
	if err := a.Peer.AttachProject(ctx, hostURL, proj.ID, parent.ID, parentHost); err != nil {
		a.endTrace("created but attach failed: "+err.Error(), nil)
		return cell.ProjectResponse{}, "", a.latestTimeline(), fmt.Errorf("created but attach failed: %w", err)
	}
	msg := fmt.Sprintf("created site %s on %s (parent %s)", proj.ID, cellLabel, parent.ID)
	a.endTrace(msg, nil)
	return proj, msg, a.latestTimeline(), nil
}
