package domain_test

import (
	"crypto/rand"
	"crypto/rsa"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestNewProject(t *testing.T) {
	t.Parallel()
	type args struct {
		name           string
		previewOrigins []string
	}
	tests := []struct {
		name    string
		args    args
		check   func(t *testing.T, got *domain.Project)
		wantErr error
	}{
		{
			name: "project with name",
			args: args{
				name: "my-project",
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "my-project", got.Name)
			},
			wantErr: nil,
		},
		{
			name: "project name is trimmed",
			args: args{
				name: "  my-project  ",
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "my-project", got.Name)
			},
			wantErr: nil,
		},
		{
			name: "project with empty name",
			args: args{
				name: "",
			},
			wantErr: domain.ErrProjectNameInvalid(),
		},
		{
			name: "project with whitespace-only name",
			args: args{
				name: "   ",
			},
			wantErr: domain.ErrProjectNameInvalid(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := domain.NewProject(tt.args.name, tt.args.previewOrigins)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			tt.check(t, got)
		})
	}
}

func testMintID(t *testing.T) func(domain.ResourcePrefix) (string, error) {
	t.Helper()
	n := 0
	return func(prefix domain.ResourcePrefix) (string, error) {
		n++
		return string(prefix) + "_test" + strconv.Itoa(n), nil
	}
}

