package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/op"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedVariableService(t *testing.T) (service.VariableService, *servicemocks.MockAllStatements, *servicemocks.MockKeyService) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()

	// A batch of more than one variable is written inside a transaction, so the
	// same statements have to be reachable through the transactional statementer
	// as through the pool. Wired unconditionally: whether a case opens a
	// transaction is the service's decision, and the assertions are on
	// SetVariable either way.
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()

	keys := servicemocks.NewMockKeyService(ctrl)
	return service.NewVariableService(service.NewPool(pool), keys), statements, keys
}

var (
	variablesOwner = domain.VariableOwner{
		ProjectID:       "project-1",
		EnvironmentName: "prod",
	}
	variablesProjectOwner = domain.VariableOwner{ProjectID: variablesOwner.ProjectID}
)

// testCrypter is a real AES256GCM crypter, not a stand-in: it writes the key id
// into the JWE header of everything it encrypts, which is what the read path
// resolves the key by.
func testCrypter(keyID string) op.Crypto {
	var key [32]byte
	copy(key[:], keyID)
	return op.NewAES256GCMCrypto(key, keyID)
}

func testVariable(t *testing.T, name string, owner domain.VariableOwner, value any) *domain.Variable {
	t.Helper()
	v, err := domain.NewVariable(name, owner, value)
	require.NoError(t, err)
	return v
}

func TestVariableService_GetVariables(t *testing.T) {
	t.Run("passes the owner and names through", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		stored := []*domain.Variable{testVariable(t, "theme", variablesProjectOwner, "dark")}
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, "theme").Return(stored, nil)

		got, err := svc.GetVariables(t.Context(), variablesOwner, "theme")
		require.NoError(t, err)
		assert.Equal(t, stored, got)
	})

	t.Run("reports a storage failure", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner).Return(nil, sentinel)

		_, err := svc.GetVariables(t.Context(), variablesOwner)
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})
}

// setOne is the single-variable batch, which the service deliberately writes
// without opening a transaction.
func setOne(name string, value any, isSecret bool) []service.VariableToSet {
	return []service.VariableToSet{{Name: name, Value: value, IsSecret: isSecret}}
}

func TestVariableService_GetDecryptedVariables(t *testing.T) {
	const keyID = "key-1"
	const alg = jose.A256GCM

	encrypted := func(t *testing.T, plaintext string) string {
		t.Helper()
		ciphertext, err := testCrypter(keyID).Encrypt(`"` + plaintext + `"`)
		require.NoError(t, err)
		return ciphertext
	}

	t.Run("a read holding no secret never reaches the key service", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		// No key service EXPECT: building a decrypter for a plain read would be
		// a key lookup nobody asked for.
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, gomock.Any()).Return([]*domain.Variable{
			testVariable(t, "host", variablesOwner, "example.com"),
		}, nil)

		got, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, "host")
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, "example.com", got[0].Value)
	})

	// The point of the method: only what the caller named is decrypted, and it
	// still says which values were secret so the caller can redact them.
	t.Run("decrypts the secrets among the named variables and keeps them marked", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		keys.EXPECT().GetCrypter(gomock.Any(), keyID, alg).Return(testCrypter(keyID), nil).Times(1)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, gomock.Any()).Return([]*domain.Variable{
			testVariable(t, "client_id", variablesOwner, "public"),
			{Name: "client_secret", Owner: variablesOwner, Value: encrypted(t, "s3cret"), IsSecret: true},
		}, nil)

		got, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, "client_id", "client_secret")
		require.NoError(t, err)
		require.Len(t, got, 2)

		assert.Equal(t, "public", got[0].Value)
		assert.False(t, got[0].IsSecret)

		assert.Equal(t, "s3cret", got[1].Value)
		assert.True(t, got[1].IsSecret,
			"a decrypted secret stays marked, which is what a resolved document loses")
	})

	// Several secrets under one key cost one lookup, which is what makes this
	// no more expensive than substituting a document.
	t.Run("looks one key up once for several secrets under it", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		keys.EXPECT().GetCrypter(gomock.Any(), keyID, alg).Return(testCrypter(keyID), nil).Times(1)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, gomock.Any()).Return([]*domain.Variable{
			{Name: "a", Owner: variablesOwner, Value: encrypted(t, "one"), IsSecret: true},
			{Name: "b", Owner: variablesOwner, Value: encrypted(t, "two"), IsSecret: true},
		}, nil)

		got, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, "a", "b")
		require.NoError(t, err)
		assert.Equal(t, []any{"one", "two"}, []any{got[0].Value, got[1].Value})
	})

	// The rotation case, and the reason one decrypter is enough: it dispatches on
	// each value's own JWE header rather than being bound to a key. A secret
	// written before a rotation and one written after it sit side by side, and
	// each resolves to the key that wrote it.
	t.Run("decrypts variables written under different keys", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		const olderKeyID = "key-0"
		older, err := testCrypter(olderKeyID).Encrypt(`"written-before-rotation"`)
		require.NoError(t, err)

		keys.EXPECT().GetCrypter(gomock.Any(), olderKeyID, alg).Return(testCrypter(olderKeyID), nil).Times(1)
		keys.EXPECT().GetCrypter(gomock.Any(), keyID, alg).Return(testCrypter(keyID), nil).Times(1)

		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, gomock.Any()).Return([]*domain.Variable{
			{Name: "old_secret", Owner: variablesOwner, Value: older, IsSecret: true},
			{Name: "new_secret", Owner: variablesOwner, Value: encrypted(t, "written-after"), IsSecret: true},
		}, nil)

		got, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, "old_secret", "new_secret")
		require.NoError(t, err)
		assert.Equal(t, []any{"written-before-rotation", "written-after"},
			[]any{got[0].Value, got[1].Value})
	})

	t.Run("reports a value it cannot decrypt, naming it", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		sentinel := errors.New("key revoked")
		keys.EXPECT().GetCrypter(gomock.Any(), keyID, alg).Return(nil, sentinel)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, gomock.Any()).Return([]*domain.Variable{
			{Name: "client_secret", Owner: variablesOwner, Value: encrypted(t, "s3cret"), IsSecret: true},
		}, nil)

		_, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, "client_secret")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrFailedToDecryptVariable(nil))
	})
}

