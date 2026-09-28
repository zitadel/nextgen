package domain

import (
	"encoding/json"
	"fmt"
	"strings"
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
// subject_claim does not depend on the protocol, so it is always compared. On
// a protocol change the endpoint fields are skipped: those of two protocols
// are not comparable. The order is protocol, subject_claim, then endpoints.
func IDPConnectionImmutableFieldsChanged(stored, next []byte) ([]string, error) {
	before, err := parseIDPConnectionDocument(stored)
	if err != nil {
		return nil, err
	}
	after, err := parseIDPConnectionDocument(next)
	if err != nil {
		return nil, err
	}
	var changed []string
	protocolChanged := !sameString(before.Protocol, after.Protocol)
	if protocolChanged {
		changed = append(changed, "protocol")
	}
	if !sameString(before.SubjectClaim, after.SubjectClaim) {
		changed = append(changed, "subject_claim")
	}
	if protocolChanged {
		return changed, nil
	}
	for _, field := range []struct {
		path          string
		before, after *string
	}{
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

// ErrIDPDiscoveryFailed reports that the provider's discovery document could
// not serve the connection: the fetch failed or timed out, the body did not
// parse, the issuer differs from the configured one, or a needed endpoint
// is absent. The user sees the same generic error as for a misconfigured
// provider; the separate code lets the log tell an unreachable or malformed
// provider from a rejected client. cause is log-only.
func ErrIDPDiscoveryFailed(cause error) Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("discovery_failed"), "identity provider connection: discovery failed", nil, cause)
}

// The following errors re-check at the start of an attempt what the schema enforced at
// write time (defense in depth). Each is a distinct kind, so the log names
// the rule; the user sees the generic misconfigured-provider error. Where a
// rule applies to one of several fields, details names the field for the
// client and the parent names it for the log; a value never appears in
// either. The messages stay literal so the error schema generator sees them.

// ErrIDPProtocolBlockMissing reports a document whose protocol names a block
// the document does not carry. protocol is the schema enum value.
func ErrIDPProtocolBlockMissing(protocol string) Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("protocol_block_missing"), "identity provider connection: the protocol block is missing", map[string]any{"protocol": protocol}, fmt.Errorf("%s block is missing", protocol))
}

func ErrIDPScopesMissingOpenID() Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("scopes_missing_openid"), "identity provider connection: OIDC scopes must contain openid", nil, nil)
}

// ErrIDPEndpointCleartext reports an endpoint that is not https and not on
// localhost. field is the schema field name; the URL itself never appears.
func ErrIDPEndpointCleartext(field string) Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("endpoint_cleartext"), "identity provider connection: an endpoint is not https", map[string]any{"field": field}, fmt.Errorf("%s is not https", field))
}

// ErrIDPEndpointsPartial rejects an OIDC block that names some of the
// endpoints the connection needs but not all.
func ErrIDPEndpointsPartial(missing []string) Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("endpoints_partial"), "identity provider connection: the endpoints are partially set", map[string]any{"missing": missing}, fmt.Errorf("missing endpoints: %s", strings.Join(missing, ", ")))
}

// ErrIDPOAuth2Unsupported refuses a stored oauth2 connection: the schema
// accepts the protocol, but the engine does not serve it yet (#1066).
func ErrIDPOAuth2Unsupported() Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("oauth2_unsupported"), "identity provider connection: the oauth2 protocol is not supported yet", nil, nil)
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
