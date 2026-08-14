package authz

import (
	"sync"
	"sync/atomic"

	"github.com/zitadel/nextgen/internal/domain"
)

var (
	activeSystemCatalog   atomic.Value // string
	activeSystemCatalogMu sync.Mutex
)

// CachedActiveSystemCatalogID returns the process-cached active system catalog
// id when one has been loaded.
func CachedActiveSystemCatalogID() (string, bool) {
	id, ok := activeSystemCatalog.Load().(string)
	return id, ok && id != ""
}

// RememberActiveSystemCatalogID stores the active system catalog id.
func RememberActiveSystemCatalogID(id string) {
	if id == "" {
		return
	}
	activeSystemCatalog.Store(id)
}

// InvalidateActiveSystemCatalogID drops the process cache. Call when a new
// system catalog becomes active (PersistCatalogVersion retires the previous
// row). A cache that never invalidates would Check against a retired catalog.
func InvalidateActiveSystemCatalogID() {
	activeSystemCatalog.Store("")
}

// LoadOrFetchActiveSystemCatalogID returns the cached id, or fetch() once and
// remembers it. Concurrent first loads share one fetch.
func LoadOrFetchActiveSystemCatalogID(fetch func() (string, error)) (string, error) {
	if id, ok := CachedActiveSystemCatalogID(); ok {
		return id, nil
	}
	activeSystemCatalogMu.Lock()
	defer activeSystemCatalogMu.Unlock()
	if id, ok := CachedActiveSystemCatalogID(); ok {
		return id, nil
	}
	id, err := fetch()
	if err != nil {
		return "", err
	}
	RememberActiveSystemCatalogID(id)
	return id, nil
}

// BeforePersistCatalogVersion drops the system-catalog cache when a system
// catalog is about to be published.
func BeforePersistCatalogVersion(kind domain.AuthzCatalogKind) {
	if kind == domain.AuthzCatalogKindSystem {
		InvalidateActiveSystemCatalogID()
	}
}

// AfterPersistCatalogVersion remembers the new system catalog id after a
// successful persist.
func AfterPersistCatalogVersion(kind domain.AuthzCatalogKind, id string) {
	if kind == domain.AuthzCatalogKindSystem {
		RememberActiveSystemCatalogID(id)
	}
}
