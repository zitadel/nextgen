package domain_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
)

var variableOwner = domain.VariableOwner{
	ProjectID:    "project-1",
	TeamID:       "team-1",
	UserSchemaID: "user-schema-1",
	UserID:       "user-1",
}

func TestNewVariable(t *testing.T) {
	t.Parallel()

	t.Run("keeps a valid scalar as-is", func(t *testing.T) {
		t.Parallel()

		v, err := domain.NewVariable("theme", variableOwner, "dark")
		require.NoError(t, err)
		assert.Equal(t, "theme", v.Name)
		assert.Equal(t, variableOwner, v.Owner)
		assert.Equal(t, "dark", v.Value)
		assert.False(t, v.IsSecret)
	})

	t.Run("requires an owning project", func(t *testing.T) {
		t.Parallel()

		_, err := domain.NewVariable("theme", domain.VariableOwner{}, "dark")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrNoVariableOwnerProjectID())
	})

	t.Run("rejects a name the placeholder syntax could not reference", func(t *testing.T) {
		t.Parallel()

		// The placeholder body is \w+, so a name outside that could be stored
		// but never referenced.
		for _, name := range []string{"", "with space", "dotted.name", "dash-ed", "${{x}}"} {
			_, err := domain.NewVariable(name, variableOwner, "v")
			require.Error(t, err, "name %q", name)
			assert.ErrorIs(t, err, domain.ErrInvalidVariableName())
		}
	})

	t.Run("rejects a value that is not a scalar", func(t *testing.T) {
		t.Parallel()

		for name, value := range map[string]any{
			"map":   map[string]any{"a": 1},
			"slice": []any{1, 2},
			"nil":   nil,
		} {
			t.Run(name, func(t *testing.T) {
				_, err := domain.NewVariable("v", variableOwner, value)
				require.Error(t, err)
				assert.ErrorIs(t, err, domain.ErrInvalidVariableValue())
			})
		}
	})

	t.Run("rejects a string past the size cap", func(t *testing.T) {
		t.Parallel()

		_, err := domain.NewVariable("v", variableOwner, strings.Repeat("A", domain.MaxVariableStringLength+1))
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidVariableValue())

		_, err = domain.NewVariable("v", variableOwner, strings.Repeat("A", domain.MaxVariableStringLength))
		require.NoError(t, err, "exactly at the cap is allowed")
	})
}

func TestNewSecretVariable(t *testing.T) {
	t.Parallel()

	t.Run("encrypts the marshalled value and stores only the ciphertext", func(t *testing.T) {
		t.Parallel()
		encrypter := cryptomock.NewMockEncrypter(gomock.NewController(t))

		// The crypter is handed JSON, which is what lets GetDecryptedValue
		// return the original type rather than text.
		encrypter.EXPECT().Encrypt(`"s3cret"`).Return("ciphertext", nil)

		v, err := domain.NewSecretVariable("token", variableOwner, "s3cret", encrypter)
		require.NoError(t, err)
		assert.True(t, v.IsSecret)
		assert.Equal(t, "ciphertext", v.Value, "the plaintext must not survive into the row")
	})

	t.Run("validates before encrypting", func(t *testing.T) {
		t.Parallel()
		// No EXPECT: an invalid variable must never reach the crypter.
		encrypter := cryptomock.NewMockEncrypter(gomock.NewController(t))

		_, err := domain.NewSecretVariable("bad name", variableOwner, "s3cret", encrypter)
		require.Error(t, err)

		_, err = domain.NewSecretVariable("token", domain.VariableOwner{}, "s3cret", encrypter)
		require.Error(t, err)

		_, err = domain.NewSecretVariable("token", variableOwner, map[string]any{"a": 1}, encrypter)
		require.Error(t, err)
	})

	t.Run("reports a failing encrypter", func(t *testing.T) {
		t.Parallel()
		encrypter := cryptomock.NewMockEncrypter(gomock.NewController(t))

		sentinel := errors.New("no key")
		encrypter.EXPECT().Encrypt(gomock.Any()).Return("", sentinel)

		_, err := domain.NewSecretVariable("token", variableOwner, "s3cret", encrypter)
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel, "the cause must stay in the chain")
	})
}

