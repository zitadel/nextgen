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

	"github.com/zitadel/nextgen/internal/domain"
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
