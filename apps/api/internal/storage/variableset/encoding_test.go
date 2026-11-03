package variableset_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/variableset"
)

const ciphertext = "eyJhbGciOiJBMjU2R0NNS1ciLCJraWQiOiJrZXktMSJ9.encrypted.value"

func TestRoundTrip(t *testing.T) {
	t.Parallel()

	owner := domain.VariableOwner{ProjectID: "proj_1"}
	set, err := domain.NewVariableSet("proj_1", []*domain.Variable{
		{Name: "retries", Owner: owner, Value: 3},
		{Name: "client_secret", Owner: owner, Value: ciphertext, IsSecret: true},
		{Name: "verbose", Owner: owner, Value: true},
		{Name: "api_url", Owner: owner, Value: "https://api.example.test"},
	})
	require.NoError(t, err)

	raw, err := variableset.MarshalEntries(set.Entries)
	require.NoError(t, err)
	assert.JSONEq(t, `{
		"api_url": {"value": "https://api.example.test"},
		"client_secret": {"value": "`+ciphertext+`", "secret": true},
		"retries": {"value": 3},
		"verbose": {"value": true}
	}`, string(raw))

	got, err := variableset.ToDomain(variableset.Row{
		ProjectID: "proj_1",
		Hash:      set.Hash,
		Entries:   raw,
	})
	require.NoError(t, err)

	// Order and values survive, so the stored set re-hashes to the stored
	// hash: the number comes back as the float64 it was widened to and the
	// ciphertext comes back verbatim.
	assert.Equal(t, set.Entries, got.Entries)
	hash, err := domain.VariableSetHash(got.Entries)
	require.NoError(t, err)
	assert.Equal(t, set.Hash, hash)
	assert.Equal(t, "proj_1", got.ProjectID)
}

// A project with no variables freezes the empty set. It is the empty object
// rather than null, which is what the entries column CHECK admits.
func TestMarshalEntriesEmptySetIsAnObject(t *testing.T) {
	t.Parallel()

	raw, err := variableset.MarshalEntries(nil)
	require.NoError(t, err)
	assert.JSONEq(t, `{}`, string(raw))

	got, err := variableset.ToDomain(variableset.Row{Entries: raw})
	require.NoError(t, err)
	assert.Empty(t, got.Entries)
}

// Key order in the column is whatever the database normalized it to; the
// entries come back sorted by name regardless.
func TestToDomainSortsByName(t *testing.T) {
	t.Parallel()

	got, err := variableset.ToDomain(variableset.Row{
		Entries: []byte(`{"zeta":{"value":1},"alpha":{"value":2},"mid":{"value":3,"secret":false}}`),
	})
	require.NoError(t, err)

	names := make([]string, 0, len(got.Entries))
	for _, e := range got.Entries {
		names = append(names, e.Name)
	}
	assert.Equal(t, []string{"alpha", "mid", "zeta"}, names)
}

// The entry document is open-ended by design: a field added by a newer server
// must not stop an older one reading a set.
func TestToDomainIgnoresUnknownEntryFields(t *testing.T) {
	t.Parallel()

	got, err := variableset.ToDomain(variableset.Row{
		Entries: []byte(`{"token":{"value":"` + ciphertext + `","secret":true,"key_id":"key-1"}}`),
	})
	require.NoError(t, err)
	require.Len(t, got.Entries, 1)
	assert.Equal(t, ciphertext, got.Entries[0].Value)
	assert.True(t, got.Entries[0].IsSecret)
}

func TestToDomainRejectsMalformedEntries(t *testing.T) {
	t.Parallel()

	_, err := variableset.ToDomain(variableset.Row{Entries: []byte(`["not","an","object"]`)})
	require.Error(t, err)
}
