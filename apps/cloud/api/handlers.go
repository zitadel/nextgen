package main

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// server is the HTTP surface, mounted at /cloud with the prefix stripped:
//
//	GET  /readyz        the service and its database
//	GET  /regions       the directory, public
//	GET  /me/projects   the signed-in person's placements, newest first
//	POST /projects      {name, region}: create and claim a project in a region
type server struct {
	store   store
	home    *homeClient
	regions *regionClient
	logger  *slog.Logger
	mux     *http.ServeMux
}

func newServer(store store, home *homeClient, regions *regionClient, logger *slog.Logger) *server {
	s := &server{store: store, home: home, regions: regions, logger: logger, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /readyz", s.readyz)
	s.mux.HandleFunc("GET /regions", s.listRegions)
	s.mux.HandleFunc("GET /me/projects", s.listMyProjects)
	s.mux.HandleFunc("POST /projects", s.createProject)
	return s
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// projectItem is a project as this service answers it: where it lives, and
// the team the claim handed it to there.
type projectItem struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Region    region    `json:"region"`
	TeamID    string    `json:"team_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *server) readyz(w http.ResponseWriter, r *http.Request) {
	if err := s.store.ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "cloud.unavailable", "the database is not reachable")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "ok")
}

func (s *server) listRegions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"regions": s.regions.regions})
}

func (s *server) listMyProjects(w http.ResponseWriter, r *http.Request) {
	who, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	placements, err := s.store.listByUser(r.Context(), who.UserID)
	if err != nil {
		s.logger.ErrorContext(r.Context(), "cloud api: list placements", "err", err)
		writeError(w, http.StatusInternalServerError, "cloud.internal", "could not list the projects")
		return
	}
	items := make([]projectItem, 0, len(placements))
	for _, p := range placements {
		items = append(items, s.item(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": items})
}

func (s *server) createProject(w http.ResponseWriter, r *http.Request) {
	who, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var body struct {
		Name   string `json:"name"`
		Region string `json:"region"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, bodyLimit)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "cloud.invalid", "the body must be JSON with name and region")
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" || len(body.Name) > 200 {
		writeError(w, http.StatusBadRequest, "cloud.invalid", "name must be 1 to 200 characters")
		return
	}
	target, found := s.regions.find(body.Region)
	if !found {
		writeError(w, http.StatusBadRequest, "cloud.region_unknown", "region must be one of the directory's")
		return
	}
	cookie, _ := r.Cookie(sessionCookie)
	created, err := s.regions.createProject(r.Context(), target, body.Name, cookie.Value)
	if err != nil {
		var refusal *regionError
		if errors.As(err, &refusal) && refusal.Status == http.StatusUnauthorized {
			writeError(w, http.StatusUnauthorized, "cloud.unauthorized", "the region does not accept this session")
			return
		}
		s.logger.ErrorContext(r.Context(), "cloud api: create project in region", "region", target.ID, "err", err)
		writeError(w, http.StatusBadGateway, "cloud.region_failed", "the region could not create the project: "+err.Error())
		return
	}
	p := placement{ProjectID: created.ID, RegionID: target.ID, UserID: who.UserID, TeamID: created.TeamID, Name: created.Name, CreatedAt: created.CreatedAt}
	if p.CreatedAt.IsZero() {
		p.CreatedAt = time.Now().UTC()
	}
	if err := s.store.insert(r.Context(), p); err != nil {
		// The project exists and is claimed; only this record is missing.
		s.logger.ErrorContext(r.Context(), "cloud api: record placement", "project", p.ProjectID, "err", err)
		writeError(w, http.StatusInternalServerError, "cloud.internal", "the project was created in "+target.Name+" but could not be recorded")
		return
	}
	writeJSON(w, http.StatusCreated, s.item(p))
}

func (s *server) item(p placement) projectItem {
	target, _ := s.regions.find(p.RegionID)
	if target.ID == "" {
		target = region{ID: p.RegionID, Name: p.RegionID}
	}
	return projectItem{ID: p.ProjectID, Name: p.Name, Region: target, TeamID: p.TeamID, CreatedAt: p.CreatedAt}
}

// authenticate resolves the session cookie with the home; a missing or
// refused cookie is answered as 401 and reported false.
func (s *server) authenticate(w http.ResponseWriter, r *http.Request) (principal, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "cloud.unauthorized", "sign in at the home first")
		return principal{}, false
	}
	who, err := s.home.resolve(r.Context(), cookie.Value)
	if err != nil {
		if errors.Is(err, errUnauthenticated) {
			writeError(w, http.StatusUnauthorized, "cloud.unauthorized", "the home does not accept this session")
			return principal{}, false
		}
		s.logger.ErrorContext(r.Context(), "cloud api: ask the home", "err", err)
		writeError(w, http.StatusBadGateway, "cloud.home_unavailable", "the home could not be asked about this session")
		return principal{}, false
	}
	return who, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "message": message})
}
