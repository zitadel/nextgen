package configfs

import (
	"github.com/zitadel/nextgen/internal/service"
)

// configStatements serves the configuration kinds from the file tree.
//
// It is not a whole statements implementation: it holds the two SQL-backed
// collaborators a file-backed config resource still needs, because two of the
// facts a configuration write produces are not configuration.
//
//   - rsi keeps resource_scope_index in step. That index is how a by-id
//     management gate resolves which project a path id belongs to before the
//     permission check runs, so a schema whose file exists but whose scope row
//     does not is a schema nobody can read (ADR 033).
//   - resolver answers which ids a partially-authorized caller may list. The
//     predicate is an EXISTS over assignments and scope rows, so it can only be
//     answered where those rows live.
//
// Content moves to the filesystem; authorization does not.
type configStatements struct {
	store    *Store
	rsi      service.ResourceScopeStatements
	resolver service.AuthzResolverStatements
}

// Statements composes the file-backed configuration kinds over a SQL
// statements implementation.
//
// Go resolves the shallower method first, so the methods declared on Statements
// itself win over the ones promoted from the embedded AllStatements. That is
// the whole routing mechanism: naming a method here moves that one call to the
// file tree and leaves every other call on SQL, with no dispatch table to fall
// out of step with the interface.
//
// A kind added to the file tree therefore needs its methods declared on this
// type. A kind that is not declared here keeps working against SQL untouched,
// which is the intended default for everything that is not CLI-authored
// configuration.
type Statements struct {
	service.AllStatements
	config *configStatements
}

// NewStatements wraps sql with the configuration tree at store.
func NewStatements(sql service.AllStatements, store *Store) *Statements {
	return &Statements{
		AllStatements: sql,
		config: &configStatements{
			store:    store,
			rsi:      sql,
			resolver: sql,
		},
	}
}

var _ service.AllStatements = (*Statements)(nil)
