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
	// PrefixApplicationClientSecret prefixes a client secret row's primary key.
	PrefixApplicationClientSecret ResourcePrefix = "csec"
)

const (
	grantTypeAuthorizationCode = "authorization_code"
	grantTypeRefreshToken      = "refresh_token"
)

type ApplicationField uint8

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
// what is fixed for its life: the id, the slug and the creation time. Every
// write appends a revision holding the document (ADR 063). RevisionID,
// Document and UpdatedAt come from the newest revision.
type Application struct {
	ProjectID  string
	ID         string
	Slug       string
	RevisionID string
	Document   []byte
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// ApplicationClient is one stored client, matched to the document's client by
// Slug. ID is the row's primary key and stays inside storage; the API and the
// OAuth endpoints identify a client by ClientID.
type ApplicationClient struct {
	ProjectID     string
	ApplicationID string
	ID            string
	Slug          string
	ClientID      string
	CreatedAt     time.Time
}

// ApplicationClientSecret is one secret of one client. ApplicationClientID is
// the client's [ApplicationClient.ID], not its ClientID. SecretHash is
// [HashSecret] of the secret, which the server returns once, when it creates
// the secret.
type ApplicationClientSecret struct {
	ProjectID           string
	ID                  string
	ApplicationClientID string
	SecretHash          string
	CreatedAt           time.Time
}

// The codes are literal: the ID prefix is "app", the error resource is
// "application".

// ErrApplicationFieldImmutable rejects a revision that changes a client's
// client_id or omits a stored client. details lists the location of each: the
// client's index in the new document, or its slug for an omitted client, which
// has no index there.
// todo (@grvijayan) : denying removal of a client is temporary until the deletion semantics are defined.
func ErrApplicationFieldImmutable(details any) Error {
	return newError(PrefixApplication.ErrorCodePrefix("field_immutable"), "application: a revision may not change a client's client_id or remove a client", details, nil)
}

// ErrApplicationInvalid rejects a document that passes the schema but breaks
// a rule of the authorization server. details maps each location to why.
func ErrApplicationInvalid(details any, parent error) Error {
	return newError(PrefixApplication.ErrorCodePrefix("invalid"), "application: invalid", details, parent)
}

func ErrApplicationNotFound() Error {
	return newError(PrefixApplication.ErrorCodePrefix("not_found"), "application: not found", nil, nil)
}

// ErrApplicationClientIDTaken rejects a new client whose client_id another
// client of the project holds.
func ErrApplicationClientIDTaken() Error {
	return newError(PrefixApplication.ErrorCodePrefix("client_id_taken"), "application: another client of the project holds this client_id", nil, nil)
}

// ErrApplicationPermissionDenied rejects a caller whose project role does not
// allow the operation, such as a viewer revising an application.
func ErrApplicationPermissionDenied() Error {
	return newError(PrefixApplication.ErrorCodePrefix("permission_denied"), "application: the caller's project role does not allow this operation", nil, nil)
}

// ErrApplicationRevisionConflict reports a revision created at the same
// instant as another revision of the same application, so neither is newest.
func ErrApplicationRevisionConflict() Error {
	return newError(PrefixApplication.ErrorCodePrefix("revision_conflict"), "application: another revision of the same application was created at the same instant", nil, nil)
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

// ApplicationClientsToCreate returns the slugs of the clients in document that
// current does not have; on create, current is the zero document. document
// must have passed [ValidateApplicationDocument], which rejects a slug used
// twice.
func ApplicationClientsToCreate(current, document ApplicationDocument) ([]string, error) {
	// Every omitted client and changed client_id is reported.
	var immutable []string
	// A revision may not remove a client.
	for _, currentClient := range current.Clients {
		if _, found := findClient(document, currentClient.Slug); !found {
			immutable = append(immutable, "/clients/"+currentClient.Slug)
		}
	}

	var toCreate []string
	// Every new client with a reserved client_id is reported, not only the first.
	failures := make(map[string]string)
	for i, documentClient := range document.Clients {
		currentClient, found := findClient(current, documentClient.Slug)
		if !found {
			if hasReservedPrefix(documentClient.ClientID) {
				failures[fmt.Sprintf("/clients/%d/client_id", i)] = "a supplied client_id may not start with " + strings.Join(reservedClientIDPrefixes, " or ")
			}
			toCreate = append(toCreate, documentClient.Slug)
			continue
		}
		// A current client may leave its client_id out, which keeps it, but may
		// not change it.
		if documentClient.ClientID != nil && !sameString(currentClient.ClientID, documentClient.ClientID) {
			immutable = append(immutable, fmt.Sprintf("/clients/%d/client_id", i))
		}
	}
	if len(immutable) > 0 {
		return nil, ErrApplicationFieldImmutable(map[string][]string{"fields": immutable})
	}
	if len(failures) > 0 {
		return nil, ErrApplicationInvalid(failures, nil)
	}
	return toCreate, nil
}

func findClient(doc ApplicationDocument, slug string) (ApplicationClientDocument, bool) {
	i := slices.IndexFunc(doc.Clients, func(client ApplicationClientDocument) bool { return client.Slug == slug })
	if i < 0 {
		return ApplicationClientDocument{}, false
	}
	return doc.Clients[i], true
}

func hasReservedPrefix(clientID *string) bool {
	return clientID != nil && slices.ContainsFunc(reservedClientIDPrefixes, func(prefix string) bool {
		return strings.HasPrefix(*clientID, prefix)
	})
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
