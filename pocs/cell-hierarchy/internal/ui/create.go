package ui

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

type createPageData struct {
	Title      string
	Flash      string
	FlashErr   string
	Cells      []CellRef
	LeafCells  []CellRef
	Projects   []projectOption
	Sites      []projectOption
	Workspaces []string
	CellMeta   map[string]string
}

type projectOption struct {
	ID          string
	Name        string
	HostLabel   string
	HostURL     string
	WorkspaceID string
}

func (a *App) handleCreateForm(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	projects := a.listAllProjects(ctx)
	var sites []projectOption
	wsSeen := map[string]bool{}
	var workspaces []string
	for _, p := range projects {
		if p.WorkspaceID != "" {
			sites = append(sites, p)
			if !wsSeen[p.WorkspaceID] {
				wsSeen[p.WorkspaceID] = true
				workspaces = append(workspaces, p.WorkspaceID)
			}
		}
	}
	sort.Strings(workspaces)
	a.render(w, "create", createPageData{
		Title:      "Create",
		Flash:      r.URL.Query().Get("ok"),
		FlashErr:   r.URL.Query().Get("err"),
		Cells:      a.Cells,
		LeafCells:  a.leafCells(),
		Projects:   projects,
		Sites:      sites,
		Workspaces: workspaces,
		CellMeta:   a.cellDisplayMap(ctx),
	})
}

func (a *App) listAllProjects(ctx context.Context) []projectOption {
	var out []projectOption
	for _, c := range a.Cells {
		projects, err := a.Peer.ListProjects(ctx, c.URL)
		if err != nil {
			continue
		}
		for _, p := range projects {
			host := p.HostCellURL
			if host == "" {
				host = c.URL
			}
			out = append(out, projectOption{
				ID: p.ID, Name: p.Name, HostLabel: c.Label, HostURL: host,
				WorkspaceID: p.WorkspaceID,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].HostLabel != out[j].HostLabel {
			return out[i].HostLabel < out[j].HostLabel
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (a *App) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	hostLabel := strings.TrimSpace(r.FormValue("host_cell"))
	id := strings.TrimSpace(r.FormValue("id"))
	name := strings.TrimSpace(r.FormValue("name"))
	isParent := r.FormValue("is_parent") == "1"
	lookupEnabled := r.FormValue("lookup_enabled") == "1"
	parentProjectID := strings.TrimSpace(r.FormValue("parent_project_id"))
	if name == "" {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("name required"), http.StatusSeeOther)
		return
	}
	hostURL, err := a.cellURLByLabel(hostLabel)
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	body := map[string]any{
		"name": name, "is_parent": isParent, "lookup_enabled": lookupEnabled,
	}
	if id != "" {
		body["id"] = id
	}
	proj, err := a.Peer.CreateProject(ctx, hostURL, body)
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	if parentProjectID != "" {
		parentHost, parent, err := a.findProject(ctx, parentProjectID)
		if err != nil {
			http.Redirect(w, r, "/create?err="+url.QueryEscape("created but attach failed: "+err.Error()), http.StatusSeeOther)
			return
		}
		parentCell := parent.HostCellURL
		if parentCell == "" {
			parentCell = parentHost
		}
		if err := a.Peer.AttachProject(ctx, hostURL, proj.ID, parent.ID, parentCell); err != nil {
			http.Redirect(w, r, "/create?err="+url.QueryEscape("created but attach failed: "+err.Error()), http.StatusSeeOther)
			return
		}
	}
	msg := fmt.Sprintf("created project %s on %s", proj.ID, hostLabel)
	http.Redirect(w, r, "/create?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) handleCreateTeam(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	projectID := strings.TrimSpace(r.FormValue("project_id"))
	name := strings.TrimSpace(r.FormValue("name"))
	parentTeamID := strings.TrimSpace(r.FormValue("parent_team_id"))
	if projectID == "" || name == "" {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("project and name required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	hostURL, _, err := a.findProject(ctx, projectID)
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	body := map[string]any{"name": name}
	if parentTeamID != "" {
		body["parent_team_id"] = parentTeamID
	}
	team, err := a.Peer.CreateTeam(ctx, hostURL, projectID, body)
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	msg := fmt.Sprintf("created team %s under project %s", team.Name, projectID)
	http.Redirect(w, r, "/create?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) handleCreateAppForm(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	projectID := strings.TrimSpace(r.FormValue("project_id"))
	name := strings.TrimSpace(r.FormValue("name"))
	if projectID == "" || name == "" {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("project and name required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	hostURL, _, err := a.findProject(ctx, projectID)
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	app, err := a.Peer.CreateApp(ctx, hostURL, projectID, map[string]any{"name": name})
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	msg := fmt.Sprintf("created app %s on project %s", app.Name, projectID)
	http.Redirect(w, r, "/create?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}
