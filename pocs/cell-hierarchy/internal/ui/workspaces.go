package ui

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Workspace is UX metadata: name + home cell. Sites are projects with workspace_id.
type Workspace struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	HomeCell string `json:"home_cell"`
}

func (a *App) workspacePath() string {
	if a.workspaceFile != "" {
		return a.workspaceFile
	}
	return filepath.Join(".local", "workspaces.json")
}

func (a *App) seedWorkspaces() {
	a.wsMu.Lock()
	defer a.wsMu.Unlock()
	a.workspaces = map[string]Workspace{}
	if data, err := os.ReadFile(a.workspacePath()); err == nil {
		var list []Workspace
		if json.Unmarshal(data, &list) == nil {
			for _, w := range list {
				if w.ID != "" {
					a.workspaces[w.ID] = w
				}
			}
		}
	}
	if _, ok := a.workspaces["acme"]; !ok {
		a.workspaces["acme"] = Workspace{ID: "acme", Name: "Acme", HomeCell: "eu-1"}
	}
	_ = a.persistWorkspacesLocked()
}

func (a *App) persistWorkspacesLocked() error {
	list := make([]Workspace, 0, len(a.workspaces))
	for _, w := range a.workspaces {
		list = append(list, w)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	path := a.workspacePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func (a *App) listWorkspaces() []Workspace {
	a.wsMu.Lock()
	defer a.wsMu.Unlock()
	// Merge registry with workspace_ids discovered on projects.
	out := make([]Workspace, 0, len(a.workspaces))
	for _, w := range a.workspaces {
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (a *App) getWorkspace(id string) (Workspace, bool) {
	a.wsMu.Lock()
	defer a.wsMu.Unlock()
	w, ok := a.workspaces[id]
	return w, ok
}

func (a *App) putWorkspace(w Workspace) error {
	a.wsMu.Lock()
	defer a.wsMu.Unlock()
	if a.workspaces == nil {
		a.workspaces = map[string]Workspace{}
	}
	a.workspaces[w.ID] = w
	return a.persistWorkspacesLocked()
}

func (a *App) ensureWorkspaceFromSites(sites []siteSummary) {
	a.wsMu.Lock()
	defer a.wsMu.Unlock()
	if a.workspaces == nil {
		a.workspaces = map[string]Workspace{}
	}
	changed := false
	for _, s := range sites {
		if s.WorkspaceID == "" {
			continue
		}
		if _, ok := a.workspaces[s.WorkspaceID]; ok {
			continue
		}
		a.workspaces[s.WorkspaceID] = Workspace{
			ID: s.WorkspaceID, Name: s.WorkspaceID, HomeCell: s.HostLabel,
		}
		changed = true
	}
	if changed {
		_ = a.persistWorkspacesLocked()
	}
}

func (a *App) handleWorkspacesList(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	sites := a.listSites(ctx)
	a.ensureWorkspaceFromSites(sites)
	a.render(w, "workspaces", pageData{
		Title:          "Workspaces",
		NavActive:      "workspaces",
		Breadcrumbs:    []crumb{{Label: "Workspaces"}},
		Flash:          r.URL.Query().Get("ok"),
		FlashErr:       r.URL.Query().Get("err"),
		WorkspaceList:  a.listWorkspaces(),
		Cells:          a.leafCells(),
		ShowTracePanel: true,
		Trace:          a.copyTrace(),
	})
}

func (a *App) handleWorkspaceCreate(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	id := strings.TrimSpace(r.FormValue("id"))
	name := strings.TrimSpace(r.FormValue("name"))
	home := strings.TrimSpace(r.FormValue("home_cell"))
	if id == "" {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("workspace id required"), http.StatusSeeOther)
		return
	}
	if name == "" {
		name = id
	}
	if home == "" {
		home = "eu-1"
	}
	if _, err := a.cellURLByLabel(home); err != nil {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.beginTrace("create workspace " + id)
	if err := a.putWorkspace(Workspace{ID: id, Name: name, HomeCell: home}); err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.endTrace("home_cell="+home, nil)
	http.Redirect(w, r, "/workspaces/"+url.PathEscape(id)+"?ok="+url.QueryEscape("created workspace "+id), http.StatusSeeOther)
}

func (a *App) handleWorkspaceHome(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	wsID := strings.TrimSpace(r.PathValue("id"))
	if wsID == "" {
		http.Redirect(w, r, "/workspaces", http.StatusSeeOther)
		return
	}
	sites := a.listSites(ctx)
	a.ensureWorkspaceFromSites(sites)
	ws, ok := a.getWorkspace(wsID)
	if !ok {
		ws = Workspace{ID: wsID, Name: wsID, HomeCell: "eu-1"}
	}
	var filtered []siteSummary
	for _, s := range sites {
		if s.WorkspaceID == wsID {
			filtered = append(filtered, s)
		}
	}
	a.render(w, "workspace", pageData{
		Title:          "Workspace " + wsID,
		NavActive:      "workspaces",
		Breadcrumbs:    []crumb{{Label: "Workspaces", Href: "/workspaces"}, {Label: wsID}},
		Flash:          r.URL.Query().Get("ok"),
		FlashErr:       r.URL.Query().Get("err"),
		Workspace:      &ws,
		Sites:          filtered,
		Cells:          a.leafCells(),
		CellMeta:       a.cellDisplayMap(ctx),
		ShowTracePanel: true,
		Trace:          a.copyTrace(),
	})
}

func (a *App) handleWorkspaceAddSite(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	wsID := strings.TrimSpace(r.PathValue("id"))
	if wsID == "" {
		wsID = strings.TrimSpace(r.FormValue("workspace_id"))
	}
	if wsID == "" {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("workspace id required"), http.StatusSeeOther)
		return
	}
	siteID := strings.TrimSpace(r.FormValue("id"))
	name := strings.TrimSpace(r.FormValue("name"))
	cellLabel := strings.TrimSpace(r.FormValue("cell"))
	parentProjectID := strings.TrimSpace(r.FormValue("parent_project_id"))
	if parentProjectID == "" {
		parentProjectID = "platform"
	}
	if name == "" {
		name = siteID
	}
	if siteID == "" || cellLabel == "" {
		http.Redirect(w, r, "/workspaces/"+url.PathEscape(wsID)+"?err="+url.QueryEscape("site id and cell required"), http.StatusSeeOther)
		return
	}
	hostURL, err := a.cellURLByLabel(cellLabel)
	if err != nil {
		http.Redirect(w, r, "/workspaces/"+url.PathEscape(wsID)+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	a.beginTrace("add site " + siteID + " to " + wsID)
	proj, err := a.Peer.CreateProject(ctx, hostURL, map[string]any{
		"id": siteID, "name": name, "is_parent": false, "lookup_enabled": false,
		"workspace_id": wsID,
	})
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/workspaces/"+url.PathEscape(wsID)+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	parentHost, parent, err := a.findProject(ctx, parentProjectID)
	if err != nil {
		a.endTrace("created but attach failed: "+err.Error(), nil)
		http.Redirect(w, r, "/workspaces/"+url.PathEscape(wsID)+"?err="+url.QueryEscape("created but attach failed: "+err.Error()), http.StatusSeeOther)
		return
	}
	// Prefer the reachable cell URL from the UI registry (HostCellURL may be a docker hostname).
	parentCell := parentHost
	if err := a.Peer.AttachProject(ctx, hostURL, proj.ID, parent.ID, parentCell); err != nil {
		a.endTrace("created but attach failed: "+err.Error(), nil)
		http.Redirect(w, r, "/workspaces/"+url.PathEscape(wsID)+"?err="+url.QueryEscape("created but attach failed: "+err.Error()), http.StatusSeeOther)
		return
	}
	msg := fmt.Sprintf("created site %s on %s (workspace %s)", proj.ID, cellLabel, wsID)
	a.endTrace(msg, nil)
	http.Redirect(w, r, "/workspaces/"+url.PathEscape(wsID)+"?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}
