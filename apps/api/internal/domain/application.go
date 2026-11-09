package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/httputil"
)

const (
	PrefixApplication         ResourcePrefix = "app"
	PrefixApplicationRevision ResourcePrefix = "apprev"
	// PrefixApplicationClient prefixes a client row's primary key. The row's
	// client_id copies it when the document supplied none (ADR 047 §5).
	PrefixApplicationClient ResourcePrefix = "client"
)

const (
	grantTypeAuthorizationCode = "authorization_code"
	grantTypeRefreshToken      = "refresh_token"
)

const (
	ApplicationFieldUnspecified ApplicationField = iota
	ApplicationFieldProjectID
	ApplicationFieldID
	ApplicationFieldSlug
	ApplicationFieldRevisionID
	ApplicationFieldCreatedAt
	ApplicationFieldUpdatedAt
	ApplicationFieldDocument
)

// refreshTokenIssuingGrants are the grants that issue a refresh token, which
// a refresh_token grant then renews.
var refreshTokenIssuingGrants = []string{grantTypeAuthorizationCode}

// reservedClientIDPrefixes mark client ids the server generates: its own
// and, later, those of dynamic client registration. A supplied id may not
// take one, so a generated id never collides with a supplied one.
var reservedClientIDPrefixes = []string{PrefixApplicationClient.IDPrefix(""), "dcr_"}

type ApplicationField uint8

// ApplicationDocument holds the document fields the server reads. The
// stored document stays the raw JSON the contract defines.
type ApplicationDocument struct {
	Slug    string                      `json:"slug"`
	Name    string                      `json:"name"`
	Clients []ApplicationClientDocument `json:"clients"`
}

type ApplicationClientDocument struct {
	Slug         string   `json:"slug"`
	ClientID     *string  `json:"client_id"`
	GrantTypes   []string `json:"grant_types"`
	RedirectURIs []string `json:"redirect_uris"`
}

