// Package variableset holds the shared encoding of the entries column of the
// variable_sets table — the frozen values of one deployment — used by the
// dialect statements.
package variableset

import (
	"cmp"
	"encoding/json"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
)

// entry is one value inside the entries document, keyed by its name. It
// carries no kind: a set is resolved for one kind before it is frozen (ADR
// 069). A secret's value is its ciphertext, which is why the flag travels
// beside it -- a reader has to know what not to print.
type entry struct {
	Value  any  `json:"value"`
	Secret bool `json:"secret,omitzero"`
}

// Row carries the scanned columns of one variable_sets row. created_at is
// deliberately absent: a freeze that finds the set already stored inserts
// nothing and so learns no timestamp, and nothing orders or filters on it.
type Row struct {
	ProjectID string
	Hash      string
	Entries   []byte
}

// MarshalEntries converts the entries of a set into the JSON object
// {"NAME":{"value":<json>,"secret":bool}} for the entries column. An object
// keyed by name rather than an array, so the document says what a reader
// looks it up by and the column CHECK can pin the shape.
//
// Key order is not preserved by JSONB or Spanner's JSON type and is not
// relied on: the hash is computed in Go over the entries sorted by name, and
// ToDomain sorts again.
func MarshalEntries(entries []domain.VariableSetEntry) ([]byte, error) {
	// Never nil: an empty set is the empty object, not null, which is what
	// the column CHECK admits.
	encoded := make(map[string]entry, len(entries))
	for _, e := range entries {
		encoded[e.Name] = entry{Value: e.Value, Secret: e.IsSecret}
	}
	return json.Marshal(encoded)
}

// ToDomain converts a scanned row into a domain.VariableSet, with the entries
// sorted by name as NewVariableSet produced them.
func ToDomain(row Row) (*domain.VariableSet, error) {
	var encoded map[string]entry
	if len(row.Entries) > 0 {
		if err := json.Unmarshal(row.Entries, &encoded); err != nil {
			return nil, err
		}
	}

	entries := make([]domain.VariableSetEntry, 0, len(encoded))
	for name, e := range encoded {
		entries = append(entries, domain.VariableSetEntry{
			Name:     name,
			Value:    e.Value,
			IsSecret: e.Secret,
		})
	}
	slices.SortFunc(entries, func(a, b domain.VariableSetEntry) int {
		return cmp.Compare(a.Name, b.Name)
	})

	return &domain.VariableSet{
		ProjectID: row.ProjectID,
		Hash:      row.Hash,
		Entries:   entries,
	}, nil
}
