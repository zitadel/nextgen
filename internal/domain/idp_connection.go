package domain

import "time"

// PrefixIDPConnection namespaces connection ids ("idp_01KWH3B..."), the id an
// identity link references.
const PrefixIDPConnection ResourcePrefix = "idp"

// PrefixIDPConnectionRevision namespaces revision ids ("idprev_01KWH3B..."),
// what attempts and releases pin. A revision is a row of its own, so it carries
// its own prefix rather than reusing the connection's.
const PrefixIDPConnectionRevision ResourcePrefix = "idprev"

func ErrIDPConnectionNotFound() Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("not_found"), "identity provider connection: not found", nil, nil)
}

// ErrIDPConnectionAlreadyExists reports a slug already taken in the project.
// The slug is what schemas and flow definitions reference a connection by, so
// it is unique per project rather than per connection.
func ErrIDPConnectionAlreadyExists() Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("already_exists"), "identity provider connection: a connection with this slug already exists in the project", nil, nil)
}

// ErrIDPConnectionFieldImmutable rejects a revision that changes a field the
// connection is identified by: protocol, subject_claim, and the field naming
// the authority, which is issuer for OIDC and token_endpoint with
// userinfo_endpoint for OAuth 2.0.
// Those values decide which provider account a stored subject belongs to, so
// changing one would repoint existing identities rather than reconfigure
// them. details names the offending field.
func ErrIDPConnectionFieldImmutable(details any) Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("field_immutable"), "identity provider connection: the field is fixed for the life of the connection", details, nil)
}

// IDPConnection is one identity provider connection at one revision. The
// connection row holds identity — id, slug, timestamps — and every edit appends
// a revision holding the configuration document, so an in-flight auth attempt
// can pin the revision it started on.
//
// RevisionID is the connection's newest revision on a get-by-id, get-by-slug or
// list, and the pinned one on a get-revision; Document is that revision's
// document either way. The document is raw JSON, opaque to storage: the API
// contract owns its shape.
type IDPConnection struct {
	ProjectID  string
	ID         string
	Slug       string
	RevisionID string
	Document   []byte
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// IDPConnectionField enumerates the fields of IDPConnection which can be used
// for filtering and ordering in list operations.
type IDPConnectionField uint8

const (
	IDPConnectionFieldUnspecified IDPConnectionField = iota
	IDPConnectionFieldProjectID
	IDPConnectionFieldID
	IDPConnectionFieldSlug
	IDPConnectionFieldRevisionID
	IDPConnectionFieldCreatedAt
	IDPConnectionFieldUpdatedAt
	IDPConnectionFieldDocument
)