func TestProject_GenerateNewKeySet(t *testing.T) {
	t.Parallel()

	project := &domain.Project{ID: "proj-1", Name: "my-project"}

	t.Run("returns a full set of fresh keys", func(t *testing.T) {
		t.Parallel()

		keySet, err := project.GenerateNewKeySet(newTestMasterKey(t), testMintID(t))
		require.NoError(t, err)
		require.NotNil(t, keySet)

		require.NotNil(t, keySet.KeyEncryptionKey)
		require.NotNil(t, keySet.TokenEncryptionKey)
		require.NotNil(t, keySet.SecretEncryptionKey)
		require.NotNil(t, keySet.CookieEncryptionKey)
		require.NotNil(t, keySet.TokenSigningKey)

		purposes := map[domain.EncryptionKeyPurpose]*domain.EncryptionKey{
			domain.EncryptionKeyPurposeKEK:    keySet.KeyEncryptionKey,
			domain.EncryptionKeyPurposeToken:  keySet.TokenEncryptionKey,
			domain.EncryptionKeyPurposeSecret: keySet.SecretEncryptionKey,
			domain.EncryptionKeyPurposeCookie: keySet.CookieEncryptionKey,
		}
		for purpose, key := range purposes {
			assert.Equal(t, purpose, key.Purpose)
			assert.Equal(t, jose.A256GCM, key.Algorithm)
			assert.Equal(t, project.ID, key.ProjectID)
			assert.NotEmpty(t, key.Key, purpose)
			if purpose == domain.EncryptionKeyPurposeKEK {
				assert.True(t, strings.HasPrefix(key.ID, string(domain.PrefixEncryptionKey)+"_"), "KEK ID is minted before wrap")
			} else {
				assert.Empty(t, key.ID, "purpose key ID is assigned by the dialect on create")
			}
		}

		assert.Equal(t, domain.SigningKeyPurposeToken, keySet.TokenSigningKey.Purpose)
		assert.Equal(t, jose.EdDSA, keySet.TokenSigningKey.Algorithm)
		assert.Equal(t, project.ID, keySet.TokenSigningKey.ProjectID)
		assert.Empty(t, keySet.TokenSigningKey.ID, "ID is assigned by the dialect on create")
		assert.NotEmpty(t, keySet.TokenSigningKey.Key)
	})

	t.Run("a generated key set is not active yet", func(t *testing.T) {
		t.Parallel()

		keySet, err := project.GenerateNewKeySet(newTestMasterKey(t), testMintID(t))
		require.NoError(t, err)

		for _, key := range encryptionKeysOf(keySet) {
			assert.Equal(t, domain.KeyStateNotActiveYet, key.State, key.Purpose)
			assert.False(t, key.IsActive(), key.Purpose)
			assert.Nil(t, key.ActivatedAt, key.Purpose)
			assert.Nil(t, key.RetiredAt, key.Purpose)
		}

		assert.Equal(t, domain.KeyStateNotActiveYet, keySet.TokenSigningKey.State)
		assert.False(t, keySet.TokenSigningKey.IsActive())
		assert.Nil(t, keySet.TokenSigningKey.ActivatedAt)
		assert.Nil(t, keySet.TokenSigningKey.RetiredAt)
	})

	t.Run("the KEK is wrapped by the master key", func(t *testing.T) {
		t.Parallel()

		masterKey := newTestMasterKey(t)
		keySet, err := project.GenerateNewKeySet(masterKey, testMintID(t))
		require.NoError(t, err)

		material, err := keySet.KeyEncryptionKey.DecryptedKey(masterKey)
		require.NoError(t, err)
		assert.Len(t, material, 32)
		assert.NotEqual(t, [32]byte{}, material, "generated KEK must not be all zeros")
	})

	t.Run("the purpose-scoped keys are wrapped by the KEK, not the master key", func(t *testing.T) {
		t.Parallel()

		masterKey := newTestMasterKey(t)
		keySet, err := project.GenerateNewKeySet(masterKey, testMintID(t))
		require.NoError(t, err)

		kekCrypter, err := keySet.KeyEncryptionKey.Crypter(masterKey)
		require.NoError(t, err)

		for _, key := range []*domain.EncryptionKey{
			keySet.TokenEncryptionKey,
			keySet.SecretEncryptionKey,
			keySet.CookieEncryptionKey,
		} {
			material, err := key.DecryptedKey(kekCrypter)
			require.NoError(t, err, key.Purpose)
			assert.NotEqual(t, [32]byte{}, material, key.Purpose)

			// The master key must not unwrap it directly: the project's KEK is
			// the only thing standing between the two.
			_, err = masterKey.Decrypt(key.Key)
			assert.Error(t, err, "the %s key must not be unwrappable by the master key", key.Purpose)

			header, err := domain.DecodeJWEHeader(key.Key)
			require.NoError(t, err, key.Purpose)
			assert.Equal(t, keySet.KeyEncryptionKey.ID, header.KeyID, key.Purpose)
		}

		// The signing key hangs off the same KEK, and its seed is usable.
		signer, err := keySet.TokenSigningKey.Signer(kekCrypter)
		require.NoError(t, err)
		_, err = signer.Sign([]byte(`{"sub":"user-1"}`))
		require.NoError(t, err)
	})

	t.Run("every key gets its own material", func(t *testing.T) {
		t.Parallel()

		keySet, err := project.GenerateNewKeySet(newTestMasterKey(t), testMintID(t))
		require.NoError(t, err)

		wrapped := map[string]struct{}{keySet.TokenSigningKey.Key: {}}
		for _, key := range encryptionKeysOf(keySet) {
			if key.Purpose == domain.EncryptionKeyPurposeKEK {
				assert.NotEmpty(t, key.ID)
			} else {
				assert.Empty(t, key.ID)
			}
			wrapped[key.Key] = struct{}{}
		}
		assert.Empty(t, keySet.TokenSigningKey.ID)

		assert.Len(t, wrapped, 5, "all five keys must have distinct material")
	})

	t.Run("a second key set shares no material with the first", func(t *testing.T) {
		t.Parallel()

		masterKey := newTestMasterKey(t)

		mint := testMintID(t)
		first, err := project.GenerateNewKeySet(masterKey, mint)
		require.NoError(t, err)
		second, err := project.GenerateNewKeySet(masterKey, mint)
		require.NoError(t, err)

		firstKEK, err := first.KeyEncryptionKey.DecryptedKey(masterKey)
		require.NoError(t, err)
		secondKEK, err := second.KeyEncryptionKey.DecryptedKey(masterKey)
		require.NoError(t, err)

		assert.NotEmpty(t, first.KeyEncryptionKey.ID)
		assert.NotEmpty(t, second.KeyEncryptionKey.ID)
		assert.NotEqual(t, first.KeyEncryptionKey.ID, second.KeyEncryptionKey.ID)
		assert.NotEqual(t, firstKEK, secondKEK, "a rotation must generate new key material")
	})

	t.Run("a KEK that does not unwrap to 32 bytes is rejected", func(t *testing.T) {
		t.Parallel()

		masterKey := cryptomock.NewMockCrypter(gomock.NewController(t))
		masterKey.EXPECT().Encrypt(gomock.Any()).Return("wrapped-kek", nil)
		masterKey.EXPECT().Decrypt("wrapped-kek").Return("too short for AES-256", nil)

		keySet, err := project.GenerateNewKeySet(masterKey, testMintID(t))
		assert.Nil(t, keySet)
		require.Error(t, err)

		var de domain.Error
		require.ErrorAs(t, err, &de)
		assert.Equal(t, "failed to decrypt project key encryption key", de.Message)
	})
}

