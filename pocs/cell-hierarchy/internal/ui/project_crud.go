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
	note := "project create user " + email
	if teamID != "" {
		note += " team=" + teamID
	}
	a.beginTrace(note)
	out, err := a.Peer.CreateUserBody(ctx, host, projectID, body)
	if err != nil {
		a.endTrace(err.Error(), out.Trace)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("created", out.Trace)
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
	note := "project delete user " + email
	a.beginTrace(note)
	out, err := a.Peer.DeleteUser(ctx, host, projectID, email)
	if err != nil {
		a.endTrace(err.Error(), out.Trace)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("deleted", out.Trace)
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
	a.beginTrace("project create team " + name)
	team, err := a.Peer.CreateTeam(ctx, host, projectID, body)
	if err != nil {
		a.endTrace(err.Error(), nil)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("id="+team.ID, nil)
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
	a.beginTrace("project delete team " + teamID)
	if err := a.Peer.DeleteTeam(ctx, host, projectID, teamID); err != nil {
		a.endTrace(err.Error(), nil)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("deleted", nil)
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
	a.beginTrace("project create app " + name)
	app, err := a.Peer.CreateApp(ctx, host, projectID, map[string]any{"name": name})
	if err != nil {
		a.endTrace(err.Error(), nil)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("id="+app.ID, nil)
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
	a.beginTrace("project delete app " + appID)
	if err := a.Peer.DeleteApp(ctx, host, projectID, appID); err != nil {
		a.endTrace(err.Error(), nil)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("deleted", nil)
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
	a.beginTrace("project create group " + name)
	g, err := a.Peer.CreateGroup(ctx, host, projectID, map[string]any{"name": name})
	if err != nil {
		a.endTrace(err.Error(), nil)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("id="+g.ID, nil)
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
	a.beginTrace("project delete group " + groupID)
	if err := a.Peer.DeleteGroup(ctx, host, projectID, groupID); err != nil {
		a.endTrace(err.Error(), nil)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("deleted", nil)
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
	note := fmt.Sprintf("project create tuple %s#%s@%s:%s", object, relation, kind, subject)
	a.beginTrace(note)
	out, err := a.Peer.CreateTuple(ctx, host, projectID, body)
	if err != nil {
		a.endTrace(err.Error(), out.Trace)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("tuple="+out.Tuple.ID, out.Trace)
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
	note := "project tombstone tuple " + tupleID
	a.beginTrace(note)
	out, err := a.Peer.TombstoneTuple(ctx, host, projectID, tupleID)
	if err != nil {
		a.endTrace(err.Error(), out.Trace)
		a.redirectProject(w, r, projectID, "", err.Error())
		return
	}
	a.endTrace("tombstoned", out.Trace)
	msg := "tombstoned tuple " + tupleID
	if out.InterestRemoved {
		msg += " (interest unregistered on home)"
	}
	a.redirectProject(w, r, projectID, msg, "")
}
