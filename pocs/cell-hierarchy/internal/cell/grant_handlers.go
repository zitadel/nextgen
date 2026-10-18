package cell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type AppView struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

type TupleView struct {
	ID            string `json:"id"`
	ProjectID     string `json:"project_id"`
	Object        string `json:"object"`
	Relation      string `json:"relation"`
	UserKey       string `json:"user_key"`
	HomeProjectID string `json:"home_project_id"`
	HomeCellURL   string `json:"home_cell_url"`
	Subject       string `json:"subject"`
	CreatedAt     string `json:"created_at"`
}

type InterestView struct {
	ID                  string `json:"id"`
	PrincipalKey        string `json:"principal_key"`
	HomeProjectID       string `json:"home_project_id"`
	SubscriberCellURL   string `json:"subscriber_cell_url"`
	SubscriberProjectID string `json:"subscriber_project_id"`
	TupleID             string `json:"tuple_id"`
	Object              string `json:"object"`
	Relation            string `json:"relation"`
	CreatedAt           string `json:"created_at"`
}

func appView(a App) AppView {
	return AppView{
		ID: a.ID, ProjectID: a.ProjectID, Name: a.Name,
		CreatedAt: a.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func tupleView(t Tuple) TupleView {
	return TupleView{
		ID: t.ID, ProjectID: t.ProjectID, Object: t.Object, Relation: t.Relation,
		UserKey: t.UserKey, HomeProjectID: t.HomeProjectID, HomeCellURL: t.HomeCellURL,
		Subject: t.Subject(), CreatedAt: t.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func interestView(i Interest) InterestView {
	return InterestView{
		ID: i.ID, PrincipalKey: i.PrincipalKey, HomeProjectID: i.HomeProjectID,
		SubscriberCellURL: i.SubscriberCellURL, SubscriberProjectID: i.SubscriberProjectID,
		TupleID: i.TupleID, Object: i.Object, Relation: i.Relation,
		CreatedAt: i.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (s *Server) registerGrantRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/projects/{id}/apps", s.handleListApps)
	mux.HandleFunc("POST /v1/projects/{id}/apps", s.handleCreateApp)
	mux.HandleFunc("GET /v1/projects/{id}/apps/{appId}", s.handleGetApp)
	mux.HandleFunc("DELETE /v1/projects/{id}/apps/{appId}", s.handleDeleteApp)
	mux.HandleFunc("GET /v1/projects/{id}/tuples", s.handleListTuples)
	mux.HandleFunc("POST /v1/projects/{id}/tuples", s.handleCreateTuple)
	mux.HandleFunc("GET /v1/interests", s.handleListInterests)
	mux.HandleFunc("POST /v1/interests", s.handleRegisterInterest)
}

func (s *Server) handleListApps(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.GetProject(id); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	apps, err := s.Store.ListApps(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]AppView, 0, len(apps))
	for _, a := range apps {
		out = append(out, appView(a))
	}
	writeJSON(w, http.StatusOK, map[string]any{"apps": out})
}

func (s *Server) handleCreateApp(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
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
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeErr(w, http.StatusBadRequest, ErrInvalidAppName.Error())
		return
	}
	appID := strings.TrimSpace(req.ID)
	if appID == "" {
		tok, err := RandomToken(12)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		appID = tok
	}
	a := App{ID: appID, ProjectID: id, Name: name, CreatedAt: s.Now()}
	if err := s.Store.CreateApp(a); err != nil {
		if errors.Is(err, ErrAppExists) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, appView(a))
}

func (s *Server) handleGetApp(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	appID := r.PathValue("appId")
	a, err := s.Store.GetApp(projectID, appID)
	if err != nil {
		if errors.Is(err, ErrAppNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, appView(a))
}

func (s *Server) handleDeleteApp(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	appID := r.PathValue("appId")
	if err := s.Store.DeleteApp(projectID, appID); err != nil {
		if errors.Is(err, ErrAppNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListTuples(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.GetProject(id); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	tuples, err := s.Store.ListTuples(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]TupleView, 0, len(tuples))
	for _, t := range tuples {
		out = append(out, tupleView(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{"tuples": out})
}

// handleCreateTuple creates a grant on the resource project.
// Subject is resolved via lookup walk UP from this project; after the tuple
// lands, RegisterInterest is POSTed to the principal's home cell.
func (s *Server) handleCreateTuple(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Object   string `json:"object"`
		Relation string `json:"relation"`
		UserKey  string `json:"user_key"`
		// Optional: skip peer interest registration (tests / already-known subject).
		SkipInterest bool   `json:"skip_interest"`
		HomeProject  string `json:"home_project_id"`
		HomeCellURL  string `json:"home_cell_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	key := NormalizeKey(req.UserKey)
	object := strings.TrimSpace(req.Object)
	relation := strings.TrimSpace(req.Relation)
	if key == "" || object == "" || relation == "" {
		writeErr(w, http.StatusBadRequest, "object_relation_user_key_required")
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

	var trace []TraceHop
	homeProjectID := strings.TrimSpace(req.HomeProject)
	homeCellURL := NormalizeURL(req.HomeCellURL)

	if homeProjectID == "" || homeCellURL == "" {
		start := time.Now()
		result, hops, walkErr := s.Peer.LookupWalk(r.Context(), meta.URL, p.ID, key)
		trace = append(trace, hops...)
		if walkErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": walkErr.Error(), "trace": trace})
			return
		}
		if !result.Hit {
			trace = append(trace, TraceHop{
				Cell: meta.URL, Method: "POST /v1/lookup/walk",
				Ms: time.Since(start).Milliseconds(), Result: "principal_not_found",
			})
			writeJSON(w, http.StatusNotFound, map[string]any{
				"error": ErrPrincipalNotFound.Error(),
				"trace": trace,
			})
			return
		}
		homeProjectID = result.HomeProjectID
		homeCellURL = NormalizeURL(result.HomeCellURL)
		trace = append(trace, TraceHop{
			Cell: meta.URL, Method: "resolve subject",
			Ms:     time.Since(start).Milliseconds(),
			Result: fmt.Sprintf("home=%s@%s", homeProjectID, homeCellURL),
		})
	}

	tid, err := RandomToken(12)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	now := s.Now()
	t := Tuple{
		ID: tid, ProjectID: p.ID, Object: object, Relation: relation,
		UserKey: key, HomeProjectID: homeProjectID, HomeCellURL: homeCellURL,
		CreatedAt: now,
	}
	start := time.Now()
	if err := s.Store.CreateTuple(t); err != nil {
		if errors.Is(err, ErrTupleExists) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	trace = append(trace, TraceHop{
		Cell: meta.URL, Method: "local tuple write",
		Ms: time.Since(start).Milliseconds(), Result: "created@" + p.ID,
	})

	if !req.SkipInterest {
		hopStart := time.Now()
		err := s.Peer.RegisterInterest(r.Context(), homeCellURL, RegisterInterestRequest{
			PrincipalKey:        key,
			HomeProjectID:       homeProjectID,
			SubscriberCellURL:   meta.URL,
			SubscriberProjectID: p.ID,
			TupleID:             t.ID,
			Object:              object,
			Relation:            relation,
		})
		hop := TraceHop{
			Cell:   homeCellURL,
			Method: "POST /v1/interests",
			Ms:     time.Since(hopStart).Milliseconds(),
		}
		if err != nil {
			hop.Result = "error: " + err.Error()
			trace = append(trace, hop)
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"error": "interest_register_failed: " + err.Error(),
				"tuple": tupleView(t),
				"trace": trace,
			})
			return
		}
		hop.Result = "registered"
		trace = append(trace, hop)
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"tuple": tupleView(t),
		"trace": trace,
	})
}

func (s *Server) handleListInterests(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("home_project_id")
	var interests []Interest
	var err error
	if projectID != "" {
		interests, err = s.Store.ListInterestsForProject(projectID)
	} else {
		interests, err = s.Store.ListInterests()
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]InterestView, 0, len(interests))
	for _, i := range interests {
		out = append(out, interestView(i))
	}
	writeJSON(w, http.StatusOK, map[string]any{"interests": out})
}

func (s *Server) handleRegisterInterest(w http.ResponseWriter, r *http.Request) {
	var req RegisterInterestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	key := NormalizeKey(req.PrincipalKey)
	if key == "" || req.HomeProjectID == "" || req.SubscriberCellURL == "" || req.SubscriberProjectID == "" || req.TupleID == "" {
		writeErr(w, http.StatusBadRequest, "principal_home_subscriber_tuple_required")
		return
	}
	iid, err := RandomToken(12)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	i := Interest{
		ID:                  iid,
		PrincipalKey:        key,
		HomeProjectID:       req.HomeProjectID,
		SubscriberCellURL:   req.SubscriberCellURL,
		SubscriberProjectID: req.SubscriberProjectID,
		TupleID:             req.TupleID,
		Object:              req.Object,
		Relation:            req.Relation,
		CreatedAt:           s.Now(),
	}
	if err := s.Store.CreateInterest(i); err != nil {
		if errors.Is(err, ErrInterestExists) {
			// Idempotent re-register: treat as success for the POC.
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "duplicate": true})
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, interestView(i))
}

// EnsureApp seeds an app by name if missing (bootstrap helper).
func (s *Server) EnsureApp(ctx context.Context, projectID, name string) (App, error) {
	_ = ctx
	existing, err := s.Store.GetAppByName(projectID, name)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, ErrAppNotFound) {
		return App{}, err
	}
	id, err := RandomToken(12)
	if err != nil {
		return App{}, err
	}
	a := App{ID: id, ProjectID: projectID, Name: name, CreatedAt: s.Now()}
	if err := s.Store.CreateApp(a); err != nil {
		return App{}, err
	}
	return a, nil
}
