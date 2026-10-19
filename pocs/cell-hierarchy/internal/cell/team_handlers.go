package cell

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type TeamView struct {
	ID           string `json:"id"`
	ProjectID    string `json:"project_id"`
	Name         string `json:"name"`
	ParentTeamID string `json:"parent_team_id,omitempty"`
	CreatedAt    string `json:"created_at"`
}

func teamView(t Team) TeamView {
	return TeamView{
		ID: t.ID, ProjectID: t.ProjectID, Name: t.Name,
		ParentTeamID: t.ParentTeamID,
		CreatedAt:    t.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (s *Server) registerTeamRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/projects/{id}/teams", s.handleListTeams)
	mux.HandleFunc("POST /v1/projects/{id}/teams", s.handleCreateTeam)
}

func (s *Server) handleListTeams(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.GetProject(id); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	teams, err := s.Store.ListTeams(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]TeamView, 0, len(teams))
	for _, t := range teams {
		out = append(out, teamView(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{"teams": out})
}

func (s *Server) handleCreateTeam(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		ParentTeamID string `json:"parent_team_id"`
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
		writeErr(w, http.StatusBadRequest, ErrInvalidTeamName.Error())
		return
	}
	teamID := strings.TrimSpace(req.ID)
	if teamID == "" {
		tok, err := RandomToken(12)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		teamID = tok
	}
	t := Team{
		ID: teamID, ProjectID: id, Name: name,
		ParentTeamID: strings.TrimSpace(req.ParentTeamID),
		CreatedAt:    s.Now(),
	}
	if err := s.Store.CreateTeam(t); err != nil {
		switch {
		case errors.Is(err, ErrTeamExists):
			writeErr(w, http.StatusConflict, err.Error())
		case errors.Is(err, ErrParentTeamMiss), errors.Is(err, ErrParentTeamProject):
			writeErr(w, http.StatusBadRequest, err.Error())
		default:
			writeErr(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusCreated, teamView(t))
}
