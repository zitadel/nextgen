package domain

import (
	"encoding/json"
	"time"
)

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

// ErrIDPConnectionPermissionDenied answers a caller whose project grant does
// not reach the operation, such as a viewer revising a connection.
func ErrIDPConnectionPermissionDenied() Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("permission_denied"), "identity provider connection: the caller's project role does not allow this operation", nil, nil)
}

// ErrIDPConnectionRevisionConflict reports a revision that landed on the same
// instant as another revision of the same connection, so neither is newest.
func ErrIDPConnectionRevisionConflict() Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("revision_conflict"), "identity provider connection: another revision of the same connection was created at the same instant", nil, nil)
}

// idpConnectionDocument holds the few document fields the server reads. The
// rest of the document belongs to the API contract and stays opaque here.
type idpConnectionDocument struct {
	Protocol     *string `json:"protocol"`
	SubjectClaim *string `json:"subject_claim"`
	Template     *string `json:"template"`
	DisplayName  string  `json:"display_name"`
	OIDC         struct {
		Issuer *string `json:"issuer"`
	} `json:"oidc"`
	OAuth2 struct {
		TokenEndpoint    *string `json:"token_endpoint"`
		UserinfoEndpoint *string `json:"userinfo_endpoint"`
	} `json:"oauth2"`
}

func parseIDPConnectionDocument(document []byte) (idpConnectionDocument, error) {
	var doc idpConnectionDocument
	err := json.Unmarshal(document, &doc)
	return doc, err
}

// IDPConnectionImmutableFieldsChanged returns the dotted paths of the identity
// fields that next changes against stored (see ErrIDPConnectionFieldImmutable).
// Values are compared as written, so an absent subject_claim and "sub" differ.
// A protocol change reports only protocol: the endpoint fields of two
// protocols are not comparable.
func IDPConnectionImmutableFieldsChanged(stored, next []byte) ([]string, error) {
	before, err := parseIDPConnectionDocument(stored)
	if err != nil {
		return nil, err
	}
	after, err := parseIDPConnectionDocument(next)
	if err != nil {
		return nil, err
	}
	if !sameString(before.Protocol, after.Protocol) {
		return []string{"protocol"}, nil
	}
	var changed []string
	for _, field := range []struct {
		path          string
		before, after *string
	}{
		{"subject_claim", before.SubjectClaim, after.SubjectClaim},
		{"oidc.issuer", before.OIDC.Issuer, after.OIDC.Issuer},
		{"oauth2.token_endpoint", before.OAuth2.TokenEndpoint, after.OAuth2.TokenEndpoint},
		{"oauth2.userinfo_endpoint", before.OAuth2.UserinfoEndpoint, after.OAuth2.UserinfoEndpoint},
	} {
		if !sameString(field.before, field.after) {
			changed = append(changed, field.path)
		}
	}
	return changed, nil
}

func sameString(a, b *string) bool {
	return a == b || (a != nil && b != nil && *a == *b)
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
