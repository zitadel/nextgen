package cell

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"time"
)

type TraceHop struct {
	Cell   string `json:"cell"`
	Method string `json:"method"`
	Ms     int64  `json:"ms"`
	Result string `json:"result"`
}

type ProjectView struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	IsParent        bool   `json:"is_parent"`
	LookupEnabled   bool   `json:"lookup_enabled"`
	ParentProjectID string `json:"parent_project_id"`
	ParentCellURL   string `json:"parent_cell_url"`
	HostCellURL     string `json:"host_cell_url"`
	CreatedAt       string `json:"created_at"`
}

type UserView struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at"`
}

type LookupView struct {
	Key           string `json:"key"`
	HomeProjectID string `json:"home_project_id"`
	HomeCellURL   string `json:"home_cell_url"`
	State         string `json:"state"`
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
		ParentProjectID: p.ParentProjectID,
		ParentCellURL:   p.ParentCellURL,
		HostCellURL:     host,
		CreatedAt:       p.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func lookupView(e LookupEntry) LookupView {
	return LookupView{
		Key:           e.Key,
		HomeProjectID: e.HomeProjectID,
		HomeCellURL:   e.HomeCellURL,
		State:         e.State,
		UpdatedAt:     e.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
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
		ID            string `json:"id"`
		Name          string `json:"name"`
		IsParent      bool   `json:"is_parent"`
		LookupEnabled bool   `json:"lookup_enabled"`
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
		ID:            id,
		Name:          req.Name,
		IsParent:      req.IsParent,
		LookupEnabled: req.LookupEnabled,
		CreatedAt:     s.Now(),
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
	interests, err := s.Store.ListInterestsForProject(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	uv := make([]UserView, 0, len(users))
	for _, u := range users {
		uv = append(uv, UserView{
			ID:        u.ID,
			ProjectID: u.ProjectID,
			Email:     u.Email,
			CreatedAt: u.CreatedAt.UTC().Format(time.RFC3339Nano),
		})
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
	iv := make([]InterestView, 0, len(interests))
	for _, i := range interests {
		iv = append(iv, interestView(i))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"project":   projectView(p, meta.URL),
		"users":     uv,
		"lookup":    lv,
		"apps":      av,
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
		Email      string `json:"email"`
		DeferFloat bool   `json:"defer_float"`
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
	u := User{ID: uid, ProjectID: p.ID, Email: key, CreatedAt: now}
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
				"user": UserView{
					ID: u.ID, ProjectID: u.ProjectID, Email: u.Email,
					CreatedAt: u.CreatedAt.UTC().Format(time.RFC3339Nano),
				},
				"trace": trace,
			})
			return
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user": UserView{
			ID: u.ID, ProjectID: u.ProjectID, Email: u.Email,
			CreatedAt: u.CreatedAt.UTC().Format(time.RFC3339Nano),
		},
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
	hop.Result = "hit"
	writeJSON(w, http.StatusOK, map[string]any{
		"hit":             true,
		"home_project_id": entry.HomeProjectID,
		"home_cell_url":   entry.HomeCellURL,
		"state":           entry.State,
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
	if err := s.Store.UpsertLookupVisible(key, req.HomeProjectID, req.HomeCellURL, s.Now()); err != nil {
		if errors.Is(err, ErrLookupConflict) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	result, trace, err := s.Peer.LookupWalk(r.Context(), meta.URL, req.ProjectID, key)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error(), "trace": trace})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hit":             result.Hit,
		"home_project_id": result.HomeProjectID,
		"home_cell_url":   result.HomeCellURL,
		"found_at":        result.FoundAtProjectID,
		"trace":           trace,
	})
}
