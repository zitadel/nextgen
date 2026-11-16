package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/ahmetb/go-linq/v5"
	"github.com/muhlemmer/gu"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/secrets"
	"github.com/zitadel/nextgen/internal/slice_util"
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

	clientTypeConfidential = "confidential"
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
	Type         string   `json:"type"`
	GrantTypes   []string `json:"grant_types"`
	RedirectURIs []string `json:"redirect_uris"`
	// Secret is the `${{ NAME }}` reference to the variable holding a
	// declared client's secret; a registered client has none.
	Secret       *string `json:"secret"`
	IsFirstParty *bool   `json:"is_first_party"`
}

func (c ApplicationClientDocument) IsConfidential() bool {
	return c.Type == clientTypeConfidential
}

func (c ApplicationClientDocument) SecretVariable() (string, bool) {
	if c.Secret == nil {
		return "", false
	}
	return VariableReferenceName(*c.Secret)
}

// Application is one application at one revision. The application row holds
// what is fixed for its life: the id, the slug, who writes it and the creation
// time. Every write appends a revision holding the document (ADR 063).
// RevisionID, Document and UpdatedAt come from the revision a read serves.
//
// IsDeclared is true for an application a release declares, whose one writer is
// the release build, and false for one registered through the API (ADR 082
// §1, §3).
type Application struct {
	ProjectID  string
	ID         string
	Slug       string
	IsDeclared bool
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

type ApplicationSecretVariable struct {
	ProjectID           string
	Name                string
	ApplicationClientID string
	CreatedAt           time.Time
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

func NewRegisteredApplication(projectID string, doc ApplicationDocument, docbs []byte, secretGen secrets.Generator) (app *Application, clients []*ApplicationClient, plainSecrets []string, err error) {
	if err := ValidateRegisteredApplication(doc); err != nil {
		return nil, nil, nil, err
	}

	clients = make([]*ApplicationClient, len(doc.Clients))
	plainSecrets = make([]string, len(doc.Clients))
	for i, client := range doc.Clients {
		client, secret, err := NewApplicationClient(projectID, client.ClientID, client.Slug, secretGen)
		if err != nil {
			return nil, nil, nil, err
		}
		clients[i] = client
		plainSecrets[i] = secret
	}

	app = &Application{
		ProjectID:  projectID,
		Slug:       doc.Slug,
		IsDeclared: false,
		Document:   docbs,
	}

	return app, clients, plainSecrets, nil
}

func NewApplicationClient(projectID string, clientID *string, slug string, secretGen secrets.Generator) (client *ApplicationClient, plainSecret string, err error) {
	secret, err := secretGen.New(string(PrefixApplicationClientSecret))
	if err != nil {
		return nil, "", ErrInternal(err).WithMessage("failed to generate client secret")
	}
	return &ApplicationClient{
		ProjectID: projectID,
		Slug:      slug,
		ClientID:  gu.Value(clientID),
	}, secret, nil
}

func ReviseRegisteredApplication(oldApp *Application, newDoc ApplicationDocument, docBs []byte, secretGen secrets.Generator) (revisedApp *Application, clientsToAdd []*ApplicationClient, plainSecrets []string, err error) {
	if oldApp.IsDeclared {
		return nil, nil, nil, ErrApplicationDeclared()
	}
	if err := ValidateRegisteredApplication(newDoc); err != nil {
		return nil, nil, nil, err
	}

	oldDoc, err := ParseApplicationDocument(oldApp.Document)
	if err != nil {
		return nil, nil, nil, ErrInternal(err).WithMessage("failed to parse stored application")
	}
	if err := validateNoImmutabilityViolations(oldDoc, newDoc); err != nil {
		return nil, nil, nil, err
	}

	toAdd := linq.FromSlice(newDoc.Clients).
		Where(func(oc ApplicationClientDocument) bool {
			return !slices.ContainsFunc(oldDoc.Clients, func(c ApplicationClientDocument) bool { return oc.Slug == c.Slug })
		}).
		ToSlice()

	clientsToAdd = make([]*ApplicationClient, len(toAdd))
	plainSecrets = make([]string, len(toAdd))
	for i, client := range toAdd {
		client, secret, err := NewApplicationClient(oldApp.ProjectID, client.ClientID, client.Slug, secretGen)
		if err != nil {
			return nil, nil, nil, err
		}
		clientsToAdd[i] = client
		plainSecrets[i] = secret
	}

	revisedApp = &Application{
		ProjectID:  oldApp.ProjectID,
		ID:         oldApp.ID,
		Slug:       oldApp.Slug,
		CreatedAt:  oldApp.CreatedAt,
		IsDeclared: false,
		Document:   docBs,
	}

	return revisedApp, clientsToAdd, plainSecrets, nil
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

// ErrApplicationDeclared refuses an API write to an application a release
// declares: the release is its one writer.
func ErrApplicationDeclared() Error {
	return newError(PrefixApplication.ErrorCodePrefix("declared"), "application: declared in a release, so only a deploy revises it", nil, nil)
}

// ErrApplicationRegistered refuses a release that declares an application
// registered through the API: the API is its one writer.
func ErrApplicationRegistered() Error {
	return newError(PrefixApplication.ErrorCodePrefix("registered"), "application: registered through the API, so a release may not declare it", nil, nil)
}

// ErrApplicationClientNotFound reports a client_id no client serving the
// request holds: no client of the project holds it, or its application is
// declared and the deployment's release does not pin the revision listing it.
func ErrApplicationClientNotFound() Error {
	return newError(PrefixApplication.ErrorCodePrefix("client_not_found"), "application: no client serving the request holds this client_id", nil, nil)
}

// ErrApplicationClientSecretInvalid reports a client that failed to
// authenticate: its secret matches none the client holds, or it holds none.
func ErrApplicationClientSecretInvalid() Error {
	return newError(PrefixApplication.ErrorCodePrefix("client_secret_invalid"), "application: the client secret is invalid", nil, nil)
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

func ValidateRegisteredApplication(doc ApplicationDocument) error {
	failures := validateApplicationDocument(doc)
	for i, client := range doc.Clients {
		if client.Secret != nil {
			failures[fmt.Sprintf("/clients/%d/secret", i)] = "only a client declared in a release names its secret; the server generates a registered client's secret"
		}
	}
	if len(failures) > 0 {
		return ErrApplicationInvalid(failures, nil)
	}
	return nil
}

func ValidateDeclaredApplication(doc ApplicationDocument) error {
	failures := validateApplicationDocument(doc)
	for i, client := range doc.Clients {
		at := fmt.Sprintf("/clients/%d", i)
		if client.ClientID == nil {
			failures[at+"/client_id"] = "a client declared in a release sets its client_id"
		}
		if client.IsConfidential() && client.Secret == nil {
			failures[at+"/secret"] = "a confidential client declared in a release names the variable holding its secret"
		}
	}
	if len(failures) > 0 {
		return ErrApplicationInvalid(failures, nil)
	}
	return nil
}

func validateApplicationDocument(doc ApplicationDocument) map[string]string {
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
			if HasReservedClientIDPRefix(*client.ClientID) {
				failures[at+"/client_id"] = "a supplied client_id may not start with " + strings.Join(reservedClientIDPrefixes, " or ")
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
	return failures
}

func validateNoImmutabilityViolations(oldApp, newApp ApplicationDocument) error {
	removedClients := linq.FromSlice(oldApp.Clients).
		Where(func(oc ApplicationClientDocument) bool {
			return !slices.ContainsFunc(newApp.Clients, func(c ApplicationClientDocument) bool { return oc.Slug == c.Slug })
		}).
		ToSlice()
	modifiedClientIds := linq.FromSlice(newApp.Clients).
		Where(func(client ApplicationClientDocument) bool {
			if client.ClientID == nil {
				return false
			}
			oldClient, ok := slice_util.FindFunc(oldApp.Clients, func(c ApplicationClientDocument) bool { return c.Slug == client.Slug })
			return ok && !sameString(oldClient.ClientID, client.ClientID)
		}).
		ToSlice()

	if len(removedClients) > 0 || len(modifiedClientIds) > 0 {
		return ErrApplicationFieldImmutable(map[string][]string{
			"fields": linq.FromSlice(removedClients).Concat(linq.FromSlice(modifiedClientIds)).
				Select(func(c ApplicationClientDocument) string { return "/clients/" + gu.Value(c.ClientID) }).
				ToSlice(),
		})
	}

	return nil
}

// DeclaredClientsToCreate returns the slugs of document's clients that have
// no stored client yet, for a release. stored is every client the application
// ever held, so a release may drop a client and declare it again, but never
// under another client_id: dropping a client only stops serving it (ADR 082
// section 3). Errors: app.field_immutable for a changed client_id,
// app.invalid for a new client_id with a reserved prefix.
func DeclaredClientsToCreate(stored []*ApplicationClient, document ApplicationDocument) ([]string, error) {
	held := make([]ApplicationClientDocument, 0, len(stored))
	for _, client := range stored {
		held = append(held, ApplicationClientDocument{Slug: client.Slug, ClientID: &client.ClientID})
	}
	added, _ := slice_util.DiffFunc(held, document.Clients, func(a ApplicationClientDocument, b ApplicationClientDocument) bool { return a.Slug == b.Slug })
	if immutable := changedClientIDs(held, document); len(immutable) > 0 {
		return nil, ErrApplicationFieldImmutable(map[string][]string{"fields": immutable})
	}
	if failures := reservedClientIDFailures(added, document); len(failures) > 0 {
		return nil, ErrApplicationInvalid(failures, nil)
	}
	return linq.FromSlice(added).
		Select(func(client ApplicationClientDocument) string { return client.Slug }).
		ToSlice(), nil
}

func changedClientIDs(original []ApplicationClientDocument, updated []ApplicationClientDocument) []ApplicationClientDocument {
	return linq.FromSlice(updated).
		Where(func(client ApplicationClientDocument) bool {
			if client.ClientID == nil {
				return false
			}
			i := slices.IndexFunc(original, func(c ApplicationClientDocument) bool { return c.Slug == client.Slug })
			if i < 0 {
				return false
			}
			existing := original[i]
			return !sameString(existing.ClientID, client.ClientID)
		}).
		ToSlice()
}

func HasReservedClientIDPRefix(clientID string) bool {
	return slices.ContainsFunc(reservedClientIDPrefixes, func(prefix string) bool {
		return strings.HasPrefix(clientID, prefix)
	})
}

func reservedClientIDFailures(added []ApplicationClientDocument, document ApplicationDocument) map[string]string {
	return linq.FromSlice(added).
		Where(func(client ApplicationClientDocument) bool { return hasReservedPrefix(client.ClientID) }).
		ToMapBy(
			func(client ApplicationClientDocument) string {
				i := slices.IndexFunc(document.Clients, func(c ApplicationClientDocument) bool { return c.Slug == client.Slug })
				return fmt.Sprintf("/clients/%d/client_id", i)
			},
			func(client ApplicationClientDocument) string {
				return "a supplied client_id may not start with " + strings.Join(reservedClientIDPrefixes, " or ")
			},
		)
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
