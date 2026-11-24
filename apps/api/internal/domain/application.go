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
	// client_id copies it when the document supplied none (ADR 047 §5). A
	// registered client's generated secret takes it too, as sk_client_….
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
	IsFirstParty *bool   `json:"first_party"`
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
	if err := validateNoReservedClientIDs(doc, doc.Clients); err != nil {
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
	secret, err := secretGen.New(string(PrefixApplicationClient))
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
	immutable := linq.FromSlice(removedClientIndexes(oldDoc.Clients, newDoc.Clients)).
		Select(func(i int) string { return "/clients/" + oldDoc.Clients[i].Slug }).
		Concat(linq.FromSlice(changedClientIDIndexes(oldDoc.Clients, newDoc.Clients)).
			Select(func(i int) string { return fmt.Sprintf("/clients/%d/client_id", i) })).
		ToSlice()
	if len(immutable) > 0 {
		return nil, nil, nil, ErrApplicationFieldImmutable(immutable)
	}

	toAdd := linq.FromSlice(newDoc.Clients).
		Where(func(oc ApplicationClientDocument) bool {
			return !slices.ContainsFunc(oldDoc.Clients, func(c ApplicationClientDocument) bool { return oc.Slug == c.Slug })
		}).
		ToSlice()
	if err := validateNoReservedClientIDs(newDoc, toAdd); err != nil {
		return nil, nil, nil, err
	}

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

func NewDeclaredApplication(projectID string, doc ApplicationDocument, docBs []byte) (app *Application, clients []*ApplicationClient, err error) {
	if err := ValidateDeclaredApplication(doc); err != nil {
		return nil, nil, err
	}
	if err := validateNoReservedClientIDs(doc, doc.Clients); err != nil {
		return nil, nil, err
	}

	clients = make([]*ApplicationClient, len(doc.Clients))
	for i, client := range doc.Clients {
		clients[i] = &ApplicationClient{ProjectID: projectID, Slug: client.Slug, ClientID: gu.Value(client.ClientID)}
	}

	app = &Application{
		ProjectID:  projectID,
		Slug:       doc.Slug,
		IsDeclared: true,
		Document:   docBs,
	}

	return app, clients, nil
}

func (app *Application) ReviseDeclaredApplication(stored []*ApplicationClient, newDoc ApplicationDocument, docBs []byte) (revisedApp *Application, clientsToAdd []*ApplicationClient, err error) {
	if !app.IsDeclared {
		return nil, nil, ErrApplicationRegistered()
	}
	if err := ValidateDeclaredApplication(newDoc); err != nil {
		return nil, nil, err
	}

	oldClients := linq.FromSlice(stored).
		Select(func(client *ApplicationClient) ApplicationClientDocument {
			return ApplicationClientDocument{Slug: client.Slug, ClientID: &client.ClientID}
		}).
		ToSlice()

	immutable := linq.FromSlice(changedClientIDIndexes(oldClients, newDoc.Clients)).
		Select(func(i int) string { return fmt.Sprintf("/clients/%d/client_id", i) }).
		ToSlice()
	if len(immutable) > 0 {
		return nil, nil, ErrApplicationFieldImmutable(immutable)
	}

	toAdd, _ := slice_util.DiffFunc(oldClients, newDoc.Clients, func(a ApplicationClientDocument, b ApplicationClientDocument) bool { return a.Slug == b.Slug })
	if err := validateNoReservedClientIDs(newDoc, toAdd); err != nil {
		return nil, nil, err
	}
	clientsToAdd = make([]*ApplicationClient, len(toAdd))
	for i, client := range toAdd {
		clientsToAdd[i] = &ApplicationClient{ProjectID: app.ProjectID, Slug: client.Slug, ClientID: gu.Value(client.ClientID)}
	}

	revisedApp = &Application{
		ProjectID:  app.ProjectID,
		ID:         app.ID,
		Slug:       app.Slug,
		CreatedAt:  app.CreatedAt,
		IsDeclared: true,
		Document:   docBs,
	}

	return revisedApp, clientsToAdd, nil
}

// ErrApplicationFieldImmutable rejects a revision that changes a client's
// client_id or omits a stored client. fields lists the location of each: the
// client's index in the new document, or its slug for an omitted client, which
// has no index there.
// todo (@grvijayan) : denying removal of a client is temporary until the deletion semantics are defined.
func ErrApplicationFieldImmutable(fields []string) Error {
	return newError(
		PrefixApplication.ErrorCodePrefix("field_immutable"),
		"application: a revision may not change a client's client_id or remove a client",
		map[string][]string{"fields": fields},
		nil)
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

func removedClientIndexes(oldClients, newClients []ApplicationClientDocument) []int {
	var indexes []int
	for i, oldClient := range oldClients {
		if !slices.ContainsFunc(newClients, func(c ApplicationClientDocument) bool { return c.Slug == oldClient.Slug }) {
			indexes = append(indexes, i)
		}
	}
	return indexes
}

func changedClientIDIndexes(oldClients, newClients []ApplicationClientDocument) []int {
	var indexes []int
	for i, newClient := range newClients {
		if newClient.ClientID == nil {
			continue
		}
		oldClient, ok := slice_util.FindFunc(oldClients, func(c ApplicationClientDocument) bool { return c.Slug == newClient.Slug })
		if ok && !sameString(oldClient.ClientID, newClient.ClientID) {
			indexes = append(indexes, i)
		}
	}
	return indexes
}

func validateNoReservedClientIDs(doc ApplicationDocument, added []ApplicationClientDocument) error {
	failures := map[string]string{}
	for i, client := range doc.Clients {
		if client.ClientID == nil || !hasReservedClientIDPrefix(*client.ClientID) {
			continue
		}
		if slices.ContainsFunc(added, func(c ApplicationClientDocument) bool { return c.Slug == client.Slug }) {
			failures[fmt.Sprintf("/clients/%d/client_id", i)] = "a supplied client_id may not start with " + strings.Join(reservedClientIDPrefixes, " or ")
		}
	}
	if len(failures) > 0 {
		return ErrApplicationInvalid(failures, nil)
	}
	return nil
}

func hasReservedClientIDPrefix(clientID string) bool {
	return slices.ContainsFunc(reservedClientIDPrefixes, func(prefix string) bool {
		return strings.HasPrefix(clientID, prefix)
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