func TestProjectKeySet_Activate(t *testing.T) {
	t.Parallel()

	t.Run("activates every key of a first key set", func(t *testing.T) {
		t.Parallel()

		keySet := newTestProjectKeySet(domain.KeyStateNotActiveYet)

		since := time.Now().UTC()
		keySet.Activate(nil)

		assertKeySetActive(t, keySet, since)
	})

	t.Run("retires every key of the previous key set", func(t *testing.T) {
		t.Parallel()

		oldKeys := newTestProjectKeySet(domain.KeyStateActive)
		keySet := newTestProjectKeySet(domain.KeyStateNotActiveYet)

		since := time.Now().UTC()
		keySet.Activate(oldKeys)

		assertKeySetActive(t, keySet, since)

		for _, key := range encryptionKeysOf(oldKeys) {
			assert.Equal(t, domain.KeyStateExpired, key.State, key.Purpose)
			assert.False(t, key.IsActive(), key.Purpose)
			if assert.NotNil(t, key.RetiredAt, key.Purpose) {
				assert.False(t, key.RetiredAt.Before(since), key.Purpose)
			}
		}
		assert.Equal(t, domain.KeyStateExpired, oldKeys.TokenSigningKey.State)
		assert.False(t, oldKeys.TokenSigningKey.IsActive())
		if assert.NotNil(t, oldKeys.TokenSigningKey.RetiredAt) {
			assert.False(t, oldKeys.TokenSigningKey.RetiredAt.Before(since))
		}
	})

	t.Run("a previous key set with missing keys retires only what it has", func(t *testing.T) {
		t.Parallel()

		// A partially populated predecessor must not stop the new set from
		// taking over — the keys that are there are all there is to retire.
		oldKeys := newTestProjectKeySet(domain.KeyStateActive)
		oldKeys.TokenEncryptionKey = nil
		oldKeys.TokenSigningKey = nil

		keySet := newTestProjectKeySet(domain.KeyStateNotActiveYet)

		since := time.Now().UTC()
		require.NotPanics(t, func() { keySet.Activate(oldKeys) })

		assertKeySetActive(t, keySet, since)
		assert.Equal(t, domain.KeyStateExpired, oldKeys.KeyEncryptionKey.State)
		assert.Equal(t, domain.KeyStateExpired, oldKeys.SecretEncryptionKey.State)
		assert.Equal(t, domain.KeyStateExpired, oldKeys.CookieEncryptionKey.State)
	})

	t.Run("rotates a generated key set without touching its material", func(t *testing.T) {
		t.Parallel()

		masterKey := newTestMasterKey(t)
		project := &domain.Project{ID: "proj-1", Name: "my-project"}

		current, err := project.GenerateNewKeySet(masterKey, testMintID(t))
		require.NoError(t, err)
		current.Activate(nil)

		next, err := project.GenerateNewKeySet(masterKey, testMintID(t))
		require.NoError(t, err)
		wrappedBefore := next.KeyEncryptionKey.Key

		since := time.Now().UTC()
		next.Activate(current)

		assertKeySetActive(t, next, since)
		for _, key := range encryptionKeysOf(current) {
			assert.Equal(t, domain.KeyStateExpired, key.State, key.Purpose)
		}
		assert.Equal(t, domain.KeyStateExpired, current.TokenSigningKey.State)

		// Activation is a state change only. Both sets keep their material, so
		// everything the retired set encrypted stays readable.
		assert.Equal(t, wrappedBefore, next.KeyEncryptionKey.Key)
		_, err = current.KeyEncryptionKey.DecryptedKey(masterKey)
		assert.NoError(t, err, "a retired KEK must still unwrap")
	})
}

