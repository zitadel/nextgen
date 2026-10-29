package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

// errUnknownClient is a client_id that names no client: not the app's own,
// not a metadata document this server may fetch, not a registration it
// sealed. An authorization request for it never redirects (ADR 081 §8).
var errUnknownClient = errors.New("oauth: unknown client")

// resolveClient finds the client a client_id names.
func (s *Server) resolveClient(ctx context.Context, clientID string) (Client, error) {
	if client, ok := s.app.client(clientID); ok {
		return client, nil
	}
	if strings.HasPrefix(clientID, "https://") {
		if !s.app.Registration.ClientIDMetadataDocuments {
			return Client{}, errUnknownClient
		}
		return s.documents.client(ctx, clientID)
	}
	if !s.app.Registration.Dynamic {
		return Client{}, errUnknownClient
	}
	var reg registration
	if err := s.unseal(ctx, kindClient, clientID, &reg); err != nil {
		if errors.Is(err, errSealed) {
			return Client{}, errUnknownClient
		}
		return Client{}, err
	}
	return Client{
		ID:           clientID,
		Name:         reg.ClientName,
		Source:       SourceRegistered,
		RedirectURIs: reg.RedirectURIs,
	}, nil
}

// registration is what a dynamically registered client's client_id seals: no
// table holds it, so the client_id is the registration (RFC 7591 lets the
// server choose the id). Revoking one client means rotating the key; a
// user's consent and refresh tokens are revoked per grant.
type registration struct {
	ClientName   string   `json:"client_name,omitempty"`
	RedirectURIs []string `json:"redirect_uris"`
	IssuedAt     int64    `json:"iat"`
}

// clientMetadata is the part of RFC 7591's client metadata this server reads,
// from a registration request or a client ID metadata document.
type clientMetadata struct {
	ClientID                string   `json:"client_id,omitempty"`
	ClientName              string   `json:"client_name,omitempty"`
	ClientURI               string   `json:"client_uri,omitempty"`
	LogoURI                 string   `json:"logo_uri,omitempty"`
	RedirectURIs            []string `json:"redirect_uris"`
	GrantTypes              []string `json:"grant_types,omitempty"`
	ResponseTypes           []string `json:"response_types,omitempty"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method,omitempty"`
	Scope                   string   `json:"scope,omitempty"`
	SoftwareID              string   `json:"software_id,omitempty"`
	SoftwareVersion         string   `json:"software_version,omitempty"`
}

// validate checks what a public client of this server must say: redirect URIs
// a browser may be sent to, and nothing this server does not do.
func (m *clientMetadata) validate() error {
	if len(m.RedirectURIs) == 0 {
		return errors.New("redirect_uris is required")
	}
	for _, uri := range m.RedirectURIs {
		if _, ok := matchRedirectURI([]string{uri}, uri); !ok {
			return fmt.Errorf("redirect_uri %q is not an http(s) URL this server can redirect to", uri)
		}
	}
	switch m.TokenEndpointAuthMethod {
	case "", "none":
		m.TokenEndpointAuthMethod = "none"
	default:
		return fmt.Errorf("token_endpoint_auth_method %q is not supported: clients here are public", m.TokenEndpointAuthMethod)
	}
	for _, grant := range m.GrantTypes {
		if grant != "authorization_code" && grant != "refresh_token" {
			return fmt.Errorf("grant_type %q is not supported", grant)
		}
	}
	for _, response := range m.ResponseTypes {
		if response != "code" {
			return fmt.Errorf("response_type %q is not supported", response)
		}
	}
	if len(m.GrantTypes) == 0 {
		m.GrantTypes = []string{"authorization_code", "refresh_token"}
	}
	if len(m.ResponseTypes) == 0 {
		m.ResponseTypes = []string{"code"}
	}
	return nil
}

// documentCacheTTL is how long a fetched client ID metadata document is
// trusted before it is fetched again.
const documentCacheTTL = 5 * time.Minute

// maxDocumentSize bounds a client ID metadata document; the egress client
// caps every body too.
const maxDocumentSize = 16 << 10

// documentCache fetches and keeps client ID metadata documents (ADR 082 §9,
// draft-ietf-oauth-client-id-metadata-document). Such clients are third
// parties.
type documentCache struct {
	fetch *http.Client
	now   func() time.Time

	mu      sync.Mutex
	entries map[string]documentEntry
}

type documentEntry struct {
	client  Client
	fetched time.Time
}

func newDocumentCache(fetch *http.Client, now func() time.Time) *documentCache {
	return &documentCache{fetch: fetch, now: now, entries: map[string]documentEntry{}}
}

func (c *documentCache) client(ctx context.Context, clientID string) (Client, error) {
	c.mu.Lock()
	entry, ok := c.entries[clientID]
	c.mu.Unlock()
	if ok && c.now().Sub(entry.fetched) < documentCacheTTL {
		return entry.client, nil
	}
	client, err := c.load(ctx, clientID)
	if err != nil {
		return Client{}, err
	}
	c.mu.Lock()
	c.entries[clientID] = documentEntry{client: client, fetched: c.now()}
	c.mu.Unlock()
	return client, nil
}

// load fetches the document behind clientID. The URL must be HTTPS with a
// path, and the document must name itself as client_id; anything else is an
// unknown client. The egress client keeps the fetch off private and
// special-use addresses (ADR 082 §9).
func (c *documentCache) load(ctx context.Context, clientID string) (Client, error) {
	u, err := url.Parse(clientID)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Path == "" || u.Path == "/" ||
		u.User != nil || u.Fragment != "" || slices.Contains(strings.Split(u.Path, "/"), "..") {
		return Client{}, errUnknownClient
	}
	if c.fetch == nil {
		return Client{}, errUnknownClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, clientID, nil)
	if err != nil {
		return Client{}, errUnknownClient
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.fetch.Do(req)
	if err != nil {
		return Client{}, fmt.Errorf("%w: fetch: %w", errUnknownClient, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Client{}, fmt.Errorf("%w: document answered %d", errUnknownClient, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDocumentSize+1))
	if err != nil || len(body) > maxDocumentSize {
		return Client{}, fmt.Errorf("%w: document unreadable or too large", errUnknownClient)
	}
	var doc clientMetadata
	if err := json.Unmarshal(body, &doc); err != nil {
		return Client{}, fmt.Errorf("%w: document is not JSON", errUnknownClient)
	}
	if doc.ClientID != clientID {
		return Client{}, fmt.Errorf("%w: document names another client_id", errUnknownClient)
	}
	if err := doc.validate(); err != nil {
		return Client{}, fmt.Errorf("%w: %w", errUnknownClient, err)
	}
	return Client{
		ID:           clientID,
		Name:         doc.ClientName,
		Source:       SourceMetadataDocument,
		RedirectURIs: doc.RedirectURIs,
	}, nil
}
