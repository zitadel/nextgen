package database_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestIdentity_Scan(t *testing.T) {
	t.Run("nil", func(t *testing.T) {
		var id database.Identity
		require.NoError(t, id.Scan(nil))
		assert.Equal(t, database.Identity(""), id)
	})

	t.Run("int64", func(t *testing.T) {
		var id database.Identity
		require.NoError(t, id.Scan(int64(3458764513820540928)))
		assert.Equal(t, database.Identity("3458764513820540928"), id)
	})

	t.Run("string", func(t *testing.T) {
		var id database.Identity
		require.NoError(t, id.Scan("user_abc"))
		assert.Equal(t, database.Identity("user_abc"), id)
	})

	t.Run("bytes", func(t *testing.T) {
		var id database.Identity
		require.NoError(t, id.Scan([]byte("42")))
		assert.Equal(t, database.Identity("42"), id)
	})
}

func TestIdentity_Value(t *testing.T) {
	t.Run("empty is null", func(t *testing.T) {
		v, err := database.Identity("").Value()
		require.NoError(t, err)
		assert.Nil(t, v)
	})

	t.Run("numeric binds int64", func(t *testing.T) {
		v, err := database.Identity("42").Value()
		require.NoError(t, err)
		assert.Equal(t, int64(42), v)
	})

	t.Run("prefixed string binds string", func(t *testing.T) {
		v, err := database.Identity("user_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C").Value()
		require.NoError(t, err)
		assert.Equal(t, "user_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C", v)
	})
}

func TestIdentity_IsNumeric(t *testing.T) {
	assert.True(t, database.Identity("1").IsNumeric())
	assert.False(t, database.Identity("user_abc").IsNumeric())
	assert.False(t, database.Identity("").IsNumeric())
}
