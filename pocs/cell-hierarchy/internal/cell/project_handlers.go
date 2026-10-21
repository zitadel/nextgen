package cell

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type TraceHop struct {
	Cell      string `json:"cell"`
	Method    string `json:"method"`
	Ms        int64  `json:"ms"`
	Result    string `json:"result"`
	From      string `json:"from,omitempty"`       // caller cell URL; empty for UI→entry OnHop
	ProjectID string `json:"project_id,omitempty"` // project resolved / looked up at this hop
}

type ProjectView struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	IsParent        bool   `json:"is_parent"`
	LookupEnabled   bool   `json:"lookup_enabled"`
	WorkspaceID     string `json:"workspace_id,omitempty"`
	CustomerTeamID  string `json:"customer_team_id,omitempty"`
	ParentProjectID string `json:"parent_project_id"`
	ParentCellURL   string `json:"parent_cell_url"`
	HostCellURL     string `json:"host_cell_url"`
	CreatedAt       string `json:"created_at"`
}

type UserView struct {
	ID                   string  `json:"id"`
	ProjectID            string  `json:"project_id"`
	Email                string  `json:"email"`
	Epoch                int     `json:"epoch"`
	Blocked              bool    `json:"blocked"`
	DeletedAt            *string `json:"deleted_at,omitempty"`
	LifecycleOwnerTeamID string  `json:"lifecycle_owner_team_id,omitempty"`
	CreatedAt            string  `json:"created_at"`
}

func userView(u User) UserView {
	v := UserView{
		ID: u.ID, ProjectID: u.ProjectID, Email: u.Email,
		Epoch: u.Epoch, Blocked: u.Blocked,
		LifecycleOwnerTeamID: u.LifecycleOwnerTeamID,
		CreatedAt:            u.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if v.Epoch <= 0 {
		v.Epoch = DefaultUserEpoch
	}
	if u.DeletedAt != nil {
		s := u.DeletedAt.UTC().Format(time.RFC3339Nano)
		v.DeletedAt = &s
	}
	return v
}

type LookupView struct {
	Key           string `json:"key"`
	HomeProjectID string `json:"home_project_id"`
	HomeCellURL   string `json:"home_cell_url"`
	State         string `json:"state"`
	Source        string `json:"source"`
	ViaProject    string `json:"via_project,omitempty"`
	UpdatedAt     string `json:"updated_at"`
}

func (s *Server) registerProjectRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/projects", s.handleListProjects)
	mux.HandleFunc("POST /v1/projects", s.handleCreateProject)
	mux.HandleFunc("GET /v1/projects/{id}", s.handleGetProject)
	mux.HandleFunc("POST /v1/projects/{id}/attach", s.handleAttachProject)
	mux.HandleFunc("POST /v1/projects/{id}/users", s.handleCreateUser)
	mux.HandleFunc("POST /v1/projects/{id}/float", s.handleFloatUser)
	mux.HandleFunc("POST /v1/lookup", s.handleLookup)
	mux.HandleFunc("POST /v1/lookup/push", s.handleLookupPush)
	mux.HandleFunc("POST /v1/lookup/walk", s.handleLookupWalk)
	mux.HandleFunc("POST /v1/me/parent", s.handleEnableParent)
	mux.HandleFunc("POST /v1/admin/enable-parent", s.handleEnableParent)
	mux.HandleFunc("POST /v1/admin/delays", s.handleAdminDelays)
}