func TestVariableService_SetVariables(t *testing.T) {
	t.Run("stores a plain variable without consulting the key service", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		// No key service EXPECT: a plain variable must not need a key.
		statements.EXPECT().
			SetVariable(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, v *domain.Variable) error {
				assert.Equal(t, "theme", v.Name)
				assert.Equal(t, "dark", v.Value)
				assert.Equal(t, variablesOwner, v.Owner)
				assert.False(t, v.IsSecret)
				return nil
			})

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, setOne("theme", "dark", false)))
	})

	t.Run("encrypts a secret with the project's secret key", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		crypter := cryptomock.NewMockCrypter(gomock.NewController(t))
		crypter.EXPECT().Encrypt(`"s3cret"`).Return("ciphertext", nil)

		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesOwner.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(crypter, nil)

		statements.EXPECT().
			SetVariable(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, v *domain.Variable) error {
				assert.True(t, v.IsSecret)
				assert.Equal(t, "ciphertext", v.Value, "the plaintext must never reach storage")
				return nil
			})

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, setOne("token", "s3cret", true)))
	})

	// A failing key lookup used to fall through into encryption with a nil
	// crypter and panic; nothing may be written when there is no usable key.
	t.Run("reports a key lookup failure and writes nothing", func(t *testing.T) {
		svc, _, keys := newMockedVariableService(t)

		sentinel := errors.New("no secret key for project")
		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesOwner.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(nil, sentinel)

		// No SetVariable EXPECT: a write here would fail the test.
		err := svc.SetVariables(t.Context(), variablesOwner, setOne("token", "s3cret", true))
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})

	t.Run("rejects an invalid variable before touching storage", func(t *testing.T) {
		svc, _, _ := newMockedVariableService(t)

		// No storage EXPECT: validation happens in the constructor.
		err := svc.SetVariables(t.Context(), variablesOwner, setOne("bad name", "v", false))
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidVariableName())
	})

	t.Run("an empty batch is a no-op", func(t *testing.T) {
		svc, _, _ := newMockedVariableService(t)

		// No storage and no key EXPECT: nothing may be reached.
		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil))
	})

	// The key is fetched once for the batch, not once per secret: a PATCH
	// carrying several secrets is one key lookup.
	t.Run("looks the project key up once however many secrets the batch holds", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		crypter := cryptomock.NewMockCrypter(gomock.NewController(t))
		crypter.EXPECT().Encrypt(gomock.Any()).Return("ciphertext", nil).Times(2)

		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesOwner.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(crypter, nil).
			Times(1)

		statements.EXPECT().SetVariable(gomock.Any(), gomock.Any()).Return(nil).Times(3)

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, []service.VariableToSet{
			{Name: "client_id", Value: "public", IsSecret: false},
			{Name: "client_secret", Value: "s3cret", IsSecret: true},
			{Name: "signing_secret", Value: "s3cret2", IsSecret: true},
		}))
	})

	// Several names go in one transaction, so a failure partway through takes
	// the earlier writes with it rather than leaving half a PATCH applied.
	t.Run("writes a multi-name batch in one transaction", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().SetVariable(gomock.Any(), gomock.Any()).Return(nil).Times(2)

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, []service.VariableToSet{
			{Name: "host", Value: "example.com", IsSecret: false},
			{Name: "retries", Value: 3, IsSecret: false},
		}))
	})

	// Every value is constructed before any of them is written, so a bad name
	// late in the batch stops the earlier ones from reaching storage.
	t.Run("rejects the whole batch when one entry is invalid", func(t *testing.T) {
		svc, _, _ := newMockedVariableService(t)

		// No storage EXPECT: not even the valid first entry may be written.
		err := svc.SetVariables(t.Context(), variablesOwner, []service.VariableToSet{
			{Name: "good", Value: "v", IsSecret: false},
			{Name: "bad name", Value: "v", IsSecret: false},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidVariableName())
	})
}

