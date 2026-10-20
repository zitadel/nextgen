package ui

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

type siteSummary struct {
	ID            string
	Name          string
	WorkspaceID   string
	HostLabel     string
	HostDisplay   string
	HostURL       string
	UserCount     int
	AppCount      int
	LookupEnabled bool
	IsPlatform    bool
}

type workspacePageData struct {
	Title       string
	Flash       string
	FlashErr    string
	WorkspaceID string
	Sites       []siteSummary
	Cells       []CellRef
	Workspaces  []string
	CellMeta    map[string]string // label → display
}

func (a *App) cellDisplayMap(ctx context.Context) map[string]string {
	out := map[string]string{}
	for _, c := range a.Cells {
		out[c.Label] = c.Label
		me, err := a.Peer.GetMe(ctx, c.URL)
		if err != nil {
			continue
		}
		if me.Display != "" {
			out[c.Label] = me.Display
		}
	}
	return out
}

func (a *App) listSites(ctx context.Context) []siteSummary {
	displays := a.cellDisplayMap(ctx)
	var out []siteSummary
	for _, c := range a.Cells {
		projects, err := a.Peer.ListProjects(ctx, c.URL)
		if err != nil {
			continue
		}
		for _, p := range projects {
			sum := siteSummary{
				ID:            p.ID,
				Name:          p.Name,
				WorkspaceID:   p.WorkspaceID,
				HostLabel:     c.Label,
				HostDisplay:   displays[c.Label],
				HostURL:       c.URL,
				LookupEnabled: p.LookupEnabled,
				IsPlatform:    p.ID == "platform",
			}
			var raw struct {
				Users []userRow      `json:"users"`
				Apps  []cell.AppView `json:"apps"`
			}
			_ = a.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(c.URL)+"/v1/projects/"+p.ID, nil, "", &raw)
			sum.UserCount = len(raw.Users)
			sum.AppCount = len(raw.Apps)
			out = append(out, sum)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].WorkspaceID != out[j].WorkspaceID {
			return out[i].WorkspaceID < out[j].WorkspaceID
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (a *App) listWorkspaceIDs(sites []siteSummary) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range sites {
		if s.WorkspaceID == "" || seen[s.WorkspaceID] {
			continue
		}
		seen[s.WorkspaceID] = true
		out = append(out, s.WorkspaceID)
	}
	sort.Strings(out)
	return out
}

func (a *App) handleWorkspaceHome(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	ws := strings.TrimSpace(r.PathValue("id"))
	if ws == "" {
		ws = "acme"
	}
	sites := a.listSites(ctx)
	var filtered []siteSummary
	for _, s := range sites {
		if s.WorkspaceID == ws {
			filtered = append(filtered, s)
		}
	}
	a.render(w, "workspace", workspacePageData{
		Title:       "Workspace " + ws,
		Flash:       r.URL.Query().Get("ok"),
		FlashErr:    r.URL.Query().Get("err"),
		WorkspaceID: ws,
		Sites:       filtered,
		Cells:       a.leafCells(),
		Workspaces:  a.listWorkspaceIDs(sites),
		CellMeta:    a.cellDisplayMap(ctx),
	})
}

func (a *App) leafCells() []CellRef {
	var out []CellRef
	for _, c := range a.Cells {
		if c.Label == "platform" || c.Label == "spare" {
			continue
		}
		out = append(out, c)
	}
	return out
}

func (a *App) handleCreateSite(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	workspaceID := strings.TrimSpace(r.FormValue("workspace_id"))
	if workspaceID == "" {
		workspaceID = "acme"
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
		http.Redirect(w, r, "/create?err="+url.QueryEscape("site id and cell required"), http.StatusSeeOther)
		return
	}
	hostURL, err := a.cellURLByLabel(cellLabel)
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	proj, err := a.Peer.CreateProject(ctx, hostURL, map[string]any{
		"id": siteID, "name": name, "is_parent": false, "lookup_enabled": false,
		"workspace_id": workspaceID,
	})
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
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
	msg := fmt.Sprintf("created site %s on %s (workspace %s)", proj.ID, cellLabel, workspaceID)
	http.Redirect(w, r, "/workspaces/"+url.PathEscape(workspaceID)+"?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) handleExpandSite(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	workspaceID := strings.TrimSpace(r.FormValue("workspace_id"))
	if workspaceID == "" {
		workspaceID = "acme"
	}
	sourceSiteID := strings.TrimSpace(r.FormValue("source_site_id"))
	newCell := strings.TrimSpace(r.FormValue("cell"))
	newSiteID := strings.TrimSpace(r.FormValue("id"))
	copyChat := r.FormValue("copy_chat") == "1"
	if sourceSiteID == "" || newCell == "" {
		http.Redirect(w, r, "/create?err="+url.QueryEscape("source site and cell required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()

	srcHost, src, err := a.findProject(ctx, sourceSiteID)
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	ws := src.WorkspaceID
	if ws == "" {
		ws = workspaceID
	}
	if newSiteID == "" {
		// Derive a site id from cell label, e.g. us-1 → acme-iowa when display suggests Iowa.
		newSiteID = workspaceID + "-" + strings.ReplaceAll(newCell, "-", "")
		if newCell == "us-1" {
			newSiteID = workspaceID + "-iowa"
		} else if newCell == "us-2" {
			newSiteID = workspaceID + "-sf"
		} else if newCell == "eu-1" {
			newSiteID = workspaceID + "-fra"
		} else if newCell == "eu-2" {
			newSiteID = workspaceID + "-lis"
		}
	}
	hostURL, err := a.cellURLByLabel(newCell)
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	proj, err := a.Peer.CreateProject(ctx, hostURL, map[string]any{
		"id": newSiteID, "name": newSiteID, "is_parent": false, "lookup_enabled": false,
		"workspace_id": ws,
	})
	if err != nil {
		http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	parentID := src.ParentProjectID
	if parentID == "" {
		parentID = "platform"
	}
	parentHost, parent, err := a.findProject(ctx, parentID)
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

	appsCopied := 0
	if copyChat {
		apps, err := a.Peer.ListApps(ctx, srcHost, sourceSiteID)
		if err != nil {
			http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
			return
		}
		for _, app := range apps {
			if app.Name != "chat" {
				continue
			}
			if _, err := a.Peer.CreateApp(ctx, hostURL, proj.ID, map[string]any{"name": app.Name}); err != nil {
				http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
				return
			}
			appsCopied++
		}
		if appsCopied == 0 {
			if _, err := a.Peer.CreateApp(ctx, hostURL, proj.ID, map[string]any{"name": "chat"}); err != nil {
				http.Redirect(w, r, "/create?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
				return
			}
			appsCopied = 1
		}
	}
	msg := fmt.Sprintf("expanded site %s on %s (from %s, apps=%d)", proj.ID, newCell, sourceSiteID, appsCopied)
	a.appendTrace("expand site "+proj.ID, nil, msg)
	http.Redirect(w, r, "/workspaces/"+url.PathEscape(ws)+"?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}
