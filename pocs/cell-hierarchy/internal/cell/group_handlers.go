package cell

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type GroupView struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

func groupView(g Group) GroupView {
	return GroupView{
		ID: g.ID, ProjectID: g.ProjectID, Name: g.Name,
		CreatedAt: g.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (s *Server) registerGroupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/projects/{id}/groups", s.handleListGroups)
	mux.HandleFunc("POST /v1/projects/{id}/groups", s.handleCreateGroup)
	mux.HandleFunc("DELETE /v1/projects/{id}/groups/{groupId}", s.handleDeleteGroup)
}

func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.GetProject(id); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	groups, err := s.Store.ListGroups(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]GroupView, 0, len(groups))
	for _, g := range groups {
		out = append(out, groupView(g))
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": out})
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
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
		writeErr(w, http.StatusBadRequest, ErrInvalidGroupName.Error())
		return
	}
	groupID := strings.TrimSpace(req.ID)
	if groupID == "" {
		tok, err := RandomToken(12)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		groupID = tok
	}
	g := Group{ID: groupID, ProjectID: id, Name: name, CreatedAt: s.Now()}
	if err := s.Store.CreateGroup(g); err != nil {
		if errors.Is(err, ErrGroupExists) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, groupView(g))
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	groupID := r.PathValue("groupId")
	if err := s.Store.DeleteGroup(projectID, groupID); err != nil {
		switch {
		case errors.Is(err, ErrGroupNotFound):
			writeErr(w, http.StatusNotFound, err.Error())
		case errors.Is(err, ErrGroupHasTuples):
			writeErr(w, http.StatusConflict, err.Error())
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
