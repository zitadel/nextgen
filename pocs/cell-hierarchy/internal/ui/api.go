package ui

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func (a *App) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func (a *App) writeAPIError(w http.ResponseWriter, status int, err error, timeline *timelineView) {
	body := map[string]any{"error": err.Error()}
	if timeline != nil {
		body["timeline"] = timeline
	}
	a.writeJSON(w, status, body)
}

func (a *App) decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func (a *App) registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/meta", a.apiMeta)
	mux.HandleFunc("GET /api/v1/cells", a.apiCells)
	mux.HandleFunc("POST /api/v1/join", a.apiJoin)
	mux.HandleFunc("GET /api/v1/cells/{label}", a.apiCellDetail)
	mux.HandleFunc("GET /api/v1/platform", a.apiPlatform)
	mux.HandleFunc("POST /api/v1/platform/teams", a.apiCreateTeam)
	mux.HandleFunc("GET /api/v1/workspaces", a.apiWorkspaces)
	mux.HandleFunc("POST /api/v1/workspaces", a.apiCreateWorkspace)
	mux.HandleFunc("GET /api/v1/projects/{id}", a.apiProject)
	mux.HandleFunc("POST /api/v1/projects/{id}/users", a.apiCreateUser)
	mux.HandleFunc("DELETE /api/v1/projects/{id}/users", a.apiDeleteUser)
	mux.HandleFunc("POST /api/v1/projects/{id}/lookup", a.apiLookup)
	mux.HandleFunc("POST /api/v1/projects/{id}/sites", a.apiAddSite)
	mux.HandleFunc("GET /api/v1/latest-trace", a.apiLatestTrace)
}

func (a *App) apiMeta(w http.ResponseWriter, r *http.Request) {
	cells := make([]CellRef, len(a.Cells))
	copy(cells, a.Cells)
	a.writeJSON(w, http.StatusOK, map[string]any{
		"cells":       cells,
		"leaf_cells":  a.leafCells(),
		"delay_pairs": a.delayPairViews(),
	})
}

func (a *App) apiCells(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tree, unjoined, err := a.buildTreeFromPlatform(ctx)
	if err != nil {
		a.writeAPIError(w, http.StatusBadGateway, err, nil)
		return
	}
	parents, unjoinedOpts := a.platformJoinOptions(unjoined)
	a.writeJSON(w, http.StatusOK, map[string]any{
		"tree":           tree,
		"unjoined":       unjoined,
		"parents":        parents,
		"unjoined_opts":  unjoinedOpts,
		"delay_pairs":    a.delayPairViews(),
		"now":            time.Now().UTC().Format(time.RFC3339),
		"latest":         a.latestTracePayload(),
	})
}

func (a *App) apiJoin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParentURL string `json:"parent_url"`
		ChildURL  string `json:"child_url"`
	}
	if err := a.decodeJSON(r, &body); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, err, nil)
		return
	}
	if body.ParentURL == "" || body.ChildURL == "" {
		a.writeAPIError(w, http.StatusBadRequest, errString("parent and child required"), nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	msg, tl, err := a.doJoin(ctx, body.ParentURL, body.ChildURL)
	if err != nil {
		a.writeAPIError(w, http.StatusBadGateway, err, tl)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"ok": msg, "timeline": tl})
}

func (a *App) apiCellDetail(w http.ResponseWriter, r *http.Request) {
	label := r.PathValue("label")
	ref, ok := a.findByLabel(label)
	if !ok {
		a.writeAPIError(w, http.StatusNotFound, errString("cell not found"), nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	detail := map[string]any{"label": label, "url": ref.URL}
	me, err := a.Peer.GetMe(ctx, ref.URL)
	if err != nil {
		detail["error"] = err.Error()
		a.writeJSON(w, http.StatusOK, detail)
		return
	}
	detail["me"] = me
	children, err := a.fetchChildren(ctx, ref.URL)
	if err != nil {
		detail["error"] = err.Error()
	} else {
		detail["children"] = children
	}
	projects, err := a.Peer.ListProjects(ctx, ref.URL)
	if err != nil {
		detail["error"] = err.Error()
	} else {
		detail["projects"] = projects
	}
	detail["latest"] = a.latestTracePayload()
	a.writeJSON(w, http.StatusOK, detail)
}

func (a *App) apiPlatform(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out := map[string]any{"latest": a.latestTracePayload()}
	platformHost, err := a.cellURLByLabel("platform")
	if err != nil {
		out["error"] = err.Error()
		a.writeJSON(w, http.StatusOK, out)
		return
	}
	out["host_url"] = platformHost
	proj, err := a.Peer.GetProject(ctx, platformHost, "platform")
	if err != nil {
		out["error"] = err.Error()
	} else {
		out["project"] = proj
	}
	teams, err := a.Peer.ListTeams(ctx, platformHost, "platform")
	if err != nil {
		if out["error"] == nil {
			out["error"] = err.Error()
		}
	} else {
		out["teams"] = teams
	}
	a.writeJSON(w, http.StatusOK, out)
}

func (a *App) apiCreateTeam(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		ID   string `json:"id"`
	}
	if err := a.decodeJSON(r, &body); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, err, nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	team, msg, tl, err := a.doCreateTeam(ctx, body.Name, body.ID)
	if err != nil {
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "required") {
			status = http.StatusBadRequest
		}
		a.writeAPIError(w, status, err, tl)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"ok": msg, "team": team, "timeline": tl})
}

