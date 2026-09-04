package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/crypto"
)

// decodeDoc keeps the fixtures readable and, more usefully, makes them the same
// shape a document arriving over the wire would have.
func decodeDoc(t *testing.T, payload string) map[string]any {
	t.Helper()
	var doc map[string]any
	require.NoError(t, json.Unmarshal([]byte(payload), &doc))
	return doc
}

func plainVar(t *testing.T, name string, value any) *Variable {
	t.Helper()
	v, err := NewVariable(name, VariableOwner{ProjectID: "p"}, value)
	require.NoError(t, err)
	return v
}

func TestScanDocumentForVariables(t *testing.T) {
	t.Parallel()

	t.Run("records an address per placeholder through maps and slices", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{
			"a": "${{ one }}",
			"nested": {"b": "${{ two }}"},
			"list": ["${{ three }}", "literal", {"c": "${{ four }}"}]
		}`)

		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)

		byPlaceholder := make(map[string][]any, len(found))
		for _, f := range found {
			byPlaceholder[f.Placeholder] = f.Address
		}

		assert.Equal(t, []any{"a"}, byPlaceholder["one"])
		assert.Equal(t, []any{"nested", "b"}, byPlaceholder["two"])
		assert.Equal(t, []any{"list", 0}, byPlaceholder["three"])
		assert.Equal(t, []any{"list", 2, "c"}, byPlaceholder["four"])
	})

	// Each level builds its children's addresses with append, and append reuses
	// the backing array once a slice has spare capacity. Without a copy, every
	// sibling below that point is recorded at the same address -- so one field
	// gets written repeatedly and the rest silently keep their placeholder.
	t.Run("gives siblings distinct addresses deep in the document", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{"a":{"b":{"c":{"k1":"${{ v }}","k2":"${{ v }}","k3":"${{ v }}"}}}}`)

		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)
		require.Len(t, found, 3)

		leaves := make(map[string]bool, len(found))
		for _, f := range found {
			assert.Equal(t, []any{"a", "b", "c"}, f.Address[:3], "the shared prefix is intact")
			leaves[f.Address[3].(string)] = true
		}
		assert.Equal(t, map[string]bool{"k1": true, "k2": true, "k3": true}, leaves,
			"each sibling needs its own address")
	})

	t.Run("ignores text that is not exactly one placeholder", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{
			"embedded": "prefix ${{ v }} suffix",
			"plain":    "no placeholder",
			"dollars":  "$5.00",
			"jsonref":  "#/$defs/user",
			"single":   "${ v }",
			"empty":    "${{ }}",
			"dotted":   "${{ a.b }}"
		}`)

		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)
		assert.Empty(t, found, "only a whole-value ${{ name }} is a reference")
	})

	t.Run("accepts optional inner spacing", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{"tight":"${{v}}","spaced":"${{   v   }}"}`)

		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)
		assert.Len(t, found, 2)
	})

	t.Run("refuses a document that nests too deeply", func(t *testing.T) {
		t.Parallel()

		depth := maxDocumentDepth + 5
		payload := strings.Repeat(`{"n":`, depth) + `"${{ v }}"` + strings.Repeat(`}`, depth)

		_, err := ScanDocumentForVariables(decodeDoc(t, payload))
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrVariableDocumentTooDeep())
	})

	// A document cannot contain itself if it came from JSON, but one built in
	// memory can, and the depth guard is what stops that recursing forever.
	t.Run("refuses a cyclic document", func(t *testing.T) {
		t.Parallel()

		doc := map[string]any{"name": "${{ v }}"}
		doc["self"] = doc

		_, err := ScanDocumentForVariables(doc)
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrVariableDocumentTooDeep())
	})
}

