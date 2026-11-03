package domain

// PrefixOAuthGrant names one authorization of an OAuth client by a user: the
// code it starts with and every refresh token rotated from it carry the
// grant's id, so revoking the grant ends them all (ADR 037).
const PrefixOAuthGrant ResourcePrefix = "ogrant"
