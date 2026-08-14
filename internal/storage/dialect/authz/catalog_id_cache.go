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

func cachedActiveSystemCatalogID() (string, bool) {
	id, ok := activeSystemCatalog.Load().(string)
	return id, ok && id != ""
}

func rememberActiveSystemCatalogID(id string) {
	if id == "" {
		return
	}
	activeSystemCatalog.Store(id)
}

func invalidateActiveSystemCatalogID() {
	activeSystemCatalog.Store("")
}

// LoadOrFetchActiveSystemCatalogID returns the cached id, or fetch() once and
// remembers it. Concurrent first loads share one fetch.
func LoadOrFetchActiveSystemCatalogID(fetch func() (string, error)) (string, error) {
	if id, ok := cachedActiveSystemCatalogID(); ok {
		return id, nil
	}
	activeSystemCatalogMu.Lock()
	defer activeSystemCatalogMu.Unlock()
	if id, ok := cachedActiveSystemCatalogID(); ok {
		return id, nil
	}
	id, err := fetch()
	if err != nil {
		return "", err
	}
	rememberActiveSystemCatalogID(id)
	return id, nil
}

// BeforePersistCatalogVersion drops the system-catalog cache when a system
// catalog is about to be published.
func BeforePersistCatalogVersion(kind domain.AuthzCatalogKind) {
	if kind == domain.AuthzCatalogKindSystem {
		invalidateActiveSystemCatalogID()
	}
}

// AfterPersistCatalogVersion remembers the new system catalog id after a
// successful persist.
func AfterPersistCatalogVersion(kind domain.AuthzCatalogKind, id string) {
	if kind == domain.AuthzCatalogKindSystem {
		rememberActiveSystemCatalogID(id)
	}
}
