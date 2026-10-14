package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// The ciphertext a secret holds is a compact JWE; the hash covers it verbatim.
const variableSetCiphertext = "eyJhbGciOiJBMjU2R0NNS1ciLCJraWQiOiJrZXktMSJ9.encrypted.value"

// variableSetVariables is a read of one project and kind: unique names, in
// whatever order the rows came back.
func variableSetVariables() []*domain.Variable {
	owner := domain.VariableOwner{ProjectID: "proj_1"}
	return []*domain.Variable{
		{Name: "retries", Owner: owner, Value: 3},
		{Name: "client_secret", Owner: owner, Value: variableSetCiphertext, IsSecret: true},
		{Name: "verbose", Owner: owner, Value: true},
		{Name: "api_url", Owner: owner, Value: "https://api.example.test"},
	}
}

func TestNewVariableSet(t *testing.T) {
	t.Parallel()

	set, err := domain.NewVariableSet("proj_1", variableSetVariables())
	require.NoError(t, err)

	assert.Equal(t, "proj_1", set.ProjectID)
	assert.Len(t, set.Hash, 64)

	// Sorted by name, which is the order the hash covers the entries in, and
	// numbers widened to what a JSON column reads back as.
	assert.Equal(t, []domain.VariableSetEntry{
		{Name: "api_url", Value: "https://api.example.test"},
		{Name: "client_secret", Value: variableSetCiphertext, IsSecret: true},
		{Name: "retries", Value: float64(3)},
		{Name: "verbose", Value: true},
	}, set.Entries)

	// The entries re-hash to the set's own hash, which is what the storage
	// round-trip relies on.
	hash, err := domain.VariableSetHash(set.Entries)
	require.NoError(t, err)
	assert.Equal(t, set.Hash, hash)
}

// TestVariableSetHashIsGolden pins the canonical form. The hash is the address
// of every set ever frozen, so changing how it is derived would silently stop
// deployments sharing the sets they already share -- this literal is what
// makes such a change fail loudly instead.
func TestVariableSetHashIsGolden(t *testing.T) {
	t.Parallel()

	set, err := domain.NewVariableSet("proj_1", variableSetVariables())
	require.NoError(t, err)
	assert.Equal(t, "95339f0c862f3e6cbf8ccc1941ac93003622ce4dfe1853f5ac8cbbf63e4d7d8c", set.Hash)
}

// A project with no variables still freezes a set, so every deployment has
// one to read; the empty set has one address.
func TestVariableSetHashOfEmptySetIsConstant(t *testing.T) {
	t.Parallel()

	set, err := domain.NewVariableSet("proj_1", nil)
	require.NoError(t, err)
	assert.Empty(t, set.Entries)
	assert.Equal(t, "697bfc5485e20f89ddeba3666f375f0d42268f76b8181aa0c8fee30bd48c7b4d", set.Hash)

	hash, err := domain.VariableSetHash(nil)
	require.NoError(t, err)
	assert.Equal(t, set.Hash, hash)
}

func TestVariableSetHashIgnoresInputOrder(t *testing.T) {
	t.Parallel()

	ordered, err := domain.NewVariableSet("proj_1", variableSetVariables())
	require.NoError(t, err)

	shuffled := variableSetVariables()
	shuffled[0], shuffled[3] = shuffled[3], shuffled[0]
	reordered, err := domain.NewVariableSet("proj_1", shuffled)
	require.NoError(t, err)

	assert.Equal(t, ordered.Hash, reordered.Hash)
}

