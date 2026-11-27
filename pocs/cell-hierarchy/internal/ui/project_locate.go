package ui

import (
	"context"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

// rememberProjectHost records which cell hosts a project so later API calls
// skip scanning every cell.
func (a *App) rememberProjectHost(projectID, hostURL string) {
	projectID = strings.TrimSpace(projectID)
	hostURL = cell.NormalizeURL(hostURL)
	if projectID == "" || hostURL == "" {
		return
	}
	a.hostMu.Lock()
	defer a.hostMu.Unlock()
	if a.projectHost == nil {
		a.projectHost = map[string]string{}
	}
	a.projectHost[projectID] = hostURL
}

func (a *App) cachedProjectHost(projectID string) string {
	a.hostMu.Lock()
	defer a.hostMu.Unlock()
	if a.projectHost == nil {
		return ""
	}
	return a.projectHost[projectID]
}

func (a *App) forgetProjectHost(projectID string) {
	a.hostMu.Lock()
	defer a.hostMu.Unlock()
	delete(a.projectHost, projectID)
}

// hostHintForProject returns a likely cell URL without contacting cells:
// in-memory cache, then workspace registry cell for root sites.
func (a *App) hostHintForProject(projectID string) string {
	if host := a.cachedProjectHost(projectID); host != "" {
		return host
	}
	if ws, ok := a.getWorkspace(projectID); ok && ws.Cell != "" {
		if u, err := a.cellURLByLabel(ws.Cell); err == nil {
			return u
		}
	}
	return ""
}

// findProject locates a project. Prefer a direct GetProject on a known host;
// only scan all cells on a cache miss.
func (a *App) findProject(ctx context.Context, id string) (string, cell.ProjectResponse, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", cell.ProjectResponse{}, fmt.Errorf("project id required")
	}
	if hint := a.hostHintForProject(id); hint != "" {
		p, err := a.Peer.GetProject(ctx, hint, id)
		if err == nil {
			a.rememberProjectHost(id, hint)
			return hint, p, nil
		}
		a.forgetProjectHost(id)
	}
	for _, c := range a.Cells {
		p, err := a.Peer.GetProject(ctx, c.URL, id)
		if err != nil {
			continue
		}
		a.rememberProjectHost(id, c.URL)
		return c.URL, p, nil
	}
	return "", cell.ProjectResponse{}, fmt.Errorf("project %s not found", id)
}
