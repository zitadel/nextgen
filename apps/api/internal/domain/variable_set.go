package domain

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
)

// VariableSetEntry is one value of a frozen set. It carries no kind: a set is
// resolved for one kind before it is frozen, so every entry in it is the value
// the deployment's target sees under that name.
type VariableSetEntry struct {
	Name string
	// Value is the plain value, or the ciphertext of a secret exactly as it
	// was stored. A number is always a float64 here, whatever the variable
	// held when it was written, because that is what every dialect decodes
	// from its JSON column and the hash has to agree with what a read returns.
	Value    any
	IsSecret bool
}

// VariableSet is the values a deployment was created with, frozen as one
// immutable, content-addressed document (ADR 069). Identical values in one
// project are one set however many deployments use them, and a set is never
// shared across projects: an equal hash in two projects would reveal that two
// tenants hold the same values.
//
// Entries are ordered by name, which is the order the hash covers them in.
type VariableSet struct {
	ProjectID string
	Hash      string
	Entries   []VariableSetEntry
}

// NewVariableSet freezes vars as the set of projectID. The variables are the
// rows one read of a project and kind returned, so their names are unique;
// a duplicate name is a broken invariant and refused rather than ranked.
func NewVariableSet(projectID string, vars []*Variable) (*VariableSet, error) {
	entries := make([]VariableSetEntry, 0, len(vars))
	for _, v := range vars {
		entries = append(entries, VariableSetEntry{
			Name:     v.Name,
			Value:    widenVariableNumber(v.Value),
			IsSecret: v.IsSecret,
		})
	}
	slices.SortFunc(entries, compareVariableSetEntries)

	hash, err := variableSetHash(entries)
	if err != nil {
		return nil, err
	}
	return &VariableSet{
		ProjectID: projectID,
		Hash:      hash,
		Entries:   entries,
	}, nil
}

// Variables returns the set the way a read of its project would, keyed by
// name, so a set can feed [ReplaceVariables] and [Variables.DecryptAll] like
// live variables do. Kind is left at its zero value: a set is resolved and
// carries none, and neither consumer looks at it.
func (s *VariableSet) Variables() Variables {
	vars := make(Variables, len(s.Entries))
	for _, entry := range s.Entries {
		vars[entry.Name] = &Variable{
			Name:     entry.Name,
			Owner:    VariableOwner{ProjectID: s.ProjectID},
			Value:    entry.Value,
			IsSecret: entry.IsSecret,
		}
	}
	return vars
}

// VariableSetHash derives the content address of a set from its entries, in
// any order.
//
// Exported so a caller holding entries can derive the address without a set:
// the storage round-trip tests check that what came back out of a dialect
// still hashes to what went in.
func VariableSetHash(entries []VariableSetEntry) (string, error) {
	return variableSetHash(slices.SortedFunc(slices.Values(entries), compareVariableSetEntries))
}

// compareVariableSetEntries orders a set canonically. Name alone is total for
// any set that is valid, since variableSetHash refuses a duplicate name.
func compareVariableSetEntries(a, b VariableSetEntry) int {
	return cmp.Compare(a.Name, b.Name)
}

// variableSetHashVersion prefixes the hash preimage so a future change to the
// canonical form cannot silently collide with hashes written under this one.
const variableSetHashVersion = "vset-v1\x00"

// variableSetHash hashes an already-sorted set.
//
// Each field is written as "<length>:<field>" rather than joined by a
// separator, for the same reason the release hash is: a value can hold any
// byte, so no separator is unambiguous, and the length is. A secret is
// covered by its ciphertext, never its plaintext -- a hash of a low-entropy
// secret could be reversed with a dictionary, and the ciphertext identifies
// one write because the JWE carries a random IV.
func variableSetHash(sorted []VariableSetEntry) (string, error) {
	digest := sha256.New()
	// Writing to a hash never fails, so the errors are not worth threading.
	field := func(value string) { fmt.Fprintf(digest, "%d:%s", len(value), value) }

	fmt.Fprint(digest, variableSetHashVersion)
	for i, entry := range sorted {
		if i > 0 && entry.Name == sorted[i-1].Name {
			return "", ErrInternal(nil).
				WithMessage("a variable set holds one value per name").
				WithDetails(map[string]string{"name": entry.Name})
		}
		value, err := canonicalVariableSetValue(entry)
		if err != nil {
			return "", err
		}
		field(entry.Name)
		secret := "0"
		if entry.IsSecret {
			secret = "1"
		}
		field(secret)
		field(value)
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// canonicalVariableSetValue is the byte form of a value that the hash covers.
// A secret is its ciphertext verbatim, which is the compact JWE string the
// project's key produced. A plain value is its JSON, with every number first
// widened to float64, so a value hashes the same when it is frozen from a
// fresh write as when it is read back from a JSON column.
func canonicalVariableSetValue(entry VariableSetEntry) (string, error) {
	if entry.IsSecret {
		ciphertext, ok := entry.Value.(string)
		if !ok {
			return "", ErrInternal(nil).
				WithMessage("a secret in a variable set must hold its ciphertext").
				WithDetails(map[string]string{"name": entry.Name})
		}
		return ciphertext, nil
	}
	value := widenVariableNumber(entry.Value)
	if !isVariableScalar(value) {
		return "", ErrInternal(nil).
			WithMessage("a variable set value must be a bool, number or string").
			WithDetails(map[string]string{"name": entry.Name})
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to encode a variable set value")
	}
	return string(encoded), nil
}

// widenVariableNumber converts any number a variable can hold to float64,
// which is what every dialect decodes a JSON number into. Anything else is
// returned as it is.
func widenVariableNumber(value any) any {
	switch n := value.(type) {
	case int:
		return float64(n)
	case int8:
		return float64(n)
	case int16:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	case uint:
		return float64(n)
	case uint8:
		return float64(n)
	case uint16:
		return float64(n)
	case uint32:
		return float64(n)
	case uint64:
		return float64(n)
	case float32:
		return float64(n)
	default:
		return value
	}
}
