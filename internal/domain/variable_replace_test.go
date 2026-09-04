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

	t.Run("binds a placeholder to the value it was found in, through maps and slices", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{
			"a": "${{ one }}",
			"nested": {"b": "${{ two }}"},
			"list": ["${{ three }}", "literal", {"c": "${{ four }}"}]
		}`)

		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)
		require.Len(t, found, 4)

		for _, f := range found {
			assert.Equal(t, "${{ "+f.VariableName+" }}", f.Value, "the placeholder carries its own text")
			require.NotNil(t, f.Storage)
			assert.Equal(t, f.Value, f.Storage.Read(), "storage reads back the value the placeholder sits in")

			// Writing through the placeholder is what has to reach the
			// document, whether it sits in a map or in a slice.
			f.Storage.Write(f.VariableName)
		}

		assert.Equal(t, "one", doc["a"])
		assert.Equal(t, "two", doc["nested"].(map[string]any)["b"])
		list := doc["list"].([]any)
		assert.Equal(t, "three", list[0])
		assert.Equal(t, "literal", list[1], "a value holding no placeholder is left alone")
		assert.Equal(t, "four", list[2].(map[string]any)["c"])
	})

	// Siblings share every level of the document above them, so a scan that
	// hands them one shared location writes one field repeatedly and leaves the
	// rest holding their placeholder.
	t.Run("gives siblings their own storage deep in the document", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{"a":{"b":{"c":{"k1":"${{ v }}","k2":"${{ v }}","k3":"${{ v }}"}}}}`)

		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)
		require.Len(t, found, 3)

		require.NoError(t, ReplaceVariables(found, VariableListToMap([]*Variable{plainVar(t, "v", "value")})))

		leaves := doc["a"].(map[string]any)["b"].(map[string]any)["c"].(map[string]any)
		assert.Equal(t, map[string]any{"k1": "value", "k2": "value", "k3": "value"}, leaves,
			"each sibling needs its own storage")
	})

	t.Run("ignores text that holds no placeholder", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{
			"plain":   "no placeholder",
			"dollars": "$5.00",
			"jsonref": "#/$defs/user",
			"single":  "${ v }",
			"empty":   "${{ }}",
			"dotted":  "${{ a.b }}"
		}`)

		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)
		assert.Empty(t, found, "a placeholder is ${{ name }} and nothing looser")
	})

	// A value that is one placeholder can keep the variable's type; a value
	// that wraps text around its placeholders cannot, so the two have to be
	// told apart -- and one value can hold several placeholders, which is a
	// record each.
	t.Run("records every placeholder a value embeds", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{"callback":"${{ scheme }}://${{ host }}/callback"}`)

		found, err := ScanDocumentForVariables(doc)
		require.NoError(t, err)
		require.Len(t, found, 2)

		for _, f := range found {
			assert.Equal(t, doc["callback"], f.Storage.Read(), "both sit in the same value")
		}
		assert.Equal(t, []string{"scheme", "host"}, []string{found[0].VariableName, found[1].VariableName},
			"the placeholders come back in the order the value holds them")
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
		return ReplaceVariables(found, decrypted)
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

	// A value that wraps text around its placeholder cannot keep the variable's
	// type -- the text around it has to survive -- so the variable is rendered
	// into the string instead. Callback and issuer URLs are why this exists.
	t.Run("renders placeholders embedded in text", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{
			"callback": "https://${{ host }}/callback",
			"both":     "${{ scheme }}://${{ host }}:${{ port }}",
			"repeated": "${{ host }} and ${{ host }}",
			"list":     ["https://${{ host }}/one"]
		}`)

		require.NoError(t, replace(t, doc,
			plainVar(t, "host", "example.test"),
			plainVar(t, "scheme", "https"),
			plainVar(t, "port", 8080),
		))

		assert.Equal(t, "https://example.test/callback", doc["callback"])
		// A number rendered into text reads the way the document would have
		// spelled it, without the quotes a JSON string would carry.
		assert.Equal(t, "https://example.test:8080", doc["both"])
		assert.Equal(t, "example.test and example.test", doc["repeated"],
			"a placeholder held twice in one value is replaced at both spots")
		assert.Equal(t, "https://example.test/one", doc["list"].([]any)[0],
			"a slice element is written in place too")
	})

	// Storage hands every number back as a float64, and fmt would write a large
	// one in scientific notation.
	t.Run("renders a large number the way the document would spell it", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{"budget":"up to ${{ big }} bytes"}`)

		require.NoError(t, replace(t, doc, plainVar(t, "big", float64(1000000))))
		assert.Equal(t, "up to 1000000 bytes", doc["budget"])
	})

	t.Run("leaves the text around a placeholder nothing was entered for", func(t *testing.T) {
		t.Parallel()

		doc := decodeDoc(t, `{
			"partly": "https://${{ host }}/${{ nope }}",
			"none":   "https://${{ nope }}/callback"
		}`)

		require.NoError(t, replace(t, doc, plainVar(t, "host", "example.test")))

		assert.Equal(t, "https://example.test/${{ nope }}", doc["partly"],
			"what resolved is written, what did not stays as it is")
		assert.Equal(t, "https://${{ nope }}/callback", doc["none"],
			"a value nothing resolved in is left untouched")
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
		require.NoError(t, ReplaceVariables(found, decrypted))
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

		err = ReplaceVariables(found, VariableListToMap([]*Variable{big}))
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrVariableExpansionTooLarge())
	})

	t.Run("charges an embedded placeholder to the same budget", func(t *testing.T) {
		t.Parallel()

		big := plainVar(t, "big", strings.Repeat("A", MaxVariableStringLength))

		fields := make(map[string]any, 200)
		for i := range 200 {
			fields[string(rune('a'+i%26))+string(rune('a'+i/26))] = "prefix ${{ big }} suffix"
		}

		found, err := ScanDocumentForVariables(fields)
		require.NoError(t, err)

		err = ReplaceVariables(found, VariableListToMap([]*Variable{big}))
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrVariableExpansionTooLarge())
	})

	// A placeholder that comes from anywhere but the scan has no document to
	// write back to, and must say so rather than quietly doing nothing.
	t.Run("reports a placeholder that is not bound to a document", func(t *testing.T) {
		t.Parallel()

		_, err := VariablePlaceholder{VariableName: "v", Value: "${{ v }}"}.
			ReplaceWith(plainVar(t, "v", "value"), maxExpansionBytes)
		require.Error(t, err)
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

	// The levels are not a chain: an owner may name a user in a team of a
	// project and name neither an environment nor a user schema, so ranking by
	// how deep an owner reaches is not enough.
	t.Run("ranks owners that skip levels", func(t *testing.T) {
		t.Parallel()

		teamNoEnv := VariableOwner{ProjectID: "p", TeamID: "t"}
		userInTeam := VariableOwner{ProjectID: "p", TeamID: "t", UserID: "u"}

		assert.True(t, teamNoEnv.IsMoreSpecificThan(project))
		assert.True(t, userInTeam.IsMoreSpecificThan(teamNoEnv))
		assert.False(t, teamNoEnv.IsMoreSpecificThan(userInTeam))

		// Setting a level nobody else set narrows the owner, whichever level
		// it is.
		assert.True(t, team.IsMoreSpecificThan(teamNoEnv), "the environment is one more level named")
		assert.True(t, userInTeam.IsMoreSpecificThan(VariableOwner{ProjectID: "p", UserID: "u"}))
	})

	// Between owners neither of which contains the other, the narrowest level
	// either one names decides: a value entered for one user beats one entered
	// for a whole team, however many broader levels the team-level owner also
	// names.
	t.Run("ranks the narrowest level ahead of a broader owner naming more levels", func(t *testing.T) {
		t.Parallel()

		userOnly := VariableOwner{ProjectID: "p", UserID: "u"}

		assert.True(t, userOnly.IsMoreSpecificThan(schema), "a user beats a whole user schema")
		assert.True(t, userOnly.IsMoreSpecificThan(team), "a user beats a whole team")
		assert.False(t, schema.IsMoreSpecificThan(userOnly))

		schemaOnly := VariableOwner{ProjectID: "p", UserSchemaID: "s"}
		assert.True(t, schemaOnly.IsMoreSpecificThan(team), "a user schema beats a whole team")
		assert.True(t, user.IsMoreSpecificThan(userOnly), "an owner naming every level stays the narrowest")
	})

	t.Run("collapses owners that skip levels", func(t *testing.T) {
		t.Parallel()

		userInTeam := VariableOwner{ProjectID: "p", TeamID: "t", UserID: "u"}

		got := VariableListToMap([]*Variable{
			{Name: "v", Owner: team, Value: "team"},
			{Name: "v", Owner: userInTeam, Value: "user-in-team"},
			{Name: "v", Owner: project, Value: "project"},
		})
		assert.Equal(t, "user-in-team", got["v"].Value)
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