// newTestMasterKey builds a master key backed by a fresh RSA key. A real master
// key rather than a stub crypter is what makes the wrapping assertions above
// meaningful: material it did not wrap fails to decrypt. 2048 bits keeps it
// fast while remaining large enough to wrap a 256-bit key.
func newTestMasterKey(t *testing.T) *domain.MasterKey {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	masterKey := domain.NewMasterKey("master-1", *key, true)
	return &masterKey
}

// newTestProjectKeySet builds a key set whose keys carry no material — enough
// for the state transitions [domain.ProjectKeySet.Activate] performs.
func newTestProjectKeySet(state domain.KeyState) *domain.ProjectKeySet {
	return &domain.ProjectKeySet{
		KeyEncryptionKey:    &domain.EncryptionKey{ID: "enc_key_kek", Purpose: domain.EncryptionKeyPurposeKEK, State: state},
		TokenEncryptionKey:  &domain.EncryptionKey{ID: "enc_key_token", Purpose: domain.EncryptionKeyPurposeToken, State: state},
		SecretEncryptionKey: &domain.EncryptionKey{ID: "enc_key_secret", Purpose: domain.EncryptionKeyPurposeSecret, State: state},
		CookieEncryptionKey: &domain.EncryptionKey{ID: "enc_key_cookie", Purpose: domain.EncryptionKeyPurposeCookie, State: state},
		TokenSigningKey:     &domain.SigningKey{ID: "sig_key_token", Purpose: domain.SigningKeyPurposeToken, State: state},
	}
}

// encryptionKeysOf returns the key set's encryption keys so assertions can
// cover all of them and name the purpose that failed.
func encryptionKeysOf(s *domain.ProjectKeySet) []*domain.EncryptionKey {
	return []*domain.EncryptionKey{
		s.KeyEncryptionKey,
		s.TokenEncryptionKey,
		s.SecretEncryptionKey,
		s.CookieEncryptionKey,
	}
}

// assertKeySetActive asserts every key of the set is active, was activated at
// or after since, and is not retired.
func assertKeySetActive(t *testing.T, s *domain.ProjectKeySet, since time.Time) {
	t.Helper()

	assertActivated := func(name string, state domain.KeyState, activatedAt, retiredAt *time.Time) {
		assert.Equal(t, domain.KeyStateActive, state, name)
		assert.Nil(t, retiredAt, name)
		if assert.NotNil(t, activatedAt, name) {
			assert.False(t, activatedAt.Before(since), name)
			assert.Equal(t, time.UTC, activatedAt.Location(), name)
		}
	}

	for _, key := range encryptionKeysOf(s) {
		assertActivated(string(key.Purpose), key.State, key.ActivatedAt, key.RetiredAt)
		assert.True(t, key.IsActive(), key.Purpose)
	}
	assertActivated("token signing key", s.TokenSigningKey.State, s.TokenSigningKey.ActivatedAt, s.TokenSigningKey.RetiredAt)
	assert.True(t, s.TokenSigningKey.IsActive())
}
