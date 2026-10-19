package cell

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type LifecycleEventRequest struct {
	Type                string `json:"type"` // user.blocked | user.deleted
	PrincipalKey        string `json:"principal_key"`
	HomeProjectID       string `json:"home_project_id"`
	HomeCellURL         string `json:"home_cell_url"`
	SubscriberProjectID string `json:"subscriber_project_id,omitempty"`
	TupleID             string `json:"tuple_id,omitempty"`
	Object              string `json:"object,omitempty"`
	Relation            string `json:"relation,omitempty"`
	Epoch               int    `json:"epoch,omitempty"`
}

type LifecycleEventResponse struct {
	OK               bool   `json:"ok"`
	Type             string `json:"type"`
	TuplesRemoved    int64  `json:"tuples_removed,omitempty"` // tombstoned count (compat name)
	TuplesTombstoned int64  `json:"tuples_tombstoned,omitempty"`
	Denylist         bool   `json:"denylist,omitempty"`
}

type BlockUserResponse struct {
	User  UserView   `json:"user"`
	Trace []TraceHop `json:"trace"`
}

type DeleteUserResponse struct {
	User  UserView   `json:"user"`
	Trace []TraceHop `json:"trace"`
}

func (s *Server) registerLifecycleRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/projects/{id}/users/{key}/block", s.handleBlockUser)
	mux.HandleFunc("POST /v1/projects/{id}/users/{key}/delete", s.handleDeleteUser)
	mux.HandleFunc("POST /v1/users/{project}/{key}/block", s.handleBlockUserAlt)
	mux.HandleFunc("POST /v1/users/{project}/{key}/delete", s.handleDeleteUserAlt)
	mux.HandleFunc("POST /v1/events/user", s.handleLifecycleEvent)
	mux.HandleFunc("POST /v1/lifecycle/push", s.handleLifecycleEvent)
	mux.HandleFunc("POST /v1/lookup/tombstone", s.handleLookupTombstone)
}

func (s *Server) handleBlockUserAlt(w http.ResponseWriter, r *http.Request) {
	r.SetPathValue("id", r.PathValue("project"))
	s.handleBlockUser(w, r)
}

func (s *Server) handleDeleteUserAlt(w http.ResponseWriter, r *http.Request) {
	r.SetPathValue("id", r.PathValue("project"))
	s.handleDeleteUser(w, r)
}

func (s *Server) handleBlockUser(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	key := NormalizeKey(r.PathValue("key"))
	if projectID == "" || key == "" {
		writeErr(w, http.StatusBadRequest, "project_id_and_key_required")
		return
	}
	if _, err := s.Store.GetProject(projectID); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	u, err := s.Store.BlockUser(projectID, key)
	if err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			writeErr(w, http.StatusNotFound, err.Error())
		case errors.Is(err, ErrUserDeleted):
			writeErr(w, http.StatusConflict, err.Error())
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	interests, err := s.Store.ListInterestsForPrincipal(projectID, key)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	trace := s.fanOutLifecycle(r.Context(), meta.URL, LifecycleEventRequest{
		Type:          EventUserBlocked,
		PrincipalKey:  key,
		HomeProjectID: projectID,
		HomeCellURL:   meta.URL,
		Epoch:         u.Epoch,
	}, interests)
	writeJSON(w, http.StatusOK, BlockUserResponse{User: userView(u), Trace: trace})
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	key := NormalizeKey(r.PathValue("key"))
	if projectID == "" || key == "" {
		writeErr(w, http.StatusBadRequest, "project_id_and_key_required")
		return
	}
	p, err := s.Store.GetProject(projectID)
	if err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	now := s.Now()
	u, err := s.Store.DeleteUser(projectID, key, now)
	if err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			writeErr(w, http.StatusNotFound, err.Error())
		case errors.Is(err, ErrAlreadyGone):
			writeErr(w, http.StatusConflict, err.Error())
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	var trace []TraceHop
	// Tombstone local user-subject tuples (e.g. group:A#member@joe) so expand ignores them.
	start := time.Now()
	nLocal, err := s.Store.TombstoneLocalUserTuples(key, now)
	trace = append(trace, TraceHop{
		Cell: meta.URL, Method: "local tuple cleanup",
		Ms: time.Since(start).Milliseconds(),
		Result: func() string {
			if err != nil {
				return "error: " + err.Error()
			}
			return "tombstoned=" + itoa64(nLocal)
		}(),
	})

	interests, err := s.Store.ListInterestsForPrincipal(projectID, key)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	pushTrace := s.fanOutLifecycle(r.Context(), meta.URL, LifecycleEventRequest{
		Type:          EventUserDeleted,
		PrincipalKey:  key,
		HomeProjectID: projectID,
		HomeCellURL:   meta.URL,
		Epoch:         u.Epoch,
	}, interests)
	trace = append(trace, pushTrace...)

	// Tombstone local lookup + float tombstone up ancestors.
	_ = s.Store.UpsertLookupTombstone(key, projectID, meta.URL, now)
	tombTrace, _ := s.floatLookupTombstone(r.Context(), p, key, meta.URL)
	trace = append(trace, tombTrace...)

	start = time.Now()
	nInt, err := s.Store.DeleteInterestsForPrincipal(projectID, key)
	trace = append(trace, TraceHop{
		Cell: meta.URL, Method: "unregister interests",
		Ms: time.Since(start).Milliseconds(),
		Result: func() string {
			if err != nil {
				return "error: " + err.Error()
			}
			return "removed=" + itoa64(nInt)
		}(),
	})

	writeJSON(w, http.StatusOK, DeleteUserResponse{User: userView(u), Trace: trace})
}