func TestVariableService_DeleteVariable(t *testing.T) {
	t.Run("deletes at the owner that entered the variable", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, "theme").Return(nil)

		require.NoError(t, svc.DeleteVariable(t.Context(), variablesOwner, "theme"))
	})

	// Storage matches every owner column, so a variable the caller only
	// inherits reports no row -- which is the caller's "not found".
	t.Run("maps a missing row to ErrVariableNotFound", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().
			DeleteVariable(gomock.Any(), variablesOwner, "theme").
			Return(database.NewNoRowFoundError(nil))

		err := svc.DeleteVariable(t.Context(), variablesOwner, "theme")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrVariableNotFound())
	})

	t.Run("reports any other storage failure as internal", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, "theme").Return(sentinel)

		err := svc.DeleteVariable(t.Context(), variablesOwner, "theme")
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
		assert.NotErrorIs(t, err, domain.ErrVariableNotFound())
	})
}

func TestVariableService_ReplaceVariables(t *testing.T) {
	// The scan walks maps, so the placeholder names reach storage in whatever
	// order Go iterated them. Matching the variadic loosely keeps that from
	// making the test flaky.
	anyNames := gomock.Any()

	t.Run("substitutes values keeping their type", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		// No key service EXPECT: nothing here is secret, so no key is needed.
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{
			testVariable(t, "url", variablesProjectOwner, "https://example.test"),
			testVariable(t, "port", variablesProjectOwner, 8080),
		}, nil)

		doc := map[string]any{
			"url":    "${{ url }}",
			"port":   "${{ port }}",
			"nested": map[string]any{"list": []any{"${{ url }}"}},
		}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "https://example.test", doc["url"])
		assert.Equal(t, 8080, doc["port"])
		assert.Equal(t, "https://example.test", doc["nested"].(map[string]any)["list"].([]any)[0])
	})

	// A document with nothing to replace must not reach storage at all: an
	// empty name list would ask for every variable the owner holds.
	t.Run("does not touch storage for a document with no references", func(t *testing.T) {
		svc, _, _ := newMockedVariableService(t)

		// No EXPECT on either mock: any call fails the test.
		doc := map[string]any{"plain": "no references", "n": float64(1)}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, map[string]any{"plain": "no references", "n": float64(1)}, doc)
	})

	t.Run("asks storage only for the names the document references", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().
			GetVariables(gomock.Any(), variablesOwner, anyNames).
			DoAndReturn(func(_ context.Context, _ domain.VariableOwner, names ...string) ([]*domain.Variable, error) {
				// Referenced three times, asked for once.
				assert.Equal(t, []string{"url"}, names)
				return nil, nil
			})

		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, map[string]any{
			"a": "${{ url }}",
			"b": "${{ url }}",
			"c": []any{"${{ url }}"},
		}))
	})

	t.Run("resolves a name held at several levels to the nearest owner", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		// Storage returns the whole ladder because variables do not override.
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{
			testVariable(t, "url", variablesProjectOwner, "https://project"),
			testVariable(t, "url", variablesOwner, "https://user"),
		}, nil)

		doc := map[string]any{"url": "${{ url }}"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "https://user", doc["url"])
	})

	t.Run("decrypts a secret into the document", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		crypter := testCrypter("key-1")
		secret, err := domain.NewSecretVariable("token", variablesProjectOwner, "s3cret", crypter)
		require.NoError(t, err)
		require.NotEqual(t, "s3cret", secret.Value)

		// The key is fetched by the id the stored value names, not by project.
		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(crypter, nil)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{secret}, nil)

		doc := map[string]any{"token": "${{ token }}"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "s3cret", doc["token"])
	})

	// A variable outlives the key that was active when it was written, unlike a
	// cookie or a token. Reaching for the active key would make every stored
	// secret unreadable the first time the project's secret key is rotated.
	t.Run("decrypts with the key that wrote the secret, not the active one", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		retired := testCrypter("key-1")
		secret, err := domain.NewSecretVariable("token", variablesProjectOwner, "s3cret", retired)
		require.NoError(t, err)

		// No GetProjectCrypter EXPECT: asking for the project's active key
		// would hand back key-2 here, which cannot read what key-1 wrote.
		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(retired, nil)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{secret}, nil)

		doc := map[string]any{"token": "${{ token }}"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "s3cret", doc["token"])
	})

	// One key lookup however many secrets one document holds under it.
	t.Run("resolves each key once per document", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		crypter := testCrypter("key-1")
		first, err := domain.NewSecretVariable("first", variablesProjectOwner, "one", crypter)
		require.NoError(t, err)
		second, err := domain.NewSecretVariable("second", variablesProjectOwner, "two", crypter)
		require.NoError(t, err)

		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(crypter, nil).Times(1)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).
			Return([]*domain.Variable{first, second}, nil)

		doc := map[string]any{
			"first":  "${{ first }}",
			"second": "${{ second }}",
		}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "one", doc["first"])
		assert.Equal(t, "two", doc["second"])
	})

	t.Run("renders a reference embedded in text", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{
			testVariable(t, "host", variablesProjectOwner, "example.test"),
		}, nil)

		doc := map[string]any{"callback": "https://${{ host }}/callback"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "https://example.test/callback", doc["callback"])
	})

	t.Run("leaves a reference the owner holds nothing for", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return(nil, nil)

		doc := map[string]any{"url": "${{ nope }}"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "${{ nope }}", doc["url"])
	})

	t.Run("refuses a document that would expand beyond the budget", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		big := testVariable(t, "big", variablesProjectOwner, strings.Repeat("A", domain.MaxVariableStringLength))
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{big}, nil)

		doc := make(map[string]any, 200)
		for i := range 200 {
			doc[string(rune('a'+i%26))+string(rune('a'+i/26))] = "${{ big }}"
		}

		err := svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrVariableExpansionTooLarge())
	})

	t.Run("refuses a secret referenced as part of a larger string", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		secret, err := domain.NewSecretVariable("token", variablesProjectOwner, "s3cret", testCrypter("key-1"))
		require.NoError(t, err)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{secret}, nil)

		doc := map[string]any{"token": "Bearer ${{ token }}"}
		err = svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrSecretNotWholeValue())
		// The rejected document keeps its placeholder: nothing was written.
		assert.Equal(t, "Bearer ${{ token }}", doc["token"])
	})

	t.Run("reports a key lookup failure", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		secret, err := domain.NewSecretVariable("token", variablesProjectOwner, "s3cret", testCrypter("key-1"))
		require.NoError(t, err)

		sentinel := errors.New("no key with that id")
		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(nil, sentinel)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{secret}, nil)

		err = svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, map[string]any{"token": "${{ token }}"})
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})

	// A value flagged secret that is not something a crypter produced cannot
	// name a key, and must fail rather than reach the document as it stands.
	t.Run("reports a secret that carries no key id", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		broken := &domain.Variable{
			Name:     "token",
			Owner:    variablesProjectOwner,
			Value:    "not-ciphertext",
			IsSecret: true,
		}
		// No key service EXPECT: there is no key id to look up.
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return([]*domain.Variable{broken}, nil)

		doc := map[string]any{"token": "${{ token }}"}
		require.Error(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		// The placeholder stands: an unreadable secret never lands in the document.
		assert.Equal(t, "${{ token }}", doc["token"])
	})

	t.Run("reports a storage failure", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, anyNames).Return(nil, sentinel)

		err := svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, map[string]any{"url": "${{ url }}"})
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})
}
