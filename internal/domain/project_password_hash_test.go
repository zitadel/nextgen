package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/crypto"
)

func TestNewPasswordHashPolicy(t *testing.T) {
	t.Parallel()

	t.Run("accepts each algorithm with the parameters it takes", func(t *testing.T) {
		t.Parallel()

		for algorithm, params := range map[string]map[string]any{
			"argon2i":  {"time": 3, "memory": 65536, "threads": 4},
			"argon2id": {"time": 3, "memory": 65536, "threads": 4},
			"bcrypt":   {"cost": 12},
			"scrypt":   {"cost": 16},
			"pbkdf2":   {"rounds": 210000, "hash": "sha256"},
			"sha2":     {"rounds": 5000, "hash": "sha512"},
		} {
			t.Run(algorithm, func(t *testing.T) {
				t.Parallel()

				policy, err := NewPasswordHashPolicy(algorithm, params)
				require.NoError(t, err)
				assert.Equal(t, crypto.HashName(algorithm), policy.Algorithm)
				assert.Equal(t, params, policy.Params)
				assert.Equal(t, crypto.HasherConfig{
					Algorithm: crypto.HashName(algorithm),
					Params:    params,
				}, policy.HasherConfig(), "the policy renders as the crypto layer's hashing method")
			})
		}
	})

	// passwap can verify these for users imported from another system, but
	// nothing may be written with them: md5 and its relatives are broken, and
	// the bare "argon2" name verifies both variants without saying which one to
	// hash with.
	t.Run("refuses an algorithm that cannot hash", func(t *testing.T) {
		t.Parallel()

		for _, algorithm := range []string{"argon2", "md5", "md5plain", "md5salted", "phpass", "drupal7", "", "sha3"} {
			t.Run(algorithm, func(t *testing.T) {
				t.Parallel()

				_, err := NewPasswordHashPolicy(algorithm, map[string]any{"cost": 12})
				require.Error(t, err)
				assert.ErrorIs(t, err, ErrProjectPasswordHashInvalid())
			})
		}
	})

	// Cost is the whole of a hashing method's strength, so a parameter set that
	// does not match the algorithm has to be an error rather than a default
	// quietly filling the gap or a stray key quietly doing nothing.
	t.Run("refuses a parameter set that does not match the algorithm", func(t *testing.T) {
		t.Parallel()

		for name, params := range map[string]map[string]any{
			"missing one": {"time": 3, "memory": 65536},
			"none at all": {},
			"one from another algorithm": {
				"time": 3, "memory": 65536, "threads": 4, "cost": 12,
			},
			"only another algorithm's": {"cost": 12},
		} {
			t.Run(name, func(t *testing.T) {
				t.Parallel()

				_, err := NewPasswordHashPolicy("argon2id", params)
				require.Error(t, err)
				assert.ErrorIs(t, err, ErrProjectPasswordHashInvalid())
			})
		}
	})

	t.Run("refuses an unknown hash mode", func(t *testing.T) {
		t.Parallel()

		_, err := NewPasswordHashPolicy("pbkdf2", map[string]any{"rounds": 1000, "hash": "sha3"})
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrProjectPasswordHashInvalid())

		_, err = NewPasswordHashPolicy("pbkdf2", map[string]any{"rounds": 1000, "hash": 256})
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrProjectPasswordHashInvalid())
	})

	// pbkdf2 is defined over any of the modes; sha2 is the crypt(3) scheme,
	// which has only a SHA-256 and a SHA-512 form. Checking the mode against
	// every mode there is would let sha2-with-sha1 through to the crypto layer,
	// which refuses it from inside the hasher it was building -- a 400 either
	// way, but one that reads as a cost failure rather than as a parameter this
	// algorithm never had.
	t.Run("checks the hash mode against the algorithm", func(t *testing.T) {
		t.Parallel()

		for _, mode := range []string{"sha1", "sha224", "sha256", "sha384", "sha512"} {
			t.Run("pbkdf2 takes "+mode, func(t *testing.T) {
				t.Parallel()

				policy, err := NewPasswordHashPolicy("pbkdf2", map[string]any{"rounds": 1000, "hash": mode})
				require.NoError(t, err)
				assert.Equal(t, mode, policy.Params["hash"])
			})
		}

		for _, mode := range []string{"sha256", "sha512"} {
			t.Run("sha2 takes "+mode, func(t *testing.T) {
				t.Parallel()

				_, err := NewPasswordHashPolicy("sha2", map[string]any{"rounds": 5000, "hash": mode})
				require.NoError(t, err)
			})
		}

		for _, mode := range []string{"sha1", "sha224", "sha384"} {
			t.Run("sha2 refuses "+mode, func(t *testing.T) {
				t.Parallel()

				_, err := NewPasswordHashPolicy("sha2", map[string]any{"rounds": 5000, "hash": mode})
				require.Error(t, err)
				assert.ErrorIs(t, err, ErrProjectPasswordHashInvalid())
			})
		}
	})

	// Every mode the domain admits has to be one the crypto layer can actually
	// build a hasher for, which is the mismatch this pairing exists to keep
	// from coming back.
	t.Run("every admitted mode builds a hasher", func(t *testing.T) {
		t.Parallel()

		factory, err := (&crypto.HashConfig{
			Verifiers: []crypto.HashName{crypto.HashNamePBKDF2, crypto.HashNameSha2},
			Hasher: crypto.HasherConfig{
				Algorithm: crypto.HashNameBcrypt,
				Params:    map[string]any{"cost": 10},
			},
		}).NewHasherFactory()
		require.NoError(t, err)

		for algorithm, modes := range PasswordHashAlgorithmModes {
			for _, mode := range modes {
				t.Run(string(algorithm)+"/"+string(mode), func(t *testing.T) {
					t.Parallel()

					policy, err := NewPasswordHashPolicy(string(algorithm), map[string]any{
						"rounds": 5000,
						"hash":   string(mode),
					})
					require.NoError(t, err)
					// New, not Check: the limits are what Check would measure,
					// and this is about the algorithm and mode pairing alone.
					_, err = factory.New(policy.HasherConfig())
					require.NoError(t, err)
				})
			}
		}
	})

	// The stored form is lowercase, so a policy written through the API and one
	// written by an admin who typed "Cost" produce the same row.
	t.Run("lowercases parameter names", func(t *testing.T) {
		t.Parallel()

		policy, err := NewPasswordHashPolicy("bcrypt", map[string]any{"Cost": 12})
		require.NoError(t, err)
		assert.Equal(t, map[string]any{"cost": 12}, policy.Params)
	})

	t.Run("leaves the caller's map alone", func(t *testing.T) {
		t.Parallel()

		params := map[string]any{"Cost": 12}
		_, err := NewPasswordHashPolicy("bcrypt", params)
		require.NoError(t, err)
		assert.Equal(t, map[string]any{"Cost": 12}, params)
	})
}