func TestReplaceVariablesInDocument(t *testing.T) {
	t.Parallel()

	replace := func(t *testing.T, doc map[string]any, vars ...*Variable) error {
		t.Helper()
		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)
		vm := VariableListToMap(vars)
		decrypted, err := Variables(vm).DecryptAll(&crypto.InverseCrypter{})
		if err != nil {
			return err
		}
		return ReplaceVariablesInDocument(doc, found, decrypted)
	}

	t.Run("writes values at every address, keeping their type", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{
			"url":  "${{ url }}",
			"port": "${{ port }}",
			"tls":  "${{ tls }}",
			"deep": {"list": ["${{ url }}", {"again": "${{ port }}"}]}
		}`)

		require.NoError(t, replace(t, doc,
			plainVar(t, "url", "https://example.test"),
			plainVar(t, "port", 8080),
			plainVar(t, "tls", true),
		))

		assert.Equal(t, "https://example.test", doc["url"])
		// A whole-value reference keeps the variable's Go type rather than
		// becoming text, which is the point of replacing on a decoded document.
		assert.Equal(t, 8080, doc["port"])
		assert.Equal(t, true, doc["tls"])

		list := doc["deep"].(map[string]any)["list"].([]any)
		assert.Equal(t, "https://example.test", list[0], "a slice element is written in place")
		assert.Equal(t, 8080, list[1].(map[string]any)["again"])
	})

	t.Run("leaves a placeholder whose variable is not held", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{"known":"${{ known }}","unknown":"${{ nope }}"}`)

		require.NoError(t, replace(t, doc, plainVar(t, "known", "value")))

		assert.Equal(t, "value", doc["known"])
		assert.Equal(t, "${{ nope }}", doc["unknown"], "an unresolved reference keeps its text")
	})

	t.Run("decrypts a secret before writing it", func(t *testing.T) {
		t.Parallel()

		crypter := &crypto.InverseCrypter{}
		secret, err := NewSecretVariable("token", VariableOwner{ProjectID: "p"}, "s3cret", crypter)
		require.NoError(t, err)
		require.NotEqual(t, "s3cret", secret.Value)

		doc := decodeDoc(t, `{"token":"${{ token }}"}`)
		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)

		vars := VariableListToMap([]*Variable{secret})
		decrypted, err := Variables(vars).DecryptAll(crypter)
		require.NoError(t, err)
		require.NoError(t, ReplaceVariablesInDocument(doc, found, decrypted))
		assert.Equal(t, "s3cret", doc["token"])
	})

	// Decryption happens before replacement now, so this is DecryptAll's to
	// report -- and it has to fail loudly rather than write ciphertext into the
	// document.
	t.Run("reports a secret it cannot decrypt", func(t *testing.T) {
		t.Parallel()

		// Flagged secret, but the value is not something the crypter produced.
		broken := &Variable{Name: "token", Owner: VariableOwner{ProjectID: "p"}, Value: "not-ciphertext", IsSecret: true}

		_, err := Variables(VariableListToMap([]*Variable{broken})).DecryptAll(&crypto.InverseCrypter{})
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrFailedToDecryptVariable(nil))
	})

	// Substitution cannot recurse: the scan already ran, so a value that looks
	// like a placeholder is written as text and never looked at again.
	t.Run("does not rescan a written value", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{"x":"${{ a }}"}`)

		require.NoError(t, replace(t, doc,
			plainVar(t, "a", "${{ b }}"),
			plainVar(t, "b", "resolved"),
		))
		assert.Equal(t, "${{ b }}", doc["x"])
	})

	t.Run("refuses a document that would expand beyond the budget", func(t *testing.T) {
		t.Parallel()

		// One variable at the size cap, named at enough addresses that the
		// document it renders would dwarf the one that asked for it.
		big := plainVar(t, "big", strings.Repeat("A", MaxVariableStringLength))

		fields := make(map[string]any, 200)
		for i := range 200 {
			fields[string(rune('a'+i%26))+string(rune('a'+i/26))] = "${{ big }}"
		}

		found, err := ScanDocumentForVariables(fields)
		require.NoError(t, err)

		err = ReplaceVariablesInDocument(fields, found, VariableListToMap([]*Variable{big}))
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrVariableExpansionTooLarge())
	})

	t.Run("allows a document that stays inside the budget", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{"a":"${{ v }}","b":"${{ v }}","c":"${{ v }}"}`)

		require.NoError(t, replace(t, doc, plainVar(t, "v", strings.Repeat("A", 1024))))
		assert.Len(t, doc["a"], 1024)
	})
}

func TestVariableListToMap(t *testing.T) {
	t.Parallel()

	project := VariableOwner{ProjectID: "p"}
	env := VariableOwner{ProjectID: "p", EnvironmentName: "e"}
	team := VariableOwner{ProjectID: "p", EnvironmentName: "e", TeamID: "t"}
	schema := VariableOwner{ProjectID: "p", EnvironmentName: "e", TeamID: "t", UserSchemaID: "s"}
	user := VariableOwner{ProjectID: "p", EnvironmentName: "e", TeamID: "t", UserSchemaID: "s", UserID: "u"}

	// Storage returns the whole ladder because variables do not override each
	// other; collapsing it is what picks the value a document actually gets.
	t.Run("keeps the nearest owner regardless of input order", func(t *testing.T) {
		t.Parallel()

		for _, order := range [][]*Variable{
			{{Name: "v", Owner: project, Value: "project"}, {Name: "v", Owner: user, Value: "user"}},
			{{Name: "v", Owner: user, Value: "user"}, {Name: "v", Owner: project, Value: "project"}},
			{{Name: "v", Owner: env, Value: "env"}, {Name: "v", Owner: team, Value: "team"}, {Name: "v", Owner: user, Value: "user"}, {Name: "v", Owner: project, Value: "project"}},
		} {
			got := VariableListToMap(order)
			assert.Equal(t, "user", got["v"].Value)
		}
	})

	t.Run("ranks every level of the ladder", func(t *testing.T) {
		t.Parallel()

		assert.True(t, project.IsMoreSpecificThan(VariableOwner{}))
		assert.True(t, env.IsMoreSpecificThan(project))
		assert.True(t, team.IsMoreSpecificThan(env))
		assert.True(t, schema.IsMoreSpecificThan(team))
		assert.True(t, user.IsMoreSpecificThan(schema))

		assert.False(t, project.IsMoreSpecificThan(env))
		assert.False(t, env.IsMoreSpecificThan(team))
		assert.False(t, team.IsMoreSpecificThan(user))
		assert.False(t, user.IsMoreSpecificThan(user), "an equal owner is not more specific")
	})

	t.Run("keeps distinct names apart", func(t *testing.T) {
		t.Parallel()

		got := VariableListToMap([]*Variable{
			{Name: "a", Owner: project, Value: "a"},
			{Name: "b", Owner: user, Value: "b"},
		})
		assert.Len(t, got, 2)
	})
}
