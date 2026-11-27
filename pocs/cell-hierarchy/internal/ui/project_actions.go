package ui

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (a *App) handleProjectCreateUser(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimSpace(r.PathValue("id"))
	redir := "/projects/" + url.PathEscape(projectID)
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	email := strings.TrimSpace(r.FormValue("email"))
	if email == "" {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape("email required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	host, _, err := a.findProject(ctx, projectID)
	if err != nil {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.beginTrace("create user on " + projectID)
	defer a.finishTraceSession()
	out, err := a.Peer.CreateUser(ctx, host, projectID, email, false)
	if err != nil {
		a.appendTrace("create "+email+" on "+projectID, out.Trace, err.Error())
		http.Redirect(w, r, redir+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.appendTrace("create "+email+" on "+projectID, out.Trace, "created + floated")
	http.Redirect(w, r, redir+"?ok="+url.QueryEscape("created "+email), http.StatusSeeOther)
}

func (a *App) handleProjectLookup(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimSpace(r.PathValue("id"))
	redir := "/projects/" + url.PathEscape(projectID)
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	key := strings.TrimSpace(r.FormValue("key"))
	if key == "" {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape("lookup key required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	host, _, err := a.findProject(ctx, projectID)
	if err != nil {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.beginTrace("lookup from " + projectID)
	defer a.finishTraceSession()
	res, hops, err := a.Peer.LookupWalk(ctx, host, projectID, key)
	if err != nil {
		a.appendTrace("lookup "+key+" from "+projectID, hops, err.Error())
		http.Redirect(w, r, redir+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	note := "miss"
	if res.Hit {
		note = "hit home=" + res.HomeProjectID + " at=" + res.FoundAtProjectID
		if res.Tombstoned {
			note = "tombstone home=" + res.HomeProjectID
		}
	}
	a.appendTrace("lookup "+key+" from "+projectID, hops, note)
	http.Redirect(w, r, redir+"?ok="+url.QueryEscape(note), http.StatusSeeOther)
}

func (a *App) handleProjectDeleteUser(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimSpace(r.PathValue("id"))
	redir := "/projects/" + url.PathEscape(projectID)
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	email := strings.TrimSpace(r.FormValue("email"))
	if email == "" {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape("email required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	host, _, err := a.findProject(ctx, projectID)
	if err != nil {
		http.Redirect(w, r, redir+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.beginTrace("delete user on " + projectID)
	defer a.finishTraceSession()
	out, err := a.Peer.DeleteUser(ctx, host, projectID, email)
	if err != nil {
		a.appendTrace("delete "+email+" on "+projectID, out.Trace, err.Error())
		http.Redirect(w, r, redir+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.appendTrace("delete "+email+" on "+projectID, out.Trace, "deleted (lookup tombstone)")
	http.Redirect(w, r, redir+"?ok="+url.QueryEscape("deleted "+email), http.StatusSeeOther)
}

func (a *App) handleProjectAddSite(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	// Parent context: either path /projects/{id}/sites or form workspace_id / parent_project_id.
	fromProject := strings.TrimSpace(r.PathValue("id"))
	siteID := strings.TrimSpace(r.FormValue("id"))
	name := strings.TrimSpace(r.FormValue("name"))
	cellLabel := strings.TrimSpace(r.FormValue("cell"))
	parentProjectID := strings.TrimSpace(r.FormValue("parent_project_id"))
	workspaceID := strings.TrimSpace(r.FormValue("workspace_id"))

	if parentProjectID == "" {
		parentProjectID = fromProject
	}
	if parentProjectID == "" {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("parent site required"), http.StatusSeeOther)
		return
	}
	redirBase := "/projects/" + url.PathEscape(parentProjectID)
	if fromProject != "" {
		redirBase = "/projects/" + url.PathEscape(fromProject)
	}
	if siteID == "" || cellLabel == "" {
		http.Redirect(w, r, redirBase+"?err="+url.QueryEscape("site id and cell required"), http.StatusSeeOther)
		return
	}
	if name == "" {
		name = siteID
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	parentHost, parent, err := a.findProject(ctx, parentProjectID)
	if err != nil {
		http.Redirect(w, r, redirBase+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	if workspaceID == "" {
		workspaceID = parent.WorkspaceID
	}
	if workspaceID == "" {
		workspaceID = parent.ID
	}
	teamID := parent.CustomerTeamID
	if teamID == "" {
		// Fall back to root workspace project.
		if rootHost, root, rerr := a.findProject(ctx, workspaceID); rerr == nil {
			_ = rootHost
			teamID = root.CustomerTeamID
		}
	}

	hostURL, err := a.cellURLByLabel(cellLabel)
	if err != nil {
		http.Redirect(w, r, redirBase+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}

	a.beginTrace("add site " + siteID + " under " + parentProjectID)
	// lookup_enabled=true so this site can hold floated keys when it becomes a parent.
	proj, err := a.Peer.CreateProject(ctx, hostURL, map[string]any{
		"id": siteID, "name": name,
		"is_parent": false, "lookup_enabled": true,
		"workspace_id": workspaceID, "customer_team_id": teamID,
	})
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, redirBase+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	if err := a.Peer.AttachProject(ctx, hostURL, proj.ID, parent.ID, parentHost); err != nil {
		a.endTrace("created but attach failed: "+err.Error(), nil)
		http.Redirect(w, r, redirBase+"?err="+url.QueryEscape("created but attach failed: "+err.Error()), http.StatusSeeOther)
		return
	}
	msg := fmt.Sprintf("created site %s on %s (parent %s)", proj.ID, cellLabel, parent.ID)
	a.endTrace(msg, nil)
	http.Redirect(w, r, "/projects/"+url.PathEscape(proj.ID)+"?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) childSitesOf(ctx context.Context, parentID string) []siteSummary {
	var out []siteSummary
	for _, s := range a.listSites(ctx) {
		if s.ParentProjectID == parentID {
			out = append(out, s)
		}
	}
	return out
}

func (a *App) sitesInWorkspace(ctx context.Context, workspaceID string) []siteSummary {
	var out []siteSummary
	for _, s := range a.listSites(ctx) {
		if s.WorkspaceID == workspaceID || s.ID == workspaceID {
			out = append(out, s)
		}
	}
	return out
}

func (a *App) latestTrace() *traceEntry {
	a.traceMu.Lock()
	defer a.traceMu.Unlock()
	if len(a.trace) == 0 {
		return nil
	}
	cp := a.trace[len(a.trace)-1]
	return &cp
}
