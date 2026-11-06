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

	"golang.org/x/sync/singleflight"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/service"
)

// errUnknownClient is a client_id that names no client: no app's own, not a
// metadata document this server may fetch, no registration. An authorization
// request for it never redirects (ADR 081 §8).
var errUnknownClient = errors.New("oauth: unknown client")

// maxClientIDLength bounds a client_id: a consent's unique key holds it, and
// an index entry has a size limit (about 2.7 KB on Postgres). An app's own
// ids and a registration's are short; this bounds metadata document URLs.
const maxClientIDLength = 1024

// ClientSource is where a client's definition comes from.
type ClientSource string

const (
	// SourceApp is a client an app document declares.
	SourceApp ClientSource = "app"
	// SourceMetadataDocument is a client whose client_id is the URL of its
	// client ID metadata document.
	SourceMetadataDocument ClientSource = "metadata_document"
	// SourceRegistered is a client that registered itself (RFC 7591).
	SourceRegistered ClientSource = "registered"
)

// Client is a client a request names, as the server resolved it. Every
// client here is public: it proves itself with PKCE, never a secret.
type Client struct {
	ID     string
	Name   string
	Source ClientSource
	// FirstParty clients get a refresh token without offline_access, and a
	// failure the user has not seen the app for (ADR 082 §3).
	FirstParty bool
	// Consent is when the user is asked: by default only on prompt=consent
	// for a first-party client and for new scopes for a third party, and on
	// every request for an app's client whose document says always.
	Consent domain.ConsentPolicy
	// RedirectURIs match exactly, except that a loopback one matches on any
	// port (RFC 8252 §7.3).
	RedirectURIs []string
	GrantTypes   []domain.GrantType

	// app and appClient are an app client's own; registration is a
	// registered client's.
	app          *domain.ResolvedApp
	appClient    domain.AppClient
	registration *domain.ClientRegistration
}

func (c Client) mayUse(grant domain.GrantType) bool {
	return slices.Contains(c.GrantTypes, grant)
}

// lookup is where the directory finds the issuer's apps. The platform
// project's are built in, so they serve without a deployment; its stored
// apps are read at their newest revision.
func (s *Server) lookup() service.AppLookup {
	return service.AppLookup{ProjectID: s.projectID}
}

// resolveClient finds the client a client_id names: an app's own, then the
// client ID metadata document a URL names when an app takes them, then a
// client that registered itself.
func (s *Server) resolveClient(ctx context.Context, clientID string) (Client, error) {
	if clientID == "" || len(clientID) > maxClientIDLength {
		return Client{}, errUnknownClient
	}
	at := s.lookup()
	app, appClient, err := s.apps.Client(ctx, at, clientID)
	if err == nil {
		// A confidential client authenticates at the token endpoint, which
		// takes no client credentials yet.
		if appClient.Type != domain.ClientTypePublic {
			return Client{}, errUnknownClient
		}
		name := appClient.Name
		if name == "" {
			name = app.Document.Name
		}
		return Client{
			ID:           clientID,
			Name:         name,
			Source:       SourceApp,
			FirstParty:   appClient.IsFirstParty(app.Source),
			Consent:      appClient.EffectiveConsent(app.Source),
			RedirectURIs: appClient.RedirectURIs,
			GrantTypes:   appClient.GrantTypes,
			app:          app,
			appClient:    appClient,
		}, nil
	}
	if !errors.Is(err, domain.ErrAppClientNotFound()) {
		return Client{}, err
	}
	if strings.HasPrefix(clientID, "https://") {
		open, err := s.apps.Registration(ctx, at)
		if err != nil {
			return Client{}, err
		}
		if !open.ClientIDMetadataDocuments {
			return Client{}, errUnknownClient
		}
		return s.documents.client(ctx, clientID)
	}
	registration, err := s.apps.ClientRegistration(ctx, at, clientID)
	if errors.Is(err, domain.ErrClientRegistrationNotFound()) {
		return Client{}, errUnknownClient
	}
	if err != nil {
		return Client{}, err
	}
	// Registration takes public clients only, as the token endpoint does.
	if registration.Metadata.AuthMethod != domain.ClientAuthNone {
		return Client{}, errUnknownClient
	}
	return Client{
		ID:           registration.ID,
		Name:         registration.Metadata.ClientName,
		Source:       SourceRegistered,
		Consent:      domain.ConsentNewScopes,
		RedirectURIs: registration.Metadata.RedirectURIs,
		GrantTypes:   registration.Metadata.GrantTypes,
		registration: registration,
	}, nil
}

