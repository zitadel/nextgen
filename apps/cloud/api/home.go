package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

// errUnauthenticated is the home's verdict on a cookie it does not accept.
var errUnauthenticated = errors.New("the home does not accept this session")

// principal is who a session cookie belongs to, as the home reports it.
type principal struct {
	UserID    string
	SessionID string
	ExpiresAt time.Time
}

type homeEntry struct {
	principal principal
	until     time.Time
}

// homeClient asks the identity home who a session cookie belongs to, the way
// a region does (internal/api/homesession.go), and caches the answer for ttl
// or until the session expires, whichever is first.
type homeClient struct {
	base    string
	headers map[string]string
	client  *http.Client
	ttl     time.Duration
	now     func() time.Time

	mu    sync.Mutex
	cache map[[32]byte]homeEntry
}

func newHomeClient(base string, headers map[string]string, ttl time.Duration) *homeClient {
	return &homeClient{
		base:    base,
		headers: headers,
		client:  &http.Client{Timeout: 5 * time.Second},
		ttl:     ttl,
		now:     time.Now,
		cache:   map[[32]byte]homeEntry{},
	}
}

func (h *homeClient) resolve(ctx context.Context, cookie string) (principal, error) {
	key := sha256.Sum256([]byte(cookie))
	now := h.now()
	h.mu.Lock()
	entry, ok := h.cache[key]
	h.mu.Unlock()
	if ok && now.Before(entry.until) {
		return entry.principal, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.base+"/sessions/me", nil)
	if err != nil {
		return principal{}, err
	}
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: cookie})
	req.Header.Set("Accept", "application/json")
	for name, value := range h.headers {
		req.Header.Set(name, value)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return principal{}, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, bodyLimit))
	if err != nil {
		return principal{}, err
	}
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusUnauthorized:
		return principal{}, errUnauthenticated
	default:
		return principal{}, errors.New("the home answered " + resp.Status)
	}
	var session struct {
		SessionID string    `json:"session_id"`
		State     string    `json:"state"`
		UserID    string    `json:"user_id"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.Unmarshal(data, &session); err != nil {
		return principal{}, errors.New("the home answered something that is not a session")
	}
	if session.State != "active" || session.UserID == "" || session.SessionID == "" {
		return principal{}, errUnauthenticated
	}
	if !session.ExpiresAt.IsZero() && !now.Before(session.ExpiresAt) {
		return principal{}, errUnauthenticated
	}
	p := principal{UserID: session.UserID, SessionID: session.SessionID, ExpiresAt: session.ExpiresAt}
	until := now.Add(h.ttl)
	if !p.ExpiresAt.IsZero() && p.ExpiresAt.Before(until) {
		until = p.ExpiresAt
	}
	h.mu.Lock()
	h.cache[key] = homeEntry{principal: p, until: until}
	h.mu.Unlock()
	return p, nil
}
