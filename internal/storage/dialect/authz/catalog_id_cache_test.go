package authz

import (
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestLoadOrFetchActiveSystemCatalogID(t *testing.T) {
	t.Cleanup(invalidateActiveSystemCatalogID)
	invalidateActiveSystemCatalogID()

	var fetches atomic.Int32
	fetch := func() (string, error) {
		fetches.Add(1)
		return "cat_sys_cached", nil
	}

	id, err := LoadOrFetchActiveSystemCatalogID(fetch)
	require.NoError(t, err)
	assert.Equal(t, "cat_sys_cached", id)

	id, err = LoadOrFetchActiveSystemCatalogID(fetch)
	require.NoError(t, err)
	assert.Equal(t, "cat_sys_cached", id)
	assert.Equal(t, int32(1), fetches.Load(), "second load must not hit fetch")

	invalidateActiveSystemCatalogID()
	AfterPersistCatalogVersion(domain.AuthzCatalogKindSystem, "cat_sys_next")
	id, err = LoadOrFetchActiveSystemCatalogID(func() (string, error) {
		t.Fatal("fetch must not run after persist")
		return "", nil
	})
	require.NoError(t, err)
	assert.Equal(t, "cat_sys_next", id)
}

func TestPersistCatalogVersionCacheHooksIgnoreAppGroup(t *testing.T) {
	t.Cleanup(invalidateActiveSystemCatalogID)
	rememberActiveSystemCatalogID("cat_sys_1")
	BeforePersistCatalogVersion(domain.AuthzCatalogKindAppGroup)
	id, ok := cachedActiveSystemCatalogID()
	require.True(t, ok)
	assert.Equal(t, "cat_sys_1", id)
	AfterPersistCatalogVersion(domain.AuthzCatalogKindAppGroup, "cat_app_1")
	id, ok = cachedActiveSystemCatalogID()
	require.True(t, ok)
	assert.Equal(t, "cat_sys_1", id)
}