func (s *Server) fanOutLifecycle(ctx context.Context, homeCell string, base LifecycleEventRequest, interests []Interest) []TraceHop {
	var trace []TraceHop
	seen := map[string]bool{}
	for _, i := range interests {
		subURL := NormalizeURL(i.SubscriberCellURL)
		// Dedupe by subscriber cell + project so we still pass tuple_id when useful.
		dedupe := subURL + "|" + i.SubscriberProjectID + "|" + i.TupleID
		if seen[dedupe] {
			continue
		}
		seen[dedupe] = true
		req := base
		req.SubscriberProjectID = i.SubscriberProjectID
		req.TupleID = i.TupleID
		req.Object = i.Object
		req.Relation = i.Relation
		start := time.Now()
		err := s.Peer.PushLifecycleEvent(ctx, subURL, req)
		hop := TraceHop{
			Cell:   subURL,
			Method: "POST /v1/events/user",
			Ms:     time.Since(start).Milliseconds(),
		}
		if err != nil {
			// Fail-closed for online delivery: event did not land (home/subscriber down).
			hop.Result = "error: " + err.Error()
		} else {
			hop.Result = base.Type + "@" + i.SubscriberProjectID
		}
		trace = append(trace, hop)
	}
	if len(interests) == 0 {
		trace = append(trace, TraceHop{
			Cell: homeCell, Method: "interest fan-out", Result: "no_subscribers",
		})
	}
	return trace
}

func (s *Server) handleLifecycleEvent(w http.ResponseWriter, r *http.Request) {
	var req LifecycleEventRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	key := NormalizeKey(req.PrincipalKey)
	if key == "" || req.Type == "" {
		writeErr(w, http.StatusBadRequest, "type_and_principal_key_required")
		return
	}
	switch req.Type {
	case EventUserBlocked:
		until := s.Now().Add(DenylistTTL)
		projectID := strings.TrimSpace(req.SubscriberProjectID)
		if projectID == "" {
			// Apply to all local projects that have grants for this principal.
			projects, err := s.Store.ListProjects()
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			for _, p := range projects {
				s.denylist.Put(p.ID, key, until)
			}
		} else {
			s.denylist.Put(projectID, key, until)
		}
		writeJSON(w, http.StatusOK, LifecycleEventResponse{OK: true, Type: req.Type, Denylist: true})
	case EventUserDeleted:
		var tombstoned int64
		now := s.Now()
		projectID := strings.TrimSpace(req.SubscriberProjectID)
		if req.TupleID != "" {
			err := s.Store.TombstoneTupleByID(req.TupleID, now)
			if err != nil && !errors.Is(err, ErrTupleNotFound) {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			if err == nil {
				tombstoned = 1
			}
		}
		// Also sweep any remaining active user-subject grants for this principal on the
		// subscriber project (or all local projects if unspecified).
		if projectID != "" {
			n, err := s.Store.TombstoneTuplesForPrincipal(projectID, key, now)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			tombstoned += n
		} else if req.TupleID == "" {
			n, err := s.Store.TombstoneLocalUserTuples(key, now)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			tombstoned += n
		}
		s.denylist.Clear(projectID, key)
		writeJSON(w, http.StatusOK, LifecycleEventResponse{
			OK: true, Type: req.Type, TuplesRemoved: tombstoned, TuplesTombstoned: tombstoned,
		})
	default:
		writeErr(w, http.StatusBadRequest, ErrEventUnknown.Error())
	}
}

func (s *Server) handleLookupTombstone(w http.ResponseWriter, r *http.Request) {
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
	if err := s.Store.UpsertLookupTombstone(key, req.HomeProjectID, req.HomeCellURL, s.Now()); err != nil {
		if errors.Is(err, ErrLookupConflict) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": LookupStateTombstone})
}

// floatLookupTombstone pushes a tombstone row up PROJECT parents (same path as float).
func (s *Server) floatLookupTombstone(ctx context.Context, home Project, key, homeCellURL string) ([]TraceHop, error) {
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
				Cell: cur.ParentCellURL, Method: "tombstone-stop", Result: "parent_lookup_disabled",
			})
			break
		}
		start := time.Now()
		err = s.Peer.PushLookupTombstone(ctx, cur.ParentCellURL, PushLookupRequest{
			Key:           key,
			HomeProjectID: home.ID,
			HomeCellURL:   homeCellURL,
			ProjectID:     parentProj.ID,
		})
		hop := TraceHop{
			Cell: cur.ParentCellURL, Method: "POST /v1/lookup/tombstone",
			Ms: time.Since(start).Milliseconds(),
		}
		if err != nil {
			hop.Result = "error: " + err.Error()
			trace = append(trace, hop)
			return trace, err
		}
		hop.Result = "tombstone@" + parentProj.ID
		trace = append(trace, hop)
		next, err := s.Peer.GetProject(ctx, cur.ParentCellURL, cur.ParentProjectID)
		if err != nil {
			return trace, err
		}
		cur = Project{
			ID: next.ID, Name: next.Name, IsParent: next.IsParent, LookupEnabled: next.LookupEnabled,
			ParentProjectID: next.ParentProjectID, ParentCellURL: next.ParentCellURL,
		}
	}
	return trace, nil
}

func itoa64(n int64) string {
	return strconv.FormatInt(n, 10)
}
