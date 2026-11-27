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

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

// Workspace is a thin registry entry for a root site.
// The workspace IS the first site/project (id == project id).
type Workspace struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Cell           string `json:"cell"`
	CustomerTeamID string `json:"customer_team_id"`
	// HomeCell kept for back-compat with older workspace JSON files.
	HomeCell string `json:"home_cell,omitempty"`
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
				if w.ID == "" {
					continue
				}
				if w.Cell == "" {
					w.Cell = w.HomeCell
				}
				a.workspaces[w.ID] = w
			}
		}
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
	if w.Cell == "" {
		w.Cell = w.HomeCell
	}
	a.workspaces[w.ID] = w
	return a.persistWorkspacesLocked()
}

// ensureWorkspaceFromSites registers root sites (workspace_id == project id) into the thin registry.
func (a *App) ensureWorkspaceFromSites(sites []siteSummary) {
	a.wsMu.Lock()
	defer a.wsMu.Unlock()
	if a.workspaces == nil {
		a.workspaces = map[string]Workspace{}
	}
	changed := false
	for _, s := range sites {
		if s.ID == "" || s.WorkspaceID == "" || s.WorkspaceID != s.ID {
			continue // only roots: workspace_id == self
		}
		if s.IsPlatform {
			continue
		}
		existing, ok := a.workspaces[s.ID]
		if ok && existing.CustomerTeamID == s.CustomerTeamID && existing.Cell == s.HostLabel {
			continue
		}
		a.workspaces[s.ID] = Workspace{
			ID: s.ID, Name: s.Name, Cell: s.HostLabel, CustomerTeamID: s.CustomerTeamID,
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
	teams, _ := a.listPlatformTeams(ctx)
	var roots []siteSummary
	for _, s := range sites {
		if s.IsPlatform {
			continue
		}
		// Workspace root = self-id, or empty parent with workspace_id set (not platform attach).
		if s.WorkspaceID == s.ID || (s.ParentProjectID == "" && s.WorkspaceID != "") {
			roots = append(roots, s)
		}
	}
	a.render(w, "workspaces", pageData{
		Title:         "Workspaces",
		NavActive:     "workspaces",
		Breadcrumbs:   []crumb{{Label: "Workspaces"}},
		Flash:         r.URL.Query().Get("ok"),
		FlashErr:      r.URL.Query().Get("err"),
		WorkspaceList: a.listWorkspaces(),
		Sites:         roots,
		Cells:         a.leafCells(),
		Teams:         teams,
		LatestTrace:   a.latestTrace(),
	})
}

func (a *App) handleWorkspaceCreate(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	id := strings.TrimSpace(r.FormValue("id"))
	name := strings.TrimSpace(r.FormValue("name"))
	cellLabel := strings.TrimSpace(r.FormValue("cell"))
	if cellLabel == "" {
		cellLabel = strings.TrimSpace(r.FormValue("home_cell"))
	}
	teamID := strings.TrimSpace(r.FormValue("customer_team_id"))
	if id == "" {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("workspace id required"), http.StatusSeeOther)
		return
	}
	if name == "" {
		name = id
	}
	if cellLabel == "" {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("cell required"), http.StatusSeeOther)
		return
	}
	if teamID == "" {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("customer team required"), http.StatusSeeOther)
		return
	}
	hostURL, err := a.cellURLByLabel(cellLabel)
	if err != nil {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	// Validate team exists on platform.
	if _, err := a.findPlatformTeam(ctx, teamID); err != nil {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}

	a.beginTrace("create workspace " + id)
	// Workspace root is a site with no project parent. Link to customer team via
	// customer_team_id only — do NOT AttachProject to platform (lookup stays site-only).
	proj, err := a.Peer.CreateProject(ctx, hostURL, map[string]any{
		"id": id, "name": name,
		"is_parent": false, "lookup_enabled": true,
		"workspace_id": id, "customer_team_id": teamID,
	})
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}

	_ = a.putWorkspace(Workspace{
		ID: id, Name: name, Cell: cellLabel, CustomerTeamID: teamID,
	})
	msg := fmt.Sprintf("created workspace/site %s on %s (team %s)", proj.ID, cellLabel, teamID)
	a.endTrace(msg, nil)
	http.Redirect(w, r, "/projects/"+url.PathEscape(proj.ID)+"?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) handleWorkspaceHome(w http.ResponseWriter, r *http.Request) {
	wsID := strings.TrimSpace(r.PathValue("id"))
	if wsID == "" {
		http.Redirect(w, r, "/workspaces", http.StatusSeeOther)
		return
	}
	// Workspace IS the root site — redirect to the project page.
	http.Redirect(w, r, "/projects/"+url.PathEscape(wsID), http.StatusSeeOther)
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
	// Prefer project-page add-site; keep this for back-compat.
	r.Form.Set("parent_project_id", strings.TrimSpace(r.FormValue("parent_project_id")))
	if r.Form.Get("parent_project_id") == "" {
		r.Form.Set("parent_project_id", wsID)
	}
	r.Form.Set("workspace_id", wsID)
	a.handleProjectAddSite(w, r)
}

func (a *App) listPlatformTeams(ctx context.Context) ([]cell.TeamView, error) {
	platformHost, err := a.cellURLByLabel("platform")
	if err != nil {
		return nil, err
	}
	return a.Peer.ListTeams(ctx, platformHost, "platform")
}

func (a *App) findPlatformTeam(ctx context.Context, teamID string) (cell.TeamView, error) {
	teams, err := a.listPlatformTeams(ctx)
	if err != nil {
		return cell.TeamView{}, err
	}
	for _, t := range teams {
		if t.ID == teamID || t.Name == teamID {
			return t, nil
		}
	}
	return cell.TeamView{}, fmt.Errorf("customer team %q not found on platform — create it under Platform first", teamID)
}
