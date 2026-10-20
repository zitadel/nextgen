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
	ID              string
	Name            string
	WorkspaceID     string
	CustomerTeamID  string
	ParentProjectID string
	HostLabel       string
	HostDisplay     string
	HostURL         string
	UserCount       int
	LookupEnabled   bool
	IsPlatform      bool
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
				ID:              p.ID,
				Name:            p.Name,
				WorkspaceID:     p.WorkspaceID,
				CustomerTeamID:  p.CustomerTeamID,
				ParentProjectID: p.ParentProjectID,
				HostLabel:       c.Label,
				HostDisplay:     displays[c.Label],
				HostURL:         c.URL,
				LookupEnabled:   p.LookupEnabled,
				IsPlatform:      p.ID == "platform",
			}
			var raw struct {
				Users []userRow `json:"users"`
			}
			_ = a.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(c.URL)+"/v1/projects/"+p.ID, nil, "", &raw)
			sum.UserCount = len(raw.Users)
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

// handleCreateSiteLegacy keeps POST /create/site working via workspace_id form field.
func (a *App) handleCreateSiteLegacy(w http.ResponseWriter, r *http.Request) {
	a.handleWorkspaceAddSite(w, r)
}

func (a *App) handleExpandSite(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/workspaces?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
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
		http.Redirect(w, r, "/workspaces/"+url.PathEscape(workspaceID)+"?err="+url.QueryEscape("source site and cell required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()

	a.beginTrace("expand site from " + sourceSiteID)
	srcHost, src, err := a.findProject(ctx, sourceSiteID)
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/workspaces/"+url.PathEscape(workspaceID)+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	ws := src.WorkspaceID
	if ws == "" {
		ws = workspaceID
	}
	if newSiteID == "" {
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
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/workspaces/"+url.PathEscape(ws)+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	teamID := src.CustomerTeamID
	proj, err := a.Peer.CreateProject(ctx, hostURL, map[string]any{
		"id": newSiteID, "name": newSiteID, "is_parent": false, "lookup_enabled": true,
		"workspace_id": ws, "customer_team_id": teamID,
	})
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/projects/"+url.PathEscape(sourceSiteID)+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	// Child attaches to the source site (not platform sibling).
	if err := a.Peer.AttachProject(ctx, hostURL, proj.ID, src.ID, srcHost); err != nil {
		a.endTrace("created but attach failed: "+err.Error(), nil)
		http.Redirect(w, r, "/projects/"+url.PathEscape(sourceSiteID)+"?err="+url.QueryEscape("created but attach failed: "+err.Error()), http.StatusSeeOther)
		return
	}
	_ = copyChat // apps deferred; flag ignored
	msg := fmt.Sprintf("expanded site %s on %s (parent %s)", proj.ID, newCell, sourceSiteID)
	a.endTrace(msg, nil)
	http.Redirect(w, r, "/projects/"+url.PathEscape(proj.ID)+"?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}
