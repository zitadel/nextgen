package cell

import (
	"encoding/json"
	"net/http"
)

type DelayConfigRequest struct {
	Pairs  map[string]int    `json:"pairs"`
	Labels map[string]string `json:"labels"`
}

func (s *Server) handleAdminDelays(w http.ResponseWriter, r *http.Request) {
	var req DelayConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if req.Pairs == nil {
		req.Pairs = map[string]int{}
	}
	if req.Labels == nil {
		req.Labels = map[string]string{}
	}
	if s.Peer == nil {
		s.Peer = NewPeerClient()
	}
	s.Peer.SetDelayConfig(req.Pairs, req.Labels)
	if meta, err := s.Store.GetMeta(); err == nil && meta.URL != "" {
		s.Peer.SelfURL = NormalizeURL(meta.URL)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"pairs":  req.Pairs,
		"labels": req.Labels,
	})
}
