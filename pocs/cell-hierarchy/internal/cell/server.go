package cell

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Server struct {
	Store  *Store
	Peer   *PeerClient
	Now    func() time.Time
	Logger *log.Logger

	mu       sync.Mutex
	hbCancel context.CancelFunc
}

func NewServer(store *Store, peer *PeerClient, logger *log.Logger) *Server {
	if peer == nil {
		peer = NewPeerClient()
	}
	if logger == nil {
		logger = log.Default()
	}
	return &Server{
		Store:  store,
		Peer:   peer,
		Now:    time.Now,
		Logger: logger,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /v1/me", s.handleMe)
	mux.HandleFunc("GET /v1/children", s.handleChildren)
	mux.HandleFunc("POST /v1/join/prepare", s.handlePrepare)
	mux.HandleFunc("POST /v1/join/accept", s.handleAccept)
	mux.HandleFunc("POST /v1/join/complete", s.handleComplete)
	mux.HandleFunc("POST /v1/heartbeat", s.handleHeartbeat)
	mux.HandleFunc("DELETE /v1/children", s.handleDeleteChild)
	return mux
}

func (s *Server) StartHeartbeatLoop(ctx context.Context) {
	s.mu.Lock()
	if s.hbCancel != nil {
		s.hbCancel()
	}
	ctx, cancel := context.WithCancel(ctx)
	s.hbCancel = cancel
	s.mu.Unlock()

	go func() {
		t := time.NewTicker(HeartbeatInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.beatOnce(ctx)
			}
		}
	}()
}

func (s *Server) beatOnce(ctx context.Context) {
	meta, err := s.Store.GetMeta()
	if err != nil || meta.ParentURL == "" || meta.JoinSecret == "" {
		return
	}
	if err := s.Peer.Heartbeat(ctx, meta.ParentURL, meta.JoinSecret); err != nil {
		s.Logger.Printf("heartbeat to %s failed: %v", meta.ParentURL, err)
	}
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	status := "unjoined"
	switch {
	case meta.ParentURL != "":
		status = "joined"
	case meta.IsParent:
		status = "root"
	}
	writeJSON(w, http.StatusOK, MeResponse{
		URL:       meta.URL,
		Label:     meta.Label,
		IsParent:  meta.IsParent,
		ParentURL: meta.ParentURL,
		Status:    status,
	})
}

type childView struct {
	ChildURL   string `json:"child_url"`
	Label      string `json:"label,omitempty"`
	Alive      bool   `json:"alive"`
	LastSeenAt string `json:"last_seen_at"`
}

func (s *Server) handleChildren(w http.ResponseWriter, r *http.Request) {
	children, err := s.Store.ListChildren()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	now := s.Now()
	out := make([]childView, 0, len(children))
	for _, c := range children {
		label := ""
		if me, err := s.Peer.GetMe(r.Context(), c.ChildURL); err == nil {
			label = me.Label
		}
		out = append(out, childView{
			ChildURL:   c.ChildURL,
			Label:      label,
			Alive:      now.Sub(c.LastSeenAt) <= AliveWithin,
			LastSeenAt: c.LastSeenAt.UTC().Format(time.RFC3339Nano),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"children": out})
}

func (s *Server) handlePrepare(w http.ResponseWriter, r *http.Request) {
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !meta.IsParent {
		writeErr(w, http.StatusBadRequest, ErrNotParent.Error())
		return
	}
	token, err := RandomToken(24)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	exp := s.Now().Add(JoinTokenTTL)
	if err := s.Store.CreateJoinToken(token, exp); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, PrepareResponse{
		JoinToken: token,
		ParentURL: meta.URL,
		ExpiresAt: exp.UTC(),
	})
}

func (s *Server) handleAccept(w http.ResponseWriter, r *http.Request) {
	var req AcceptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.ParentURL == "" || req.JoinToken == "" {
		writeErr(w, http.StatusBadRequest, "parent_url_and_join_token_required")
		return
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if meta.ParentURL != "" {
		writeErr(w, http.StatusBadRequest, "already_joined")
		return
	}
	complete, err := s.Peer.Complete(r.Context(), req.ParentURL, CompleteRequest{
		ChildURL:  meta.URL,
		JoinToken: req.JoinToken,
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.Store.SetParent(complete.ParentURL, complete.JoinSecret); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.StartHeartbeatLoop(context.Background())
	_ = s.Peer.Heartbeat(r.Context(), complete.ParentURL, complete.JoinSecret)
	writeJSON(w, http.StatusOK, AcceptResponse{OK: true, ParentURL: complete.ParentURL})
}

func (s *Server) handleComplete(w http.ResponseWriter, r *http.Request) {
	var req CompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	meta, err := s.Store.GetMeta()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !meta.IsParent {
		writeErr(w, http.StatusBadRequest, ErrNotParent.Error())
		return
	}
	if err := s.Store.ConsumeJoinToken(req.JoinToken, s.Now()); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	childURL, err := ValidateURL(req.ChildURL)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if childURL == meta.URL {
		writeErr(w, http.StatusBadRequest, ErrJoinWouldCycle.Error())
		return
	}
	if err := s.detectCycle(r.Context(), childURL, meta.ParentURL); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	exists, err := s.Store.HasChild(childURL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if exists {
		writeErr(w, http.StatusBadRequest, ErrDuplicateChild.Error())
		return
	}
	secret, err := RandomToken(32)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.Store.InsertChild(childURL, HashSecret(secret), s.Now()); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, CompleteResponse{
		OK:         true,
		JoinSecret: secret,
		ParentURL:  meta.URL,
	})
}

func (s *Server) detectCycle(ctx context.Context, childURL, parentOfParent string) error {
	seen := map[string]bool{NormalizeURL(childURL): true}
	cur := NormalizeURL(parentOfParent)
	for cur != "" {
		if seen[cur] {
			return ErrJoinWouldCycle
		}
		seen[cur] = true
		me, err := s.Peer.GetMe(ctx, cur)
		if err != nil {
			return err
		}
		cur = NormalizeURL(me.ParentURL)
	}
	return nil
}

func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	secret := bearerToken(r.Header.Get("Authorization"))
	if secret == "" {
		writeErr(w, http.StatusUnauthorized, ErrUnauthorized.Error())
		return
	}
	child, err := s.Store.FindChildBySecretHash(HashSecret(secret))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, ErrUnauthorized.Error())
		return
	}
	if err := s.Store.TouchChild(child.ChildURL, s.Now()); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteChild(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ChildURL string `json:"child_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if err := s.Store.DeleteChild(req.ChildURL); err != nil {
		if errors.Is(err, ErrUnknownChild) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func bearerToken(h string) string {
	const p = "Bearer "
	if !strings.HasPrefix(h, p) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, p))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