// target finds the API whose identifier is resource, in whichever of the
// project's apps serves it, and what the client may get for it. An app's
// client gets what its document lists; a third party, an API open to third
// parties of an app that takes its kind of client. A registered client joins
// the API's app on its first authorization request (join), and is held to
// that app from then on. A resource no app serves allows nothing.
func (s *Server) target(ctx context.Context, client Client, resource string, join bool) (domain.AppAPI, domain.ClientAPIAccess, error) {
	at := s.lookup()
	apiApp, api, err := s.apps.API(ctx, at, resource)
	if errors.Is(err, domain.ErrAppAPINotFound()) {
		return domain.AppAPI{}, domain.ClientAPIAccess{}, nil
	}
	if err != nil {
		return domain.AppAPI{}, domain.ClientAPIAccess{}, err
	}
	switch client.Source {
	case SourceApp:
		return api, client.app.AccessTo(client.appClient, apiApp, api), nil
	case SourceRegistered:
		registration := client.registration
		if join {
			registration, err = s.apps.JoinClientRegistration(ctx, at, registration, apiApp, api)
			if errors.Is(err, domain.ErrClientRegistrationOtherApp()) || errors.Is(err, domain.ErrClientRegistrationNotFound()) {
				return api, domain.ClientAPIAccess{}, nil
			}
			if err != nil {
				return domain.AppAPI{}, domain.ClientAPIAccess{}, err
			}
		}
		return api, registration.AccessTo(apiApp, api), nil
	default:
		if !apiApp.Document.Registration.ClientIDMetadataDocuments {
			return api, domain.ClientAPIAccess{}, nil
		}
		// A client of no app gets an API open to third parties.
		return api, apiApp.AccessTo(domain.AppClient{}, apiApp, api), nil
	}
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

// How long the cache answers for a client ID metadata document without
// fetching it: a document it read for documentCacheTTL, and while its host
// cannot answer, for up to documentStaleTTL; a refusal for documentRefusalTTL;
// and a host that could not answer is left alone for documentRetryInterval.
const (
	documentCacheTTL      = 5 * time.Minute
	documentStaleTTL      = time.Hour
	documentRefusalTTL    = time.Minute
	documentRetryInterval = 30 * time.Second
	documentFetchTimeout  = 10 * time.Second
)

// maxDocuments bounds the cache, whose every entry is a URL an
// unauthenticated request named, and maxDocumentsPerHost what one host's URLs
// take of it, which also bounds how often one host is fetched from.
const (
	maxDocuments        = 1024
	maxDocumentsPerHost = 32
)

// maxDocumentSize bounds a client ID metadata document; the egress client
// caps every body too.
const maxDocumentSize = 16 << 10

// errDocumentUnavailable is a document that could not be read just now: its
// host is down, answered a server error, or has too many documents cached.
// It says nothing about the client, so it is answered as a fault the client
// retries, never as an unknown client (internal/AGENTS.md).
var errDocumentUnavailable = errors.New("oauth: client ID metadata document unavailable")

// documentCache fetches and keeps client ID metadata documents (ADR 082 §9,
// draft-ietf-oauth-client-id-metadata-document). Such clients are third
// parties. Concurrent requests for one document share its fetch.
type documentCache struct {
	fetch     *http.Client
	now       func() time.Time
	limit     int
	hostLimit int
	fetches   singleflight.Group

	mu      sync.Mutex
	entries map[string]*documentEntry
}

// documentEntry is what the cache knows of one document URL.
type documentEntry struct {
	host string
	// client is the document's client, read at fetched.
	client  *Client
	fetched time.Time
	// err is the last fetch's failure, at failed: errUnknownClient when the
	// document refused the client, errDocumentUnavailable when it could not
	// be read.
	err    error
	failed time.Time
}

func newDocumentCache(fetch *http.Client, now func() time.Time) *documentCache {
	return &documentCache{fetch: fetch, now: now, limit: maxDocuments, hostLimit: maxDocumentsPerHost, entries: map[string]*documentEntry{}}
}

// client returns the client clientID's document describes. A document whose
// host cannot answer is served as it was last read, for a while; without
// one, the answer is domain.ErrUnavailable, so a client keeps its tokens and
// retries.
func (c *documentCache) client(ctx context.Context, clientID string) (Client, error) {
	u, err := url.Parse(clientID)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Path == "" || u.Path == "/" ||
		u.User != nil || u.Fragment != "" || slices.Contains(strings.Split(u.Path, "/"), "..") {
		return Client{}, errUnknownClient
	}
	client, err, fetch := c.cached(clientID, u.Host)
	if fetch {
		answer, _, _ := c.fetches.Do(clientID, func() (any, error) {
			// Shared by every request waiting for it, so no one of them can
			// cancel it.
			ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), documentFetchTimeout)
			defer cancel()
			client, err := c.load(ctx, clientID)
			return c.store(clientID, client, err), nil
		})
		client, err = answer.(documentAnswer).client, answer.(documentAnswer).err
	}
	if errors.Is(err, errDocumentUnavailable) {
		return Client{}, domain.ErrUnavailable().WithParent(err)
	}
	return client, err
}

type documentAnswer struct {
	client Client
	err    error
}

