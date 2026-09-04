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
	keys := servicemocks.NewMockKeyService(ctrl)
	return service.NewVariableService(service.NewPool(pool), keys), statements, keys
}

var (
	variablesRequester = domain.VariableOwner{
		ProjectID:    "project-1",
		TeamID:       "team-1",
		UserSchemaID: "user-schema-1",
		UserID:       "user-1",
	}
	variablesProjectOwner = domain.VariableOwner{ProjectID: variablesRequester.ProjectID}
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
	t.Run("passes the requester and names through", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		stored := []*domain.Variable{testVariable(t, "theme", variablesProjectOwner, "dark")}
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, "theme").Return(stored, nil)

		got, err := svc.GetVariables(t.Context(), variablesRequester, "theme")
		require.NoError(t, err)
		assert.Equal(t, stored, got)
	})

	t.Run("reports a storage failure", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester).Return(nil, sentinel)

		_, err := svc.GetVariables(t.Context(), variablesRequester)
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})
}

func TestVariableService_SetVariable(t *testing.T) {
	t.Run("stores a plain variable without consulting the key service", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		// No key service EXPECT: a plain variable must not need a key.
		statements.EXPECT().
			SetVariable(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, v *domain.Variable) error {
				assert.Equal(t, "theme", v.Name)
				assert.Equal(t, "dark", v.Value)
				assert.False(t, v.IsSecret)
				return nil
			})

		require.NoError(t, svc.SetVariable(t.Context(), "theme", variablesRequester, "dark", false))
	})

	t.Run("encrypts a secret with the project's secret key", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		crypter := cryptomock.NewMockCrypter(gomock.NewController(t))
		crypter.EXPECT().Encrypt(`"s3cret"`).Return("ciphertext", nil)

		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesRequester.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(crypter, nil)

		statements.EXPECT().
			SetVariable(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, v *domain.Variable) error {
				assert.True(t, v.IsSecret)
				assert.Equal(t, "ciphertext", v.Value, "the plaintext must never reach storage")
				return nil
			})

		require.NoError(t, svc.SetVariable(t.Context(), "token", variablesRequester, "s3cret", true))
	})

	// A failing key lookup used to fall through into encryption with a nil
	// crypter and panic; nothing may be written when there is no usable key.
	t.Run("reports a key lookup failure and writes nothing", func(t *testing.T) {
		svc, _, keys := newMockedVariableService(t)

		sentinel := errors.New("no secret key for project")
		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesRequester.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(nil, sentinel)

		// No SetVariable EXPECT: a write here would fail the test.
		err := svc.SetVariable(t.Context(), "token", variablesRequester, "s3cret", true)
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})

	t.Run("rejects an invalid variable before touching storage", func(t *testing.T) {
		svc, _, _ := newMockedVariableService(t)

		// No storage EXPECT: validation happens in the constructor.
		err := svc.SetVariable(t.Context(), "bad name", variablesRequester, "v", false)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidVariableName())
	})
}