func (s *Server) floatDelay() time.Duration {
	if s.FloatDelay > 0 {
		return s.FloatDelay
	}
	if v := os.Getenv("FLOAT_DELAY_MS"); v != "" {
		ms, err := strconv.Atoi(v)
		if err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 0
}

func projectView(p Project, host string) ProjectView {
	return ProjectView{
		ID:              p.ID,
		Name:            p.Name,
		IsParent:        p.IsParent,
		LookupEnabled:   p.LookupEnabled,
		WorkspaceID:     p.WorkspaceID,
		CustomerTeamID:  p.CustomerTeamID,
		ParentProjectID: p.ParentProjectID,
		ParentCellURL:   p.ParentCellURL,
		HostCellURL:     host,
		CreatedAt:       p.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func lookupView(e LookupEntry) LookupView {
	src := e.Source
	if src == "" {
		if e.State == LookupStateLocal || e.State == LookupStatePushed {
			src = LookupSourceLocal
		} else {
			src = LookupSourceChild
		}
	}
	return LookupView{
		Key:           e.Key,
		HomeProjectID: e.HomeProjectID,
		HomeCellURL:   e.HomeCellURL,
		State:         e.State,
		Source:        src,
		ViaProject:    e.ViaProject,
		UpdatedAt:     e.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (s *Server) handleEnableParent(w http.ResponseWriter, _ *http.Request) {
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.Store.SetIsParent(true); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	meta.IsParent = true
	status := "unjoined"
	switch {
	case meta.ParentURL != "":
		status = "joined"
	case meta.IsParent:
		status = "root"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"is_parent": true,
		"note":      "join key still via POST /v1/join/prepare on this cell",
		"me": MeResponse{
			URL: meta.URL, Label: meta.Label, Display: meta.Display,
			IsParent: true, ParentURL: meta.ParentURL, Status: status,
		},
	})
}

func (s *Server) handleListProjects(w http.ResponseWriter, _ *http.Request) {
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	projects, err := s.Store.ListProjects()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]ProjectView, 0, len(projects))
	for _, p := range projects {
		out = append(out, projectView(p, meta.URL))
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		IsParent       bool   `json:"is_parent"`
		LookupEnabled  bool   `json:"lookup_enabled"`
		WorkspaceID    string `json:"workspace_id"`
		CustomerTeamID string `json:"customer_team_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name_required")
		return
	}
	id := req.ID
	if id == "" {
		tok, err := RandomToken(12)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		id = tok
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	p := Project{
		ID:             id,
		Name:           req.Name,
		IsParent:       req.IsParent,
		LookupEnabled:  req.LookupEnabled,
		WorkspaceID:    strings.TrimSpace(req.WorkspaceID),
		CustomerTeamID: strings.TrimSpace(req.CustomerTeamID),
		CreatedAt:      s.Now(),
	}
	if err := s.Store.CreateProject(p); err != nil {
		if errors.Is(err, ErrProjectExists) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, projectView(p, meta.URL))
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	p, err := s.Store.GetProject(id)
	if err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	users, err := s.Store.ListUsers(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	entries, err := s.Store.ListLookupEntries()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	apps, err := s.Store.ListApps(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	tuples, err := s.Store.ListTuples(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	teams, err := s.Store.ListTeams(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	groups, err := s.Store.ListGroups(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	interests, err := s.Store.ListInterestsForProject(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	uv := make([]UserView, 0, len(users))
	for _, u := range users {
		uv = append(uv, userView(u))
	}
	// Lookup table is per cell (per lookup zone host). Surface all entries; UI filters by relevance.
	lv := make([]LookupView, 0, len(entries))
	for _, e := range entries {
		lv = append(lv, lookupView(e))
	}
	av := make([]AppView, 0, len(apps))
	for _, a := range apps {
		av = append(av, appView(a))
	}
	tv := make([]TupleView, 0, len(tuples))
	for _, t := range tuples {
		tv = append(tv, tupleView(t))
	}
	tev := make([]TeamView, 0, len(teams))
	for _, t := range teams {
		tev = append(tev, teamView(t))
	}
	gv := make([]GroupView, 0, len(groups))
	for _, g := range groups {
		gv = append(gv, groupView(g))
	}
	iv := make([]InterestView, 0, len(interests))
	for _, i := range interests {
		iv = append(iv, interestView(i))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"project":   projectView(p, meta.URL),
		"users":     uv,
		"lookup":    lv,
		"apps":      av,
		"teams":     tev,
		"groups":    gv,
		"tuples":    tv,
		"interests": iv,
	})
}

func (s *Server) handleAttachProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		ParentProjectID string `json:"parent_project_id"`
		ParentCellURL   string `json:"parent_cell_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.ParentProjectID == "" || req.ParentCellURL == "" {
		writeErr(w, http.StatusBadRequest, "parent_project_id_and_parent_cell_url_required")
		return
	}
	parentURL, err := ValidateURL(req.ParentCellURL)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.Store.GetProject(id); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	parent, err := s.Peer.GetProject(r.Context(), parentURL, req.ParentProjectID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, ErrParentProjectMiss.Error()+": "+err.Error())
		return
	}
	if err := s.Store.AttachProject(id, parent.ID, parentURL); err != nil {
		if errors.Is(err, ErrProjectAttached) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	p, _ := s.Store.GetProject(id)
	meta, _ := s.Store.GetMeta()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"project": projectView(p, meta.URL),
		"parent":  parent,
	})
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Email                string `json:"email"`
		DeferFloat           bool   `json:"defer_float"`
		LifecycleOwnerTeamID string `json:"lifecycle_owner_team_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	key := NormalizeKey(req.Email)
	if key == "" {
		writeErr(w, http.StatusBadRequest, ErrLookupKeyRequired.Error())
		return
	}
	p, err := s.Store.GetProject(id)
	if err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	teamID := strings.TrimSpace(req.LifecycleOwnerTeamID)
	if teamID != "" {
		if _, err := s.Store.GetTeam(p.ID, teamID); err != nil {
			if errors.Is(err, ErrTeamNotFound) {
				writeErr(w, http.StatusBadRequest, "lifecycle_owner_team_not_in_project")
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	uid, err := RandomToken(12)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	now := s.Now()
	u := User{ID: uid, ProjectID: p.ID, Email: key, LifecycleOwnerTeamID: teamID, CreatedAt: now}
	if err := s.Store.CreateUser(u); err != nil {
		if errors.Is(err, ErrUserExists) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	start := time.Now()
	if err := s.Store.UpsertLookupLocal(key, p.ID, meta.URL, now); err != nil {
		if errors.Is(err, ErrLookupConflict) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	trace := []TraceHop{{
		Cell:   meta.URL,
		Method: "local lookup write",
		Ms:     time.Since(start).Milliseconds(),
		Result: "local",
	}}
	if !req.DeferFloat {
		hops, err := s.floatLookup(r.Context(), p, key, meta.URL)
		trace = append(trace, hops...)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error": err.Error(),
				"user":  userView(u),
				"trace": trace,
			})
			return
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":  userView(u),
		"trace": trace,
	})
}

func (s *Server) handleFloatUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	key := NormalizeKey(req.Key)
	if key == "" {
		writeErr(w, http.StatusBadRequest, ErrLookupKeyRequired.Error())
		return
	}
	p, err := s.Store.GetProject(id)
	if err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := s.Store.GetLookup(key); err != nil {
		if errors.Is(err, ErrLookupNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	trace, err := s.floatLookup(r.Context(), p, key, meta.URL)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "trace": trace})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "trace": trace})
}

// floatLookup pushes the row up PROJECT parents while the parent has lookup enabled.
// Lookup never walks children — only parent pointers.
func (s *Server) floatLookup(ctx context.Context, home Project, key, homeCellURL string) ([]TraceHop, error) {
	var trace []TraceHop
	cur := home
	for cur.ParentProjectID != "" && cur.ParentCellURL != "" {
		parentProj, err := s.Peer.GetProject(ctx, cur.ParentCellURL, cur.ParentProjectID)
		if err != nil {
			trace = append(trace, TraceHop{
				Cell: cur.ParentCellURL, Method: "GET /v1/projects/" + cur.ParentProjectID,
				Result: "error: " + err.Error(),
			})
			return trace, err
		}
		if !parentProj.LookupEnabled {
			trace = append(trace, TraceHop{
				Cell:   cur.ParentCellURL,
				Method: "float-stop",
				Result: "parent_lookup_disabled",
			})
			break
		}
		if d := s.floatDelay(); d > 0 {
			select {
			case <-ctx.Done():
				return trace, ctx.Err()
			case <-time.After(d):
			}
		}
		start := time.Now()
		err = s.Peer.PushLookup(ctx, cur.ParentCellURL, PushLookupRequest{
			Key:           key,
			HomeProjectID: home.ID,
			HomeCellURL:   homeCellURL,
			ProjectID:     parentProj.ID,
			ViaProject:    cur.ID, // immediate child that floated this hop
		})
		hop := TraceHop{
			Cell:   cur.ParentCellURL,
			Method: "POST /v1/lookup/push",
			Ms:     time.Since(start).Milliseconds(),
		}
		if err != nil {
			hop.Result = "error: " + err.Error()
			trace = append(trace, hop)
			return trace, err
		}
		hop.Result = "visible@" + parentProj.ID
		trace = append(trace, hop)

		// Continue from parent project (may live on another cell).
		next, err := s.Peer.GetProject(ctx, cur.ParentCellURL, cur.ParentProjectID)
		if err != nil {
			return trace, err
		}
		cur = Project{
			ID:              next.ID,
			Name:            next.Name,
			IsParent:        next.IsParent,
			LookupEnabled:   next.LookupEnabled,
			WorkspaceID:     next.WorkspaceID,
			CustomerTeamID:  next.CustomerTeamID,
			ParentProjectID: next.ParentProjectID,
			ParentCellURL:   next.ParentCellURL,
		}
	}
	_ = s.Store.MarkLookupPushed(key, s.Now())
	return trace, nil
}

func (s *Server) handleLookup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID string `json:"project_id"`
		Key       string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	key := NormalizeKey(req.Key)
	if req.ProjectID == "" || key == "" {
		writeErr(w, http.StatusBadRequest, "project_id_and_key_required")
		return
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := s.Store.GetProject(req.ProjectID); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	start := time.Now()
	entry, err := s.Store.GetLookup(key)
	hop := TraceHop{
		Cell:   meta.URL,
		Method: "POST /v1/lookup",
		Ms:     time.Since(start).Milliseconds(),
	}
	if errors.Is(err, ErrLookupNotFound) {
		hop.Result = "miss"
		writeJSON(w, http.StatusOK, map[string]any{
			"hit":   false,
			"trace": []TraceHop{hop},
		})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entry.State == LookupStateTombstone {
		hop.Result = "tombstone"
		writeJSON(w, http.StatusOK, map[string]any{
			"hit":             false,
			"tombstoned":      true,
			"home_project_id": entry.HomeProjectID,
			"home_cell_url":   entry.HomeCellURL,
			"state":           entry.State,
			"trace":           []TraceHop{hop},
		})
		return
	}
	hop.Result = "hit"
	lv := lookupView(entry)
	writeJSON(w, http.StatusOK, map[string]any{
		"hit":             true,
		"home_project_id": entry.HomeProjectID,
		"home_cell_url":   entry.HomeCellURL,
		"state":           entry.State,
		"source":          lv.Source,
		"via_project":     lv.ViaProject,
		"trace":           []TraceHop{hop},
	})
}

func (s *Server) handleLookupPush(w http.ResponseWriter, r *http.Request) {
	var req PushLookupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	key := NormalizeKey(req.Key)
	if key == "" || req.HomeProjectID == "" || req.HomeCellURL == "" {
		writeErr(w, http.StatusBadRequest, "key_home_project_id_home_cell_url_required")
		return
	}
	if req.ProjectID != "" {
		if _, err := s.Store.GetProject(req.ProjectID); err != nil {
			if errors.Is(err, ErrProjectNotFound) {
				writeErr(w, http.StatusNotFound, err.Error())
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	via := strings.TrimSpace(req.ViaProject)
	if via == "" {
		via = req.HomeProjectID
	}
	if err := s.Store.UpsertLookupVisible(key, req.HomeProjectID, req.HomeCellURL, via, s.Now()); err != nil {
		if errors.Is(err, ErrLookupConflict) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "source": LookupSourceChild, "via_project": via})
}

func (s *Server) handleLookupWalk(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID string `json:"project_id"`
		Key       string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	key := NormalizeKey(req.Key)
	if req.ProjectID == "" || key == "" {
		writeErr(w, http.StatusBadRequest, "project_id_and_key_required")
		return
	}
	result, trace, err := s.walkLookup(r.Context(), req.ProjectID, key)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, ErrProjectNotFound) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]any{"error": err.Error(), "trace": trace})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hit":             result.Hit,
		"tombstoned":      result.Tombstoned,
		"home_project_id": result.HomeProjectID,
		"home_cell_url":   result.HomeCellURL,
		"state":           result.State,
		"found_at":        result.FoundAtProjectID,
		"trace":           trace,
	})
}

// walkLookup resolves the key starting at projectID on this cell, then delegates
// up the parent site chain via POST /v1/lookup/walk (never fans out from the client).
func (s *Server) walkLookup(ctx context.Context, projectID, key string) (LookupResult, []TraceHop, error) {
	meta, err := s.Store.GetMeta()
	if err != nil {
		return LookupResult{}, nil, err
	}
	selfURL := NormalizeURL(meta.URL)
	proj, err := s.Store.GetProject(projectID)
	if err != nil {
		return LookupResult{}, nil, err
	}

	var trace []TraceHop
	start := time.Now()
	entry, err := s.Store.GetLookup(key)
	localMs := time.Since(start).Milliseconds()
	localHop := TraceHop{
		From:      selfURL,
		Cell:      selfURL,
		Method:    "local lookup",
		Ms:        localMs,
		ProjectID: projectID,
	}

	if errors.Is(err, ErrLookupNotFound) {
		localHop.Result = "miss"
		trace = append(trace, localHop)
		parentID := strings.TrimSpace(proj.ParentProjectID)
		parentCell := strings.TrimSpace(proj.ParentCellURL)
		if parentID == "" || parentCell == "" {
			return LookupResult{Hit: false}, trace, nil
		}
		parentCell = NormalizeURL(parentCell)
		hopStart := time.Now()
		parentCtx := WithFromCellURL(ctx, selfURL)
		parentRes, parentTrace, walkErr := s.Peer.LookupWalkRemote(parentCtx, parentCell, parentID, key)
		callMs := time.Since(hopStart).Milliseconds()
		callResult := "miss"
		if walkErr != nil {
			callResult = "error"
		} else if parentRes.Tombstoned {
			callResult = "tombstone"
		} else if parentRes.Hit {
			callResult = "hit"
		}
		trace = append(trace, TraceHop{
			From:      selfURL,
			Cell:      parentCell,
			Method:    "POST /v1/lookup/walk",
			Ms:        callMs,
			Result:    callResult,
			ProjectID: parentID,
		})
		trace = append(trace, parentTrace...)
		if walkErr != nil {
			return LookupResult{}, trace, walkErr
		}
		return parentRes, trace, nil
	}
	if err != nil {
		return LookupResult{}, trace, err
	}

	if entry.State == LookupStateTombstone {
		localHop.Result = "tombstone"
		trace = append(trace, localHop)
		return LookupResult{
			Hit: false, Tombstoned: true,
			HomeProjectID: entry.HomeProjectID, HomeCellURL: entry.HomeCellURL,
			State: entry.State, FoundAtProjectID: projectID,
		}, trace, nil
	}

	localHop.Result = "hit"
	trace = append(trace, localHop)
	return LookupResult{
		Hit: true, HomeProjectID: entry.HomeProjectID, HomeCellURL: entry.HomeCellURL,
		State: entry.State, FoundAtProjectID: projectID,
	}, trace, nil
}