// cached answers from the cache, or says the document must be fetched, which
// it admits only while the cache and the URL's host have room.
func (c *documentCache) cached(clientID, host string) (_ Client, _ error, fetch bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	entry, ok := c.entries[clientID]
	if !ok {
		c.evictExpired(now)
		hosted := 0
		for _, e := range c.entries {
			if e.host == host {
				hosted++
			}
		}
		if hosted >= c.hostLimit {
			return Client{}, fmt.Errorf("%w: %s has %d documents cached", errDocumentUnavailable, host, hosted), false
		}
		if len(c.entries) >= c.limit {
			c.evictOldest()
		}
		c.entries[clientID] = &documentEntry{host: host}
		return Client{}, nil, true
	}
	switch {
	case entry.client != nil && now.Sub(entry.fetched) < documentCacheTTL:
		return *entry.client, nil, false
	case errors.Is(entry.err, errUnknownClient) && now.Sub(entry.failed) < documentRefusalTTL:
		return Client{}, entry.err, false
	case errors.Is(entry.err, errDocumentUnavailable) && now.Sub(entry.failed) < documentRetryInterval:
		if entry.client != nil && now.Sub(entry.fetched) < documentStaleTTL {
			return *entry.client, nil, false
		}
		return Client{}, entry.err, false
	}
	return Client{}, nil, true
}

// store records a fetch and returns the answer to give: the client, or for a
// document that could not be read, the one it described last.
func (c *documentCache) store(clientID string, client Client, err error) documentAnswer {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	entry, ok := c.entries[clientID]
	if !ok {
		// Evicted while it was fetched: it answers this request only.
		return documentAnswer{client: client, err: err}
	}
	switch {
	case err == nil:
		entry.client, entry.fetched, entry.err = &client, now, nil
		return documentAnswer{client: client}
	case errors.Is(err, errDocumentUnavailable):
		entry.err, entry.failed = err, now
		if entry.client != nil && now.Sub(entry.fetched) < documentStaleTTL {
			return documentAnswer{client: *entry.client}
		}
		return documentAnswer{err: err}
	default:
		// The document refused the client: what it said before no longer
		// counts.
		entry.client, entry.err, entry.failed = nil, err, now
		return documentAnswer{err: err}
	}
}

// evictExpired drops the entries the cache would no longer answer from.
func (c *documentCache) evictExpired(now time.Time) {
	for id, e := range c.entries {
		live := e.client != nil && now.Sub(e.fetched) < documentStaleTTL ||
			e.err != nil && now.Sub(e.failed) < max(documentRefusalTTL, documentRetryInterval)
		if !live && (e.client != nil || e.err != nil) {
			delete(c.entries, id)
		}
	}
}

// evictOldest drops the entry read or failed longest ago.
func (c *documentCache) evictOldest() {
	var oldest string
	var at time.Time
	for id, e := range c.entries {
		seen := e.fetched
		if e.failed.After(seen) {
			seen = e.failed
		}
		if oldest == "" || seen.Before(at) {
			oldest, at = id, seen
		}
	}
	delete(c.entries, oldest)
}

// load fetches the document behind clientID, an HTTPS URL with a path. A
// document that does not name itself as client_id, or describes a client
// this server cannot serve, refuses the client (errUnknownClient), and so
// does an address the egress client may not reach (ADR 082 §9); a host that
// cannot answer just now is errDocumentUnavailable.
func (c *documentCache) load(ctx context.Context, clientID string) (Client, error) {
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
		if _, denied := errors.AsType[*httputil.AddressDeniedError](err); denied ||
			errors.Is(err, httputil.ErrTooManyRedirects) || errors.Is(err, httputil.ErrHTTPSDowngrade) {
			return Client{}, fmt.Errorf("%w: fetch: %w", errUnknownClient, err)
		}
		return Client{}, fmt.Errorf("%w: fetch: %w", errDocumentUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusInternalServerError || resp.StatusCode == http.StatusTooManyRequests {
		return Client{}, fmt.Errorf("%w: document answered %d", errDocumentUnavailable, resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return Client{}, fmt.Errorf("%w: document answered %d", errUnknownClient, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDocumentSize+1))
	if errors.Is(err, httputil.ErrResponseTooLarge) || len(body) > maxDocumentSize {
		return Client{}, fmt.Errorf("%w: document too large", errUnknownClient)
	}
	if err != nil {
		return Client{}, fmt.Errorf("%w: document unreadable: %w", errDocumentUnavailable, err)
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
	grants := make([]domain.GrantType, len(doc.GrantTypes))
	for i, grant := range doc.GrantTypes {
		grants[i] = domain.GrantType(grant)
	}
	return Client{
		ID:           clientID,
		Name:         doc.ClientName,
		Source:       SourceMetadataDocument,
		Consent:      domain.ConsentNewScopes,
		RedirectURIs: doc.RedirectURIs,
		GrantTypes:   grants,
	}, nil
}
