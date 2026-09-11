package domain

// PrefixIDPConnection namespaces connection ids ("idp_01KWH3B..."), the id a
// release pins and an identity link references. Revisions carry their own
// prefix, registered with the storage layer that allocates them.
const PrefixIDPConnection ResourcePrefix = "idp"

func ErrIDPConnectionNotFound() Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("not_found"), "identity provider connection: not found", nil, nil)
}

// ErrIDPConnectionFieldImmutable rejects a revision that changes a field the
// connection is identified by: slug, protocol, subject_claim, and the field
// naming the authority, which is issuer for OIDC and token_endpoint with
// userinfo_endpoint for OAuth 2.0. Those values decide which provider account
// a stored subject belongs to, so changing one would repoint existing
// identities rather than reconfigure them. details names the offending field.
func ErrIDPConnectionFieldImmutable(details any) Error {
	return newError(PrefixIDPConnection.ErrorCodePrefix("field_immutable"), "identity provider connection: the field is fixed for the life of the connection", details, nil)
}