// Application is one application at one revision. The application row holds
// identity, and every write appends a revision holding the document (ADR 063).
// RevisionID and Document are the newest revision's.
type Application struct {
	ProjectID  string
	ID         string
	Slug       string
	RevisionID string
	Document   []byte
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// ApplicationClient is the stored credential of one client, matched to the
// document's client by Slug. ID is the row's primary key and stays inside
// storage; the API and the OAuth endpoints identify a client by ClientID.
// SecretHash is [HashSecret] of the secret, which the server returns once,
// when it creates the client.
type ApplicationClient struct {
	ProjectID     string
	ApplicationID string
	ID            string
	Slug          string
	ClientID      string
	SecretHash    string
	CreatedAt     time.Time
}

// The codes are literal: the ID prefix is "app", the error resource is
// "application".

// ErrApplicationFieldImmutable rejects a revision that changes a client's
// client_id or omits a stored client. details holds the field's location: the
// client's index in the new document, or its slug for an omitted client, which
// has no index there.
// todo (@grvijayan) : denying removal of a client is temporary until the deletion semantics are defined.
func ErrApplicationFieldImmutable(details any) Error {
	return newError("application.field_immutable", "application: a revision may not change a client's client_id or remove a client", details, nil)
}

// ErrApplicationInvalid rejects a document that passes the schema but breaks
// a rule of the authorization server. details maps each location to why.
func ErrApplicationInvalid(details any, parent error) Error {
	return newError("application.invalid", "application: invalid", details, parent)
}

func ParseApplicationDocument(document []byte) (ApplicationDocument, error) {
	var doc ApplicationDocument
	err := json.Unmarshal(document, &doc)
	return doc, err
}

// ValidateApplicationDocument checks the rules application.json cannot
// express on a document that already passed it.
func ValidateApplicationDocument(doc ApplicationDocument) error {
	failures := map[string]string{}
	seenSlugs := map[string]bool{}
	seenIDs := map[string]bool{}
	for i, client := range doc.Clients {
		at := fmt.Sprintf("/clients/%d", i)
		if seenSlugs[client.Slug] {
			failures[at+"/slug"] = "another client of the application has this slug"
		}
		seenSlugs[client.Slug] = true
		if client.ClientID != nil {
			if seenIDs[*client.ClientID] {
				failures[at+"/client_id"] = "another client of the application has this client_id"
			}
			seenIDs[*client.ClientID] = true
		}
		if slices.Contains(client.GrantTypes, grantTypeRefreshToken) && !slices.ContainsFunc(client.GrantTypes, isRefreshTokenIssuingGrant) {
			failures[at+"/grant_types"] = "refresh_token requires a grant that issues refresh tokens"
		}
		if slices.Contains(client.GrantTypes, grantTypeAuthorizationCode) && len(client.RedirectURIs) == 0 {
			failures[at+"/redirect_uris"] = "authorization_code requires at least one redirect URI"
		}
		for j, uri := range client.RedirectURIs {
			if err := validateRedirectURI(uri); err != nil {
				failures[fmt.Sprintf("%s/redirect_uris/%d", at, j)] = err.Error()
			}
		}
	}
	if len(failures) > 0 {
		return ErrApplicationInvalid(failures, nil)
	}
	return nil
}

// ApplicationRevisionNewClients returns the slugs of the clients in next that
// stored does not have; on create, stored is the zero document. Each stored
// client keeps its slug and client_id: next may leave the id out, but may not
// change it or omit the client. Only a new client is checked for a reserved
// client_id prefix, so a stored id keeps working; every such client is
// reported at once. next must have passed [ValidateApplicationDocument],
// which rejects a slug used twice.
func ApplicationRevisionNewClients(stored, next ApplicationDocument) ([]string, error) {
	nextIndex := make(map[string]int, len(next.Clients))
	for i, client := range next.Clients {
		nextIndex[client.Slug] = i
	}
	storedSlugs := make(map[string]bool, len(stored.Clients))
	for _, before := range stored.Clients {
		storedSlugs[before.Slug] = true
		i, ok := nextIndex[before.Slug]
		if !ok {
			return nil, ErrApplicationFieldImmutable(map[string]any{"field": "/clients/" + before.Slug})
		}
		if after := next.Clients[i]; after.ClientID != nil && !sameString(before.ClientID, after.ClientID) {
			return nil, ErrApplicationFieldImmutable(map[string]any{"field": fmt.Sprintf("/clients/%d/client_id", i)})
		}
	}
	var added []string
	failures := make(map[string]string)
	for i, client := range next.Clients {
		if storedSlugs[client.Slug] {
			continue
		}
		if client.ClientID != nil && slices.ContainsFunc(reservedClientIDPrefixes, func(prefix string) bool {
			return strings.HasPrefix(*client.ClientID, prefix)
		}) {
			failures[fmt.Sprintf("/clients/%d/client_id", i)] = "a supplied client_id may not start with client_ or dcr_"
		}
		added = append(added, client.Slug)
	}
	if len(failures) > 0 {
		return nil, ErrApplicationInvalid(failures, nil)
	}
	return added, nil
}

func isRefreshTokenIssuingGrant(grant string) bool {
	return slices.Contains(refreshTokenIssuingGrants, grant)
}

// validateRedirectURI returns why uri is not a redirect URI the authorization
// server accepts. Matching is exact, so only the canonical form passes: a URI
// that re-serializes differently, or has an uppercase host, would never match
// the one the client sends.
func validateRedirectURI(uri string) error {
	if strings.Contains(uri, "#") {
		return errors.New("a redirect URI may not have a fragment")
	}
	u, err := httputil.ParseRedirectTarget(uri)
	if err != nil {
		return err
	}
	if u.Scheme == "http" && !IsLoopbackOrigin(u.Scheme+"://"+u.Host) {
		return errors.New("an http redirect URI must be on a loopback host")
	}
	if u.String() != uri || u.Host != strings.ToLower(u.Host) {
		return errors.New("the redirect URI is not in its canonical form")
	}
	return nil
}
