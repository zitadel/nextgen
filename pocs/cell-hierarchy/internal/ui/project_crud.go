package ui

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func (a *App) projectFlashURL(projectID, ok, errMsg string) string {
	u := "/projects/" + url.PathEscape(projectID)
	q := url.Values{}
	if ok != "" {
		q.Set("ok", ok)
	}
	if errMsg != "" {
		q.Set("err", errMsg)
	}
	if enc := q.Encode(); enc != "" {
		u += "?" + enc
	}
	return u
}

func (a *App) redirectProject(w http.ResponseWriter, r *http.Request, projectID, ok, errMsg string) {
	http.Redirect(w, r, a.projectFlashURL(projectID, ok, errMsg), http.StatusSeeOther)
}

func (a *App) resolveProjectHost(r *http.Request, projectID string) (string, error) {
	host := strings.TrimSpace(r.FormValue("host_cell_url"))
	if host != "" {
		return cell.NormalizeURL(host), nil
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	hostURL, _, err := a.findProject(ctx, projectID)
	return hostURL, err
}

func (a *App) handleProjectCreateUser(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	email := strings.TrimSpace(r.FormValue("email"))
	teamID := strings.TrimSpace(r.FormValue("lifecycle_owner_team_id"))
	if email == "" {
		a.redirectProject(w, r, projectID, "", "email required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	body := map[string]any{"email": email, "defer_float": false}
	if teamID != "" {
		body["lifecycle_owner_team_id"] = teamID
	}
	out, err := a.Peer.CreateUserBody(ctx, host, projectID, body)
	note := "project create user " + email
	if teamID != "" {
		note += " team=" + teamID
	}
	if err != nil {
		a.appendTrace(note, out.Trace, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace(note, out.Trace, "created")
	msg := "created user " + email
	if teamID != "" {
		msg += " (lifecycle team " + teamID + ")"
	} else {
		msg += " (project-managed)"
	}
	a.redirectProject(w, r, projectID, msg, "")
}

func (a *App) handleProjectDeleteUser(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	email := strings.TrimSpace(r.FormValue("email"))
	if email == "" {
		a.redirectProject(w, r, projectID, "", "email required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	out, err := a.Peer.DeleteUser(ctx, host, projectID, email)
	note := "project delete user " + email
	if err != nil {
		a.appendTrace(note, out.Trace, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace(note, out.Trace, "deleted")
	a.redirectProject(w, r, projectID, "deleted user "+email+" (grants tombstoned via interests)", "")
}

func (a *App) handleProjectCreateTeam(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	name := strings.TrimSpace(r.FormValue("name"))
	parent := strings.TrimSpace(r.FormValue("parent_team_id"))
	if name == "" {
		a.redirectProject(w, r, projectID, "", "team name required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	body := map[string]any{"name": name}
	if parent != "" {
		body["parent_team_id"] = parent
	}
	team, err := a.Peer.CreateTeam(ctx, host, projectID, body)
	if err != nil {
		a.appendTrace("project create team "+name, nil, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace("project create team "+name, nil, "id="+team.ID)
	a.redirectProject(w, r, projectID, "created team "+team.Name, "")
}

func (a *App) handleProjectDeleteTeam(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	teamID := strings.TrimSpace(r.FormValue("team_id"))
	if teamID == "" {
		a.redirectProject(w, r, projectID, "", "team_id required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := a.Peer.DeleteTeam(ctx, host, projectID, teamID); err != nil {
		a.appendTrace("project delete team "+teamID, nil, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace("project delete team "+teamID, nil, "deleted")
	a.redirectProject(w, r, projectID, "deleted team "+teamID, "")
}

func (a *App) handleProjectCreateApp(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		a.redirectProject(w, r, projectID, "", "app name required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	app, err := a.Peer.CreateApp(ctx, host, projectID, map[string]any{"name": name})
	if err != nil {
		a.appendTrace("project create app "+name, nil, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace("project create app "+name, nil, "id="+app.ID)
	a.redirectProject(w, r, projectID, "created app "+app.Name, "")
}

func (a *App) handleProjectDeleteApp(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	appID := strings.TrimSpace(r.FormValue("app_id"))
	if appID == "" {
		a.redirectProject(w, r, projectID, "", "app_id required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := a.Peer.DeleteApp(ctx, host, projectID, appID); err != nil {
		a.appendTrace("project delete app "+appID, nil, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace("project delete app "+appID, nil, "deleted")
	a.redirectProject(w, r, projectID, "deleted app "+appID, "")
}

func (a *App) handleProjectCreateGroup(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		a.redirectProject(w, r, projectID, "", "group name required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	g, err := a.Peer.CreateGroup(ctx, host, projectID, map[string]any{"name": name})
	if err != nil {
		a.appendTrace("project create group "+name, nil, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace("project create group "+name, nil, "id="+g.ID)
	a.redirectProject(w, r, projectID, "created group "+g.Name, "")
}

func (a *App) handleProjectDeleteGroup(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	groupID := strings.TrimSpace(r.FormValue("group_id"))
	if groupID == "" {
		a.redirectProject(w, r, projectID, "", "group_id required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := a.Peer.DeleteGroup(ctx, host, projectID, groupID); err != nil {
		a.appendTrace("project delete group "+groupID, nil, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace("project delete group "+groupID, nil, "deleted")
	a.redirectProject(w, r, projectID, "deleted group "+groupID, "")
}

func (a *App) handleProjectCreateTuple(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	object := strings.TrimSpace(r.FormValue("object"))
	if override := strings.TrimSpace(r.FormValue("object_override")); override != "" {
		object = override
	}
	relation := strings.TrimSpace(r.FormValue("relation"))
	if relation == "" {
		relation = "viewer"
	}
	kind := strings.TrimSpace(r.FormValue("subject_kind"))
	if kind == "" {
		kind = cell.SubjectKindUser
	}
	subject := strings.TrimSpace(r.FormValue("subject"))
	if subject == "" {
		subject = strings.TrimSpace(r.FormValue("subject_key"))
	}
	homeProject := strings.TrimSpace(r.FormValue("home_project_id"))
	homeCell := strings.TrimSpace(r.FormValue("home_cell_url"))
	if object == "" || subject == "" {
		a.redirectProject(w, r, projectID, "", "object and subject required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	body := map[string]any{
		"object": object, "relation": relation,
		"subject_kind": kind, "user_key": subject,
	}
	if homeProject != "" && homeCell != "" {
		body["home_project_id"] = homeProject
		body["home_cell_url"] = homeCell
	}
	out, err := a.Peer.CreateTuple(ctx, host, projectID, body)
	note := fmt.Sprintf("project create tuple %s#%s@%s:%s", object, relation, kind, subject)
	if err != nil {
		a.appendTrace(note, out.Trace, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace(note, out.Trace, "tuple="+out.Tuple.ID)
	a.redirectProject(w, r, projectID, "created tuple "+out.Tuple.ID, "")
}

func (a *App) handleProjectTombstoneTuple(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		a.redirectProject(w, r, r.PathValue("id"), "", "invalid form")
		return
	}
	projectID := r.PathValue("id")
	tupleID := strings.TrimSpace(r.FormValue("tuple_id"))
	if tupleID == "" {
		a.redirectProject(w, r, projectID, "", "tuple_id required")
		return
	}
	host, err := a.resolveProjectHost(r, projectID)
	if err != nil {
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	out, err := a.Peer.TombstoneTuple(ctx, host, projectID, tupleID)
	note := "project tombstone tuple " + tupleID
	if err != nil {
		a.appendTrace(note, out.Trace, err.Error())
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.appendTrace(note, out.Trace, "tombstoned")
	msg := "tombstoned tuple " + tupleID
	if out.InterestRemoved {
		msg += " (interest unregistered on home)"
	}
	a.redirectProject(w, r, projectID, msg, "")
}
