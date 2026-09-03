package authz

// ManagedGrantListConjunct is ANDed into the managed-grants list SELECT so
// setup (sk_proj) and owning-team (relation=team) rows cannot leak into a
// page. Literals are portable across postgres, sqlite, and spanner.
const ManagedGrantListConjunct = `revoked_at IS NULL AND object_type = 'project' AND principal_type IN ('user', 'team') AND relation IN ('viewer', 'editor', 'admin')`
