package domain

import (
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/crypto"
)

func ErrProjectPasswordHashInvalid() Error {
	return newError(PrefixProject.ErrorCodePrefix("password_hash_invalid"), "the password hashing method is invalid", nil, nil)
}

// PasswordHashPolicy is the method a project's passwords are written with
// (ADR 029 §Hashing: "A project admin should be able to configure which hashing
// method should be used… so that a tenant can have specific requirements such
// as FIPS").
//
// It governs hashing only. Verification stays deployment-wide, because a
// project's stored passwords predate whatever it picks today: every hash the
// server could read before a policy is set stays readable after, and a project
// that changes its mind does not invalidate the passwords already written under
// the old method. Nothing rehashes on the strength of a policy change either --
// a password is only ever rewritten when its owner sets a new one.
//
// A project without a policy hashes with the deployment default, which is
// argon2id unless the operator configured otherwise. That is the state of every
// project until an admin says otherwise, so the zero value of the field on
// [Project] is a nil pointer rather than a filled-in copy of the default: the
// deployment's choice keeps travelling to projects that never made one.
type PasswordHashPolicy struct {
	// Algorithm names the passwap hasher, e.g. "argon2id" or "bcrypt".
	Algorithm crypto.HashName
	// Params are the algorithm's cost parameters, keyed by the lowercase names
	// of [PasswordHashAlgorithmParams]. Values arrive from JSON, so a number is
	// a float64 here and is converted when the hasher is built.
	Params map[string]any
}

// PasswordHashAlgorithmParams lists the cost parameters each algorithm a
// project may choose takes. Membership is the algorithm allowlist: passwap can
// verify md5, phpass and drupal7 hashes for migration, but nothing may be
// written with them, and the generic "argon2" name verifies both variants
// without naming which one to hash with.
//
// The parameter set is exact rather than a default-filling one. An algorithm's
// cost is the whole of its security, a default that silently applies is a
// deployment-wide decision rather than a per-project one, and a parameter meant
// for another algorithm that is quietly ignored ("cost" on argon2id) reads as
// accepted while changing nothing.
var PasswordHashAlgorithmParams = map[crypto.HashName][]string{
	crypto.HashNameArgon2i:  {"time", "memory", "threads"},
	crypto.HashNameArgon2id: {"time", "memory", "threads"},
	crypto.HashNameBcrypt:   {"cost"},
	crypto.HashNameScrypt:   {"cost"},
	crypto.HashNamePBKDF2:   {"rounds", "hash"},
	crypto.HashNameSha2:     {"rounds", "hash"},
}

// PasswordHashAlgorithmModes lists the underlying hashes each algorithm accepts
// for its "hash" parameter. The two that take one do not take the same set:
// pbkdf2 is defined over any of them, while sha2 is the crypt(3) scheme, which
// has only a SHA-256 and a SHA-512 form -- there is no sha2 hash to write with
// sha1. An algorithm absent from this map takes no "hash" parameter at all.
var PasswordHashAlgorithmModes = map[crypto.HashName][]crypto.HashMode{
	crypto.HashNamePBKDF2: {
		crypto.HashModeSHA1,
		crypto.HashModeSHA224,
		crypto.HashModeSHA256,
		crypto.HashModeSHA384,
		crypto.HashModeSHA512,
	},
	crypto.HashNameSha2: {
		crypto.HashModeSHA256,
		crypto.HashModeSHA512,
	},
}

// NewPasswordHashPolicy validates a hashing method a project asked for. It
// checks the shape -- a known algorithm, exactly the parameters that algorithm
// takes -- and leaves cost limits to the crypto layer, which owns the
// deployment's bounds and answers them by hashing.
func NewPasswordHashPolicy(algorithm string, params map[string]any) (*PasswordHashPolicy, error) {
	name := crypto.HashName(algorithm)
	expected, ok := PasswordHashAlgorithmParams[name]
	if !ok {
		return nil, ErrProjectPasswordHashInvalid().WithDetails(map[string]any{
			"algorithm": algorithm,
			"reason":    "unknown algorithm",
			"supported": passwordHashAlgorithmNames(),
		})
	}

	normalized := make(map[string]any, len(params))
	for key, value := range params {
		lowered := strings.ToLower(key)
		if !slices.Contains(expected, lowered) {
			return nil, ErrProjectPasswordHashInvalid().WithDetails(map[string]any{
				"algorithm": algorithm,
				"parameter": key,
				"reason":    "parameter not used by this algorithm",
				"expected":  expected,
			})
		}
		normalized[lowered] = value
	}
	for _, key := range expected {
		if _, ok := normalized[key]; !ok {
			return nil, ErrProjectPasswordHashInvalid().WithDetails(map[string]any{
				"algorithm": algorithm,
				"parameter": key,
				"reason":    "missing parameter",
				"expected":  expected,
			})
		}
	}
	if err := validatePasswordHashMode(name, normalized); err != nil {
		return nil, err
	}

	return &PasswordHashPolicy{Algorithm: name, Params: normalized}, nil
}

// validatePasswordHashMode checks the one parameter that is not a number, and
// checks it against the algorithm rather than against every mode there is. The
// crypto layer refuses sha2-with-sha1 too, but only from inside the hasher it
// was building, which reads back as "cannot use sha1 with sha2" rather than as
// a parameter this algorithm never had.
func validatePasswordHashMode(algorithm crypto.HashName, params map[string]any) error {
	raw, ok := params["hash"]
	if !ok {
		return nil
	}
	allowed := PasswordHashAlgorithmModes[algorithm]
	text, ok := raw.(string)
	if !ok || !slices.Contains(allowed, crypto.HashMode(text)) {
		return ErrProjectPasswordHashInvalid().WithDetails(map[string]any{
			"algorithm": string(algorithm),
			"parameter": "hash",
			"reason":    "hash mode not supported by this algorithm",
			"expected":  allowed,
		})
	}
	return nil
}

func passwordHashAlgorithmNames() []string {
	names := make([]string, 0, len(PasswordHashAlgorithmParams))
	for name := range PasswordHashAlgorithmParams {
		names = append(names, string(name))
	}
	slices.Sort(names)
	return names
}

// HasherConfig renders the policy the way the crypto layer takes a hashing
// method, which is the same shape the deployment's own configuration decodes
// into.
func (p *PasswordHashPolicy) HasherConfig() crypto.HasherConfig {
	return crypto.HasherConfig{
		Algorithm: p.Algorithm,
		Params:    p.Params,
	}
}
