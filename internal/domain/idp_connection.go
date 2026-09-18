package domain

import (
	"fmt"
	"strings"
)

// PrefixIDPConnection namespaces connection ids ("idp_01KWH3B..."), the id an
// identity link references. Revisions carry their own prefix, registered with
// the storage layer that allocates them, and are what attempts and releases pin.
const PrefixIDPConnection ResourcePrefix = "idp"

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

// The callback errors below end an attempt after the user authenticated at
// the provider. Each is a distinct kind, so the log tells the steps apart; the
// user sees the generic exchange-failure error. cause is log-only and may
// carry provider-served text, never a token, secret, or claim value.

// ErrIDPExchangeFailed reports that the code exchange yielded no token. One
// code covers the whole step, as discovery_failed does: the token endpoint
// answered with an error such as invalid_grant or with a non-conformant
// body, or no answer arrived because the address was denied, the connection
// failed, or an egress cap struck.
func ErrIDPExchangeFailed(cause error) Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("exchange_failed"), "identity provider connection: the code exchange failed", nil, cause)
}