func TestVariableGetDecryptedValue(t *testing.T) {
	t.Parallel()

	t.Run("returns a plain value untouched and never calls the decrypter", func(t *testing.T) {
		t.Parallel()
		// No EXPECT: a variable that is not secret must not reach the decrypter.
		decrypter := cryptomock.NewMockDecrypter(gomock.NewController(t))

		v, err := domain.NewVariable("theme", variableOwner, "dark")
		require.NoError(t, err)

		got, err := v.GetDecryptedValue(decrypter)
		require.NoError(t, err)
		assert.Equal(t, "dark", got)
	})

	t.Run("round trips a secret through both halves", func(t *testing.T) {
		t.Parallel()
		crypter := cryptomock.NewMockCrypter(gomock.NewController(t))

		// Whatever Encrypt was handed is what Decrypt gives back, so the pair
		// composes to the identity the caller expects.
		crypter.EXPECT().Encrypt(gomock.Any()).DoAndReturn(func(plaintext string) (string, error) {
			crypter.EXPECT().Decrypt("ciphertext").Return(plaintext, nil)
			return "ciphertext", nil
		})

		v, err := domain.NewSecretVariable("token", variableOwner, "s3cret", crypter)
		require.NoError(t, err)

		got, err := v.GetDecryptedValue(crypter)
		require.NoError(t, err)
		assert.Equal(t, "s3cret", got, "the type survives the round trip")
	})

	t.Run("reports a secret whose stored value is not a string", func(t *testing.T) {
		t.Parallel()
		// No EXPECT: a value that cannot be ciphertext must not be handed over.
		decrypter := cryptomock.NewMockDecrypter(gomock.NewController(t))

		v := &domain.Variable{Name: "token", Owner: variableOwner, Value: 42, IsSecret: true}

		_, err := v.GetDecryptedValue(decrypter)
		require.Error(t, err)
	})

	t.Run("reports a failing decrypter", func(t *testing.T) {
		t.Parallel()
		decrypter := cryptomock.NewMockDecrypter(gomock.NewController(t))

		sentinel := errors.New("wrong key")
		decrypter.EXPECT().Decrypt("ciphertext").Return("", sentinel)

		v := &domain.Variable{Name: "token", Owner: variableOwner, Value: "ciphertext", IsSecret: true}

		_, err := v.GetDecryptedValue(decrypter)
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})

	// A wrong-but-working key decrypts to garbage rather than failing, so the
	// unmarshal is what catches it.
	t.Run("reports a decrypted value that is not valid JSON", func(t *testing.T) {
		t.Parallel()
		decrypter := cryptomock.NewMockDecrypter(gomock.NewController(t))

		decrypter.EXPECT().Decrypt("ciphertext").Return("not json", nil)

		v := &domain.Variable{Name: "token", Owner: variableOwner, Value: "ciphertext", IsSecret: true}

		_, err := v.GetDecryptedValue(decrypter)
		require.Error(t, err)
	})
}

func TestVariablesDecryptAll(t *testing.T) {
	t.Parallel()

	t.Run("opens secrets and leaves plain variables alone", func(t *testing.T) {
		t.Parallel()
		crypter := &crypto.InverseCrypter{}

		secret, err := domain.NewSecretVariable("token", variableOwner, "s3cret", crypter)
		require.NoError(t, err)
		plain, err := domain.NewVariable("theme", variableOwner, "dark")
		require.NoError(t, err)

		vars := domain.Variables{"token": secret, "theme": plain}
		decrypted, err := vars.DecryptAll(crypter)
		require.NoError(t, err)

		assert.Equal(t, "s3cret", decrypted["token"].Value)
		assert.Equal(t, "dark", decrypted["theme"].Value)
	})

	t.Run("returns a copy and does not mutate variables in place", func(t *testing.T) {
		t.Parallel()
		crypter := &crypto.InverseCrypter{}

		secret, err := domain.NewSecretVariable("token", variableOwner, "s3cret", crypter)
		require.NoError(t, err)
		ciphertext := secret.Value

		decrypted, err := domain.Variables{"token": secret}.DecryptAll(crypter)
		require.NoError(t, err)

		assert.Equal(t, "s3cret", decrypted["token"].Value, "the decrypted variable holds plaintext")
		assert.False(t, decrypted["token"].IsSecret, "and no longer reports itself as a secret")

		assert.Equal(t, ciphertext, secret.Value, "the caller's original variable still holds ciphertext")
		assert.True(t, secret.IsSecret, "and still reports itself as a secret")
	})

	t.Run("reports a secret it cannot decrypt", func(t *testing.T) {
		t.Parallel()

		broken := &domain.Variable{Name: "token", Owner: variableOwner, Value: "not-ciphertext", IsSecret: true}

		_, err := domain.Variables{"token": broken}.DecryptAll(&crypto.InverseCrypter{})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrFailedToDecryptVariable(nil))
	})
}
