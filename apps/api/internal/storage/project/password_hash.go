// Package project holds the shared encoding for the projects table's one JSON
// column -- the password hashing policy -- used by every dialect's statements.
package project

import (
	"encoding/json"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
)

// passwordHashPolicy is the stored shape of [domain.PasswordHashPolicy]. The
// algorithm is written as its name and the parameters as the numbers an admin
// entered, so a row explains itself without the code that wrote it, and a
// parameter set that gains a key does not shift the meaning of the rows already
// written.
type passwordHashPolicy struct {
	Algorithm string         `json:"algorithm"`
	Params    map[string]any `json:"params"`
}

// MarshalPasswordHashPolicy renders the policy for the password_hash_policy
// column. A project with no policy of its own stores SQL NULL rather than an
// empty object: "no answer" is what makes the deployment default apply, and an
// object is an answer.
func MarshalPasswordHashPolicy(policy *domain.PasswordHashPolicy) ([]byte, error) {
	if policy == nil {
		return nil, nil
	}
	params := policy.Params
	if params == nil {
		params = map[string]any{}
	}
	return json.Marshal(passwordHashPolicy{
		Algorithm: string(policy.Algorithm),
		Params:    params,
	})
}

// UnmarshalPasswordHashPolicy reads the column back. NULL and an empty column
// both mean the deployment default.
//
// The stored policy is not re-validated here. It passed validation when it was
// written, and a row that a later deployment would no longer accept -- an
// algorithm dropped from the verifier set, limits tightened underneath it -- has
// to keep loading, because refusing it here would fail the project's password
// writes with a storage error rather than a decision anyone can act on.
func UnmarshalPasswordHashPolicy(raw []byte) (*domain.PasswordHashPolicy, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var stored passwordHashPolicy
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, err
	}
	if stored.Algorithm == "" {
		return nil, nil
	}
	return &domain.PasswordHashPolicy{
		Algorithm: crypto.HashName(stored.Algorithm),
		Params:    stored.Params,
	}, nil
}