// TestVariableSetHashSeparatesFields guards the length-prefixed preimage. The
// preimage of an entry is its name, its secret flag as "0" or "1", and its
// canonical value, which for a secret is the ciphertext verbatim. Joined
// without lengths, both entries here read "a" + "1" + "1bc" = "a1" + "1" +
// "bc" = "a11bc": the name's trailing "1" is indistinguishable from the flag,
// and the value's leading "1" from it. The lengths are what tell them apart.
func TestVariableSetHashSeparatesFields(t *testing.T) {
	t.Parallel()

	left, err := domain.VariableSetHash([]domain.VariableSetEntry{{Name: "a", Value: "1bc", IsSecret: true}})
	require.NoError(t, err)
	right, err := domain.VariableSetHash([]domain.VariableSetEntry{{Name: "a1", Value: "bc", IsSecret: true}})
	require.NoError(t, err)

	assert.NotEqual(t, left, right)
}

// A secret and a plain value holding the same string are different sets: the
// flag is part of the preimage, so a value cannot change its secrecy and keep
// its address.
func TestVariableSetHashCoversTheSecretFlag(t *testing.T) {
	t.Parallel()

	plain, err := domain.VariableSetHash([]domain.VariableSetEntry{{Name: "token", Value: variableSetCiphertext}})
	require.NoError(t, err)
	secret, err := domain.VariableSetHash([]domain.VariableSetEntry{{Name: "token", Value: variableSetCiphertext, IsSecret: true}})
	require.NoError(t, err)

	assert.NotEqual(t, plain, secret)
}

// A number is frozen from a fresh write as whatever Go type the request
// decoded to, and read back from a JSON column as float64. Both must address
// the same set, or a deploy right after a write would never share a set with
// the deploy after it.
func TestVariableSetHashWidensNumbers(t *testing.T) {
	t.Parallel()

	hashes := make(map[string]struct{})
	for _, value := range []any{3, int64(3), float64(3), uint8(3), float32(3)} {
		hash, err := domain.VariableSetHash([]domain.VariableSetEntry{{Name: "retries", Value: value}})
		require.NoError(t, err)
		hashes[hash] = struct{}{}
	}
	assert.Len(t, hashes, 1, "every number type must hash as its float64 value")

	// A value of another type is still its own set: 3 and "3" differ.
	asString, err := domain.VariableSetHash([]domain.VariableSetEntry{{Name: "retries", Value: "3"}})
	require.NoError(t, err)
	_, same := hashes[asString]
	assert.False(t, same)
}

func TestNewVariableSetRejects(t *testing.T) {
	t.Parallel()

	owner := domain.VariableOwner{ProjectID: "proj_1"}

	// The read admits one owner and kind and the primary key makes a name
	// unique within it, so two entries under one name mean a broken read,
	// not a tie to break.
	t.Run("a duplicate name", func(t *testing.T) {
		t.Parallel()

		_, err := domain.NewVariableSet("proj_1", []*domain.Variable{
			{Name: "theme", Owner: owner, Value: "dark"},
			{Name: "theme", Owner: owner, Value: "light"},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})

	// The hash covers a secret's ciphertext, which the secret constructor
	// always produces as a string; anything else cannot be what a key wrote.
	t.Run("a secret that is not its ciphertext", func(t *testing.T) {
		t.Parallel()

		_, err := domain.NewVariableSet("proj_1", []*domain.Variable{
			{Name: "token", Owner: owner, Value: 42, IsSecret: true},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})

	t.Run("a value no variable can hold", func(t *testing.T) {
		t.Parallel()

		_, err := domain.NewVariableSet("proj_1", []*domain.Variable{
			{Name: "nested", Owner: owner, Value: map[string]any{"a": 1}},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})
}

// Variables hands the set back in the shape a live read has, so the set can
// replace placeholders and decrypt secrets through the same code.
func TestVariableSetVariables(t *testing.T) {
	t.Parallel()

	set, err := domain.NewVariableSet("proj_1", variableSetVariables())
	require.NoError(t, err)

	vars := set.Variables()
	require.Len(t, vars, 4)

	assert.Equal(t, &domain.Variable{
		Name:     "client_secret",
		Owner:    domain.VariableOwner{ProjectID: "proj_1"},
		Value:    variableSetCiphertext,
		IsSecret: true,
	}, vars["client_secret"])
	assert.Equal(t, float64(3), vars["retries"].Value)
}