func TestVariableService_DeleteVariable(t *testing.T) {
	t.Run("deletes at the owner that entered the variable", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().DeleteVariable(gomock.Any(), variablesRequester, "theme").Return(nil)

		require.NoError(t, svc.DeleteVariable(t.Context(), variablesRequester, "theme"))
	})

	// Storage matches every owner column, so a variable the caller only
	// inherits reports no row -- which is the caller's "not found".
	t.Run("maps a missing row to ErrVariableNotFound", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().
			DeleteVariable(gomock.Any(), variablesRequester, "theme").
			Return(database.NewNoRowFoundError(nil))

		err := svc.DeleteVariable(t.Context(), variablesRequester, "theme")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrVariableNotFound())
	})

	t.Run("reports any other storage failure as internal", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().DeleteVariable(gomock.Any(), variablesRequester, "theme").Return(sentinel)

		err := svc.DeleteVariable(t.Context(), variablesRequester, "theme")
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
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return([]*domain.Variable{
			testVariable(t, "url", variablesProjectOwner, "https://example.test"),
			testVariable(t, "port", variablesProjectOwner, 8080),
		}, nil)

		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{
			"url":    "${{ url }}",
			"port":   "${{ port }}",
			"nested": map[string]any{"list": []any{"${{ url }}"}},
		})
		require.NoError(t, err)
		assert.Equal(t, "https://example.test", got["url"])
		assert.Equal(t, 8080, got["port"])
		assert.Equal(t, "https://example.test", got["nested"].(map[string]any)["list"].([]any)[0])
	})

	// A document with nothing to replace must not reach storage at all: an
	// empty name list would ask for every variable the requester holds.
	t.Run("does not touch storage for a document with no references", func(t *testing.T) {
		svc, _, _ := newMockedVariableService(t)

		// No EXPECT on either mock: any call fails the test.
		doc := map[string]any{"plain": "no references", "n": float64(1)}
		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, doc)
		require.NoError(t, err)
		assert.Equal(t, doc, got)
	})

	t.Run("asks storage only for the names the document references", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().
			GetVariables(gomock.Any(), variablesRequester, anyNames).
			DoAndReturn(func(_ context.Context, _ domain.VariableOwner, names ...string) ([]*domain.Variable, error) {
				// Referenced three times, asked for once.
				assert.Equal(t, []string{"url"}, names)
				return nil, nil
			})

		_, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{
			"a": "${{ url }}",
			"b": "${{ url }}",
			"c": []any{"${{ url }}"},
		})
		require.NoError(t, err)
	})

	t.Run("resolves a name held at several levels to the nearest owner", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		// Storage returns the whole ladder because variables do not override.
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return([]*domain.Variable{
			testVariable(t, "url", variablesProjectOwner, "https://project"),
			testVariable(t, "url", variablesRequester, "https://user"),
		}, nil)

		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{"url": "${{ url }}"})
		require.NoError(t, err)
		assert.Equal(t, "https://user", got["url"])
	})

	t.Run("decrypts a secret into the document", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		crypter := testCrypter("key-1")
		secret, err := domain.NewSecretVariable("token", variablesProjectOwner, "s3cret", crypter)
		require.NoError(t, err)
		require.NotEqual(t, "s3cret", secret.Value)

		// The key is fetched by the id the stored value names, not by project.
		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(crypter, nil)
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return([]*domain.Variable{secret}, nil)

		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{"token": "${{ token }}"})
		require.NoError(t, err)
		assert.Equal(t, "s3cret", got["token"])
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
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return([]*domain.Variable{secret}, nil)

		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{"token": "${{ token }}"})
		require.NoError(t, err)
		assert.Equal(t, "s3cret", got["token"])
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
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).
			Return([]*domain.Variable{first, second}, nil)

		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{
			"first":  "${{ first }}",
			"second": "${{ second }}",
		})
		require.NoError(t, err)
		assert.Equal(t, "one", got["first"])
		assert.Equal(t, "two", got["second"])
	})

	t.Run("renders a reference embedded in text", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return([]*domain.Variable{
			testVariable(t, "host", variablesProjectOwner, "example.test"),
		}, nil)

		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{
			"callback": "https://${{ host }}/callback",
		})
		require.NoError(t, err)
		assert.Equal(t, "https://example.test/callback", got["callback"])
	})

	t.Run("leaves a reference the requester holds nothing for", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return(nil, nil)

		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{"url": "${{ nope }}"})
		require.NoError(t, err)
		assert.Equal(t, "${{ nope }}", got["url"])
	})

	t.Run("refuses a document that would expand beyond the budget", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		big := testVariable(t, "big", variablesProjectOwner, strings.Repeat("A", domain.MaxVariableStringLength))
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return([]*domain.Variable{big}, nil)

		doc := make(map[string]any, 200)
		for i := range 200 {
			doc[string(rune('a'+i%26))+string(rune('a'+i/26))] = "${{ big }}"
		}

		_, err := svc.ReplaceVariables(t.Context(), variablesRequester, doc)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrVariableExpansionTooLarge())
	})

	t.Run("reports a key lookup failure", func(t *testing.T) {
		svc, statements, keys := newMockedVariableService(t)

		secret, err := domain.NewSecretVariable("token", variablesProjectOwner, "s3cret", testCrypter("key-1"))
		require.NoError(t, err)

		sentinel := errors.New("no key with that id")
		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(nil, sentinel)
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return([]*domain.Variable{secret}, nil)

		_, err = svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{"token": "${{ token }}"})
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
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return([]*domain.Variable{broken}, nil)

		got, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{"token": "${{ token }}"})
		require.Error(t, err)
		assert.Nil(t, got)
	})

	t.Run("reports a storage failure", func(t *testing.T) {
		svc, statements, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().GetVariables(gomock.Any(), variablesRequester, anyNames).Return(nil, sentinel)

		_, err := svc.ReplaceVariables(t.Context(), variablesRequester, map[string]any{"url": "${{ url }}"})
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})
}