func (a *App) apiWorkspaces(w http.ResponseWriter, r *http.Request) {
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
		if s.WorkspaceID == s.ID || (s.ParentProjectID == "" && s.WorkspaceID != "") {
			roots = append(roots, s)
		}
	}
	a.writeJSON(w, http.StatusOK, map[string]any{
		"workspaces": a.listWorkspaces(),
		"sites":      roots,
		"cells":      a.leafCells(),
		"teams":      teams,
		"latest":     a.latestTracePayload(),
	})
}

func (a *App) apiCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		Cell           string `json:"cell"`
		CustomerTeamID string `json:"customer_team_id"`
	}
	if err := a.decodeJSON(r, &body); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, err, nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	proj, msg, tl, err := a.doCreateWorkspace(ctx, body.ID, body.Name, body.Cell, body.CustomerTeamID)
	if err != nil {
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "not found") {
			status = http.StatusBadRequest
		}
		a.writeAPIError(w, status, err, tl)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{
		"ok": msg, "project": proj, "timeline": tl,
		"redirect": "/projects/" + proj.ID,
	})
}

func (a *App) apiProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	out := map[string]any{
		"id":     id,
		"latest": a.latestTracePayload(),
		"cells":  a.leafCells(),
	}
	hostURL, proj, err := a.findProject(ctx, id)
	if err != nil {
		out["error"] = err.Error()
		a.writeJSON(w, http.StatusOK, out)
		return
	}
	hostLabel := ""
	for _, c := range a.Cells {
		if cell.NormalizeURL(c.URL) == cell.NormalizeURL(hostURL) {
			hostLabel = c.Label
			break
		}
	}
	workspaceRoot := proj.WorkspaceID
	if workspaceRoot == "" {
		workspaceRoot = proj.ID
	}
	var raw struct {
		Users  []userRow   `json:"users"`
		Lookup []lookupRow `json:"lookup"`
	}
	if err := a.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(hostURL)+"/v1/projects/"+id, nil, "", &raw); err != nil {
		out["error"] = err.Error()
	}
	childSites := a.childSitesOf(ctx, id)
	parentOptions := a.sitesInWorkspace(ctx, workspaceRoot)
	out["project"] = proj
	out["host_label"] = hostLabel
	out["host_url"] = hostURL
	out["customer_team"] = proj.CustomerTeamID
	out["workspace_root"] = workspaceRoot
	out["users"] = raw.Users
	out["lookup"] = raw.Lookup
	out["child_sites"] = childSites
	out["parent_options"] = parentOptions
	a.writeJSON(w, http.StatusOK, out)
}

func (a *App) apiCreateUser(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	var body struct {
		Email string `json:"email"`
	}
	if err := a.decodeJSON(r, &body); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, err, nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	msg, tl, err := a.doCreateUser(ctx, projectID, body.Email)
	if err != nil {
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "required") {
			status = http.StatusBadRequest
		}
		a.writeAPIError(w, status, err, tl)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"ok": msg, "timeline": tl})
}

func (a *App) apiDeleteUser(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	email := strings.TrimSpace(r.URL.Query().Get("email"))
	if email == "" && r.Body != nil {
		var body struct {
			Email string `json:"email"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		email = strings.TrimSpace(body.Email)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	msg, tl, err := a.doDeleteUser(ctx, projectID, email)
	if err != nil {
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "required") {
			status = http.StatusBadRequest
		}
		a.writeAPIError(w, status, err, tl)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"ok": msg, "timeline": tl})
}

func (a *App) apiLookup(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	var body struct {
		Key string `json:"key"`
	}
	if err := a.decodeJSON(r, &body); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, err, nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	result, note, tl, err := a.doLookup(ctx, projectID, body.Key)
	if err != nil {
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "required") {
			status = http.StatusBadRequest
		}
		a.writeAPIError(w, status, err, tl)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{
		"ok": note, "result": result, "timeline": tl,
	})
}

func (a *App) apiAddSite(w http.ResponseWriter, r *http.Request) {
	fromProject := r.PathValue("id")
	var body struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		Cell            string `json:"cell"`
		ParentProjectID string `json:"parent_project_id"`
		WorkspaceID     string `json:"workspace_id"`
	}
	if err := a.decodeJSON(r, &body); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, err, nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	proj, msg, tl, err := a.doAddSite(ctx, fromProject, body.ID, body.Name, body.Cell, body.ParentProjectID, body.WorkspaceID)
	if err != nil {
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "required") {
			status = http.StatusBadRequest
		}
		a.writeAPIError(w, status, err, tl)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{
		"ok": msg, "project": proj, "timeline": tl,
		"redirect": "/projects/" + proj.ID,
	})
}

func (a *App) apiLatestTrace(w http.ResponseWriter, r *http.Request) {
	a.writeJSON(w, http.StatusOK, a.latestTracePayload())
}

func (a *App) latestTracePayload() map[string]any {
	te := a.latestTrace()
	tl := a.latestTimeline()
	out := map[string]any{"timeline": tl}
	if te != nil {
		out["action"] = te.Action
		out["note"] = te.Note
		out["at"] = te.At
		out["hops"] = te.Hops
	}
	return out
}

type errString string

func (e errString) Error() string { return string(e) }
