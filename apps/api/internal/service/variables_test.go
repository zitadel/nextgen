package service_test

import (
	"context"
	"errors"
	"fmt"
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

// newMockedVariableService wires the service over mocked statements. Every
// event the service inserts is collected into the returned slice, so a case
// can assert on what was recorded without an expectation per row.
func newMockedVariableService(t *testing.T) (service.VariableService, *servicemocks.MockAllStatements, *servicemocks.MockKeyService, *[]*domain.Event) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()

	// Every write runs inside a transaction, so the same statements have to be
	// reachable through the transactional statementer as through the pool.
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()

	events := new([]*domain.Event)
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, event *domain.Event) error {
			*events = append(*events, event)
			return nil
		},
	).AnyTimes()

	keys := servicemocks.NewMockKeyService(ctrl)
	return service.NewVariableService(service.NewPool(pool), keys), statements, keys, events
}

// expectCapRead is the pair of reads the service does around writing a kind,
// measuring what the kind holds before and after against the cell a
// deployment freezes it into. Nothing stored, so the measure passes; the cap
// itself is its own case.
func expectCapRead(statements *servicemocks.MockAllStatements, kinds ...domain.DeploymentOriginKind) {
	for _, kind := range kinds {
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, kind).Return(nil, nil).Times(2)
	}
}

var (
	variablesOwner = domain.VariableOwner{ProjectID: "project-1"}

	primaryKind = new(domain.DeploymentOriginKindPrimary)
	previewKind = new(domain.DeploymentOriginKindPreview)
	bothKinds   = []domain.DeploymentOriginKind{domain.DeploymentOriginKindPrimary, domain.DeploymentOriginKindPreview}
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
		svc, statements, _, _ := newMockedVariableService(t)

		stored := []*domain.Variable{testVariable(t, "theme", variablesOwner, "dark")}
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, "theme").Return(stored, nil)

		got, err := svc.GetVariables(t.Context(), variablesOwner, primaryKind, "theme")
		require.NoError(t, err)
		assert.Equal(t, stored, got)
	})

	// No kind is both kinds, as two reads: the store admits one kind per
	// read, and a caller that asked for both gets each row with its kind so
	// it can tell them apart.
	t.Run("reads both kinds when none is named, primary first", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		primary := testVariable(t, "theme", variablesOwner, "dark")
		preview := testVariable(t, "theme", variablesOwner, "light")
		preview.Kind = domain.DeploymentOriginKindPreview
		gomock.InOrder(
			statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, "theme").Return([]*domain.Variable{primary}, nil),
			statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "theme").Return([]*domain.Variable{preview}, nil),
		)

		got, err := svc.GetVariables(t.Context(), variablesOwner, nil, "theme")
		require.NoError(t, err)
		assert.Equal(t, []*domain.Variable{primary, preview}, got)
	})

	t.Run("reports a storage failure", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary).Return(nil, sentinel)

		_, err := svc.GetVariables(t.Context(), variablesOwner, primaryKind)
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})
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
		svc, statements, _, _ := newMockedVariableService(t)

		// No key service EXPECT: building a decrypter for a plain read would be
		// a key lookup nobody asked for.
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, gomock.Any()).Return([]*domain.Variable{
			testVariable(t, "host", variablesOwner, "example.com"),
		}, nil)

		got, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, primaryKind, "host")
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, "example.com", got[0].Value)
	})

	// The point of the method: only what the caller named is decrypted, and it
	// still says which values were secret so the caller can redact them.
	t.Run("decrypts the secrets among the named variables and keeps them marked", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		keys.EXPECT().GetCrypter(gomock.Any(), keyID, alg).Return(testCrypter(keyID), nil).Times(1)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, gomock.Any()).Return([]*domain.Variable{
			testVariable(t, "client_id", variablesOwner, "public"),
			{Name: "client_secret", Owner: variablesOwner, Value: encrypted(t, "s3cret"), IsSecret: true},
		}, nil)

		got, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, primaryKind, "client_id", "client_secret")
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
		svc, statements, keys, _ := newMockedVariableService(t)

		keys.EXPECT().GetCrypter(gomock.Any(), keyID, alg).Return(testCrypter(keyID), nil).Times(1)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, gomock.Any()).Return([]*domain.Variable{
			{Name: "a", Owner: variablesOwner, Value: encrypted(t, "one"), IsSecret: true},
			{Name: "b", Owner: variablesOwner, Value: encrypted(t, "two"), IsSecret: true},
		}, nil)

		got, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, primaryKind, "a", "b")
		require.NoError(t, err)
		assert.Equal(t, []any{"one", "two"}, []any{got[0].Value, got[1].Value})
	})

	// The rotation case, and the reason one decrypter is enough: it dispatches on
	// each value's own JWE header rather than being bound to a key. A secret
	// written before a rotation and one written after it sit side by side, and
	// each resolves to the key that wrote it.
	t.Run("decrypts variables written under different keys", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		const olderKeyID = "key-0"
		older, err := testCrypter(olderKeyID).Encrypt(`"written-before-rotation"`)
		require.NoError(t, err)

		keys.EXPECT().GetCrypter(gomock.Any(), olderKeyID, alg).Return(testCrypter(olderKeyID), nil).Times(1)
		keys.EXPECT().GetCrypter(gomock.Any(), keyID, alg).Return(testCrypter(keyID), nil).Times(1)

		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, gomock.Any()).Return([]*domain.Variable{
			{Name: "old_secret", Owner: variablesOwner, Value: older, IsSecret: true},
			{Name: "new_secret", Owner: variablesOwner, Value: encrypted(t, "written-after"), IsSecret: true},
		}, nil)

		got, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, primaryKind, "old_secret", "new_secret")
		require.NoError(t, err)
		assert.Equal(t, []any{"written-before-rotation", "written-after"},
			[]any{got[0].Value, got[1].Value})
	})

	t.Run("reports a value it cannot decrypt, naming it", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		sentinel := errors.New("key revoked")
		keys.EXPECT().GetCrypter(gomock.Any(), keyID, alg).Return(nil, sentinel)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, gomock.Any()).Return([]*domain.Variable{
			{Name: "client_secret", Owner: variablesOwner, Value: encrypted(t, "s3cret"), IsSecret: true},
		}, nil)

		_, err := svc.GetDecryptedVariables(t.Context(), variablesOwner, primaryKind, "client_secret")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrFailedToDecryptVariable(nil))
	})
}

func TestVariableService_SetVariables(t *testing.T) {
	// A plain value with no kind applies to both targets, so it is two rows,
	// and the batch is still one transaction.
	t.Run("stores a plain variable for both kinds without consulting the key service", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		// No key service EXPECT: a plain variable must not need a key.
		var kinds []domain.DeploymentOriginKind
		statements.EXPECT().
			SetVariable(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, v *domain.Variable) error {
				assert.Equal(t, "theme", v.Name)
				assert.Equal(t, "dark", v.Value)
				assert.Equal(t, variablesOwner, v.Owner)
				assert.False(t, v.IsSecret)
				kinds = append(kinds, v.Kind)
				return nil
			}).
			Times(2)
		expectCapRead(statements, bothKinds...)

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "theme", Value: "dark"},
		}))
		assert.Equal(t, bothKinds, kinds)
	})

	// The project was resolved from the request, so its reference failing means
	// it was deleted between the access check and the write.
	t.Run("reports a project that is gone as not found", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		// The measure before the write still runs; the write then fails.
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, gomock.Any()).Return(nil, nil).Times(2)
		statements.EXPECT().
			SetVariable(gomock.Any(), gomock.Any()).
			Return(database.NewForeignKeyError("variables", "fk_variables_project", errors.New("fk")))

		err := svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "theme", Value: "dark"},
		})
		assert.ErrorIs(t, err, domain.ErrProjectNotFound())
	})

	// A secret with no kind lands in primary only: a preview URL is reachable
	// by anyone who can guess it. It also removes the name's preview row,
	// which is usually the plaintext the caller meant to protect.
	t.Run("encrypts a secret with the project's secret key and stores it for primary only", func(t *testing.T) {
		expectSecretWrite := func(t *testing.T, statements *servicemocks.MockAllStatements, keys *servicemocks.MockKeyService) {
			t.Helper()
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
					assert.Equal(t, domain.DeploymentOriginKindPrimary, v.Kind)
					return nil
				}).
				Times(1)
			expectCapRead(statements, domain.DeploymentOriginKindPrimary)
		}

		t.Run("removing the preview row the name held", func(t *testing.T) {
			svc, statements, keys, events := newMockedVariableService(t)
			expectSecretWrite(t, statements, keys)
			statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "token").Return(nil)

			require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
				{Name: "token", Value: "s3cret", IsSecret: true},
			}))
			require.Len(t, *events, 2, "the removal and the write are each recorded")
			assert.Equal(t, domain.EventTypeVariableRemoved, (*events)[0].EventType)
			assert.JSONEq(t, `{"kind":"preview"}`, string((*events)[0].Payload))
			assert.Equal(t, domain.EventTypeVariableSet, (*events)[1].EventType)
		})

		// Nothing to remove is not an error, and nothing removed is nothing
		// recorded.
		t.Run("with no preview row to remove", func(t *testing.T) {
			svc, statements, keys, events := newMockedVariableService(t)
			expectSecretWrite(t, statements, keys)
			statements.EXPECT().
				DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "token").
				Return(database.NewNoRowFoundError(nil))

			require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
				{Name: "token", Value: "s3cret", IsSecret: true},
			}))
			require.Len(t, *events, 1)
			assert.Equal(t, domain.EventTypeVariableSet, (*events)[0].EventType)
		})
	})

	// A failing key lookup used to fall through into encryption with a nil
	// crypter and panic; nothing may be written when there is no usable key.
	t.Run("reports a key lookup failure and writes nothing", func(t *testing.T) {
		svc, _, keys, _ := newMockedVariableService(t)

		sentinel := errors.New("no secret key for project")
		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesOwner.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(nil, sentinel)

		// No SetVariable EXPECT: a write here would fail the test.
		err := svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "token", Value: "s3cret", IsSecret: true},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})

	t.Run("rejects an invalid variable before touching storage", func(t *testing.T) {
		svc, _, _, _ := newMockedVariableService(t)

		// No storage EXPECT: validation happens in the constructor.
		err := svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "bad name", Value: "v", IsSecret: false},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidVariableName())
	})

	t.Run("an empty batch is a no-op", func(t *testing.T) {
		svc, _, _, _ := newMockedVariableService(t)

		// No storage and no key EXPECT: nothing may be reached.
		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, nil))
	})

	// The key is fetched once for the batch, not once per secret, and each
	// secret is encrypted once: a PATCH carrying several secrets is one key
	// lookup.
	t.Run("looks the project key up once however many secrets the batch holds", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		crypter := cryptomock.NewMockCrypter(gomock.NewController(t))
		crypter.EXPECT().Encrypt(gomock.Any()).Return("ciphertext", nil).Times(2)

		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesOwner.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(crypter, nil).
			Times(1)

		// The plain value is two rows, each secret one -- and each secret
		// clears its preview row, held or not.
		statements.EXPECT().SetVariable(gomock.Any(), gomock.Any()).Return(nil).Times(4)
		statements.EXPECT().
			DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, gomock.Any()).
			Return(database.NewNoRowFoundError(nil)).
			Times(2)
		expectCapRead(statements, bothKinds...)

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "client_id", Value: "public", IsSecret: false},
			{Name: "client_secret", Value: "s3cret", IsSecret: true},
			{Name: "signing_secret", Value: "s3cret2", IsSecret: true},
		}))
	})

	// Several names go in one transaction, so a failure partway through takes
	// the earlier writes with it rather than leaving half a PATCH applied.
	t.Run("writes a multi-name batch in one transaction", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		statements.EXPECT().SetVariable(gomock.Any(), gomock.Any()).Return(nil).Times(4)
		expectCapRead(statements, bothKinds...)

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "host", Value: "example.com", IsSecret: false},
			{Name: "retries", Value: 3, IsSecret: false},
		}))
	})

	// Every value is constructed before any of them is written, so a bad name
	// late in the batch stops the earlier ones from reaching storage.
	t.Run("rejects the whole batch when one entry is invalid", func(t *testing.T) {
		svc, _, _, _ := newMockedVariableService(t)

		// No storage EXPECT: not even the valid first entry may be written.
		err := svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "good", Value: "v", IsSecret: false},
			{Name: "bad name", Value: "v", IsSecret: false},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidVariableName())
	})

	// With a kind named, that kind alone is touched, secret or not: naming
	// preview is how a secret reaches a preview target at all.
	t.Run("with a kind, writes and removes that kind only", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		crypter := cryptomock.NewMockCrypter(gomock.NewController(t))
		crypter.EXPECT().Encrypt(`"s3cret"`).Return("ciphertext", nil)
		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesOwner.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(crypter, nil)

		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "legacy").Return(nil)
		var kinds []domain.DeploymentOriginKind
		statements.EXPECT().
			SetVariable(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, v *domain.Variable) error {
				kinds = append(kinds, v.Kind)
				return nil
			}).
			Times(2)
		expectCapRead(statements, domain.DeploymentOriginKindPreview)

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, previewKind, []service.VariableToSet{
			{Name: "theme", Value: "light"},
			{Name: "token", Value: "s3cret", IsSecret: true},
			{Name: "legacy"},
		}))
		assert.Equal(t, []domain.DeploymentOriginKind{domain.DeploymentOriginKindPreview, domain.DeploymentOriginKindPreview}, kinds)
	})

	// A null in the body is a removal (RFC 7386), so a patch can carry names
	// to remove without carrying anything to write. Without a kind the name
	// goes from both.
	t.Run("removes the names a patch carries from both kinds", func(t *testing.T) {
		svc, statements, _, events := newMockedVariableService(t)

		// No key EXPECT: a removal never needs the value, so never a key. No
		// GetVariables EXPECT either: a removal only shrinks a kind, so the
		// cap is not measured.
		for _, kind := range bothKinds {
			statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, kind, "theme").Return(nil)
			statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, kind, "locale").Return(nil)
		}

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "theme"},
			{Name: "locale"},
		}))
		assert.Len(t, *events, 4, "one event per row removed")
	})

	// The one place a patch differs from DELETE /variables/{name}: a patch says
	// what the owner holds afterwards, and a name it removes that was not there
	// already satisfies that. It is also what makes a retry safe. Nothing was
	// removed, so nothing is recorded.
	t.Run("removing a name the owner does not hold is not an error", func(t *testing.T) {
		svc, statements, _, events := newMockedVariableService(t)

		for _, kind := range bothKinds {
			statements.EXPECT().
				DeleteVariable(gomock.Any(), variablesOwner, kind, "theme").
				Return(database.NewNoRowFoundError(nil))
		}

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "theme"},
		}))
		assert.Empty(t, *events)
	})

	t.Run("reports a removal failure that is not a missing row", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, "theme").Return(sentinel)

		err := svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "theme"},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})

	// Writes and removals share one transaction, so a body that enters one name
	// and removes another lands whole or not at all. Removals run first.
	t.Run("applies writes and removals together, removals first", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		gomock.InOrder(
			statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, "legacy_host").Return(nil),
			statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "legacy_host").Return(nil),
			statements.EXPECT().
				SetVariable(gomock.Any(), gomock.Any()).
				DoAndReturn(func(_ context.Context, v *domain.Variable) error {
					assert.Equal(t, "host", v.Name)
					return nil
				}).
				Times(2),
		)
		expectCapRead(statements, bothKinds...)

		// The write is first in the batch and the removal still runs first: the
		// service partitions the entries rather than replaying their order.
		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "host", Value: "example.com"},
			{Name: "legacy_host", Value: nil},
		}))
	})

	// The whole patch is built before any statement runs, so a bad value beside
	// a removal stops the removal from happening at all.
	t.Run("removes nothing when a value in the same patch is invalid", func(t *testing.T) {
		svc, _, _, _ := newMockedVariableService(t)

		// No storage EXPECT: the removal must not reach storage either.
		err := svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "bad name", Value: "v"},
			{Name: "theme", Value: nil},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidVariableName())
	})

	// Enough of the largest plain value to pass the cap on its own: the
	// entries column holds each one as JSON, so 600 of them are just over
	// 9 MiB.
	oversized := func(t *testing.T, count int) []*domain.Variable {
		t.Helper()
		stored := make([]*domain.Variable, 0, count)
		for i := range count {
			stored = append(stored, testVariable(t, fmt.Sprintf("BIG_%d", i), variablesOwner, strings.Repeat("A", domain.MaxVariableStringLength)))
		}
		return stored
	}

	// The cap is measured on what the kind holds after the write, inside the
	// transaction, so the refusal rolls the write back with it. Both kinds
	// are measured before and after the writes; primary grew past the cap.
	t.Run("refuses a write after which a kind would not fit in one deployment", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		statements.EXPECT().SetVariable(gomock.Any(), gomock.Any()).Return(nil).Times(2)

		gomock.InOrder(
			statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary).Return(oversized(t, 599), nil),
			statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview).Return(nil, nil),
			statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary).Return(oversized(t, 600), nil),
			statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview).Return(nil, nil),
		)

		err := svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "ONE_MORE", Value: "x"},
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrVariableLimitExceeded())
		var de domain.Error
		require.ErrorAs(t, err, &de)
		details, ok := de.Details.(map[string]any)
		require.True(t, ok, "details: %#v", de.Details)
		assert.Equal(t, "primary", details["kind"])
		assert.Equal(t, domain.MaxVariableSetBytes, details["limit"])
		assert.Greater(t, details["size"], domain.MaxVariableSetBytes)
	})

	// A kind can already be over the cap when the write starts: the cap was
	// lowered, or a Postgres race overshot it. A write that shrinks it has to
	// get through, or a removal would be the only way back under the cap.
	t.Run("lets a write through that shrinks a kind already over the cap", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		statements.EXPECT().SetVariable(gomock.Any(), gomock.Any()).Return(nil).Times(1)

		before := oversized(t, 601)
		after := oversized(t, 600)
		gomock.InOrder(
			statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary).Return(before, nil),
			statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary).Return(after, nil),
		)

		// Replacing a large value with a short one: still over the cap, but
		// smaller than it was.
		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, primaryKind, []service.VariableToSet{
			{Name: "BIG_0", Value: "x"},
		}))
	})

	// Each row written or removed is one event, and the value is in none of
	// them: neither the plaintext nor the ciphertext of a secret, nor a plain
	// value, which may be a secret the caller forgot to flag.
	t.Run("records each row written and removed, never the value", func(t *testing.T) {
		svc, statements, keys, events := newMockedVariableService(t)

		crypter := cryptomock.NewMockCrypter(gomock.NewController(t))
		crypter.EXPECT().Encrypt(`"s3cret"`).Return("ciphertext", nil)
		keys.EXPECT().
			GetProjectCrypter(gomock.Any(), variablesOwner.ProjectID, domain.EncryptionKeyPurposeSecret).
			Return(crypter, nil)

		statements.EXPECT().SetVariable(gomock.Any(), gomock.Any()).Return(nil).Times(3)
		// The secret's preview row: not held, so nothing is recorded for it.
		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "token").
			Return(database.NewNoRowFoundError(nil))
		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, "legacy").Return(nil)
		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "legacy").
			Return(database.NewNoRowFoundError(nil))
		expectCapRead(statements, bothKinds...)

		require.NoError(t, svc.SetVariables(t.Context(), variablesOwner, nil, []service.VariableToSet{
			{Name: "theme", Value: "dark"},
			{Name: "token", Value: "s3cret", IsSecret: true},
			{Name: "legacy"},
		}))

		type recorded struct {
			eventType domain.EventType
			entityID  string
			payload   string
		}
		got := make([]recorded, 0, len(*events))
		for _, event := range *events {
			require.Equal(t, variablesOwner.ProjectID, event.ProjectID)
			require.Equal(t, domain.EventCategoryEntity, event.Category)
			require.NotNil(t, event.EntityType)
			assert.Equal(t, "variable", *event.EntityType)
			require.NotNil(t, event.EntityID)
			for _, value := range []string{"dark", "s3cret", "ciphertext"} {
				assert.NotContains(t, string(event.Payload), value)
			}
			got = append(got, recorded{event.EventType, *event.EntityID, string(event.Payload)})
		}
		want := []recorded{
			{domain.EventTypeVariableRemoved, "legacy", `{"kind":"primary"}`},
			{domain.EventTypeVariableSet, "theme", `{"kind":"primary","secret":false}`},
			{domain.EventTypeVariableSet, "theme", `{"kind":"preview","secret":false}`},
			{domain.EventTypeVariableSet, "token", `{"kind":"primary","secret":true}`},
		}
		require.Len(t, got, len(want))
		for i := range want {
			assert.Equal(t, want[i].eventType, got[i].eventType)
			assert.Equal(t, want[i].entityID, got[i].entityID)
			assert.JSONEq(t, want[i].payload, got[i].payload)
		}
	})
}

func TestVariableService_DeleteVariable(t *testing.T) {
	t.Run("deletes the named kind at the owner that entered the variable", func(t *testing.T) {
		svc, statements, _, events := newMockedVariableService(t)

		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, "theme").Return(nil)

		require.NoError(t, svc.DeleteVariable(t.Context(), variablesOwner, primaryKind, "theme"))
		require.Len(t, *events, 1)
		assert.Equal(t, domain.EventTypeVariableRemoved, (*events)[0].EventType)
		assert.JSONEq(t, `{"kind":"primary"}`, string((*events)[0].Payload))
	})

	t.Run("removes both kinds when none is named", func(t *testing.T) {
		svc, statements, _, events := newMockedVariableService(t)

		for _, kind := range bothKinds {
			statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, kind, "theme").Return(nil)
		}

		require.NoError(t, svc.DeleteVariable(t.Context(), variablesOwner, nil, "theme"))
		assert.Len(t, *events, 2, "one event per row removed")
	})

	// A row for one kind alone is a variable the caller can see, so removing
	// the name without a kind succeeds on it; only a name neither kind held
	// is not found.
	t.Run("without a kind, is not found only when neither kind held the name", func(t *testing.T) {
		t.Run("one kind held it", func(t *testing.T) {
			svc, statements, _, events := newMockedVariableService(t)

			statements.EXPECT().
				DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, "theme").
				Return(database.NewNoRowFoundError(nil))
			statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "theme").Return(nil)

			require.NoError(t, svc.DeleteVariable(t.Context(), variablesOwner, nil, "theme"))
			require.Len(t, *events, 1)
			assert.JSONEq(t, `{"kind":"preview"}`, string((*events)[0].Payload))
		})

		t.Run("neither held it", func(t *testing.T) {
			svc, statements, _, events := newMockedVariableService(t)

			for _, kind := range bothKinds {
				statements.EXPECT().
					DeleteVariable(gomock.Any(), variablesOwner, kind, "theme").
					Return(database.NewNoRowFoundError(nil))
			}

			err := svc.DeleteVariable(t.Context(), variablesOwner, nil, "theme")
			require.Error(t, err)
			assert.ErrorIs(t, err, domain.ErrVariableNotFound())
			assert.Empty(t, *events)
		})
	})

	// Storage matches every owner column and the kind, so a name held for the
	// other kind alone reports no row -- which is the caller's "not found".
	t.Run("with a kind, maps a missing row to ErrVariableNotFound", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		statements.EXPECT().
			DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPreview, "theme").
			Return(database.NewNoRowFoundError(nil))

		err := svc.DeleteVariable(t.Context(), variablesOwner, previewKind, "theme")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrVariableNotFound())
	})

	t.Run("reports any other storage failure as internal", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().DeleteVariable(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, "theme").Return(sentinel)

		err := svc.DeleteVariable(t.Context(), variablesOwner, primaryKind, "theme")
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
		svc, statements, _, _ := newMockedVariableService(t)

		// No key service EXPECT: nothing here is secret, so no key is needed.
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return([]*domain.Variable{
			testVariable(t, "url", variablesOwner, "https://example.test"),
			testVariable(t, "port", variablesOwner, 8080),
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
		svc, _, _, _ := newMockedVariableService(t)

		// No EXPECT on either mock: any call fails the test.
		doc := map[string]any{"plain": "no references", "n": float64(1)}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, map[string]any{"plain": "no references", "n": float64(1)}, doc)
	})

	t.Run("asks storage only for the names the document references", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		statements.EXPECT().
			GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).
			DoAndReturn(func(_ context.Context, _ domain.VariableOwner, _ domain.DeploymentOriginKind, names ...string) ([]*domain.Variable, error) {
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

	t.Run("decrypts a secret into the document", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		crypter := testCrypter("key-1")
		secret, err := domain.NewSecretVariable("token", variablesOwner, "s3cret", crypter)
		require.NoError(t, err)
		require.NotEqual(t, "s3cret", secret.Value)

		// The key is fetched by the id the stored value names, not by project.
		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(crypter, nil)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return([]*domain.Variable{secret}, nil)

		doc := map[string]any{"token": "${{ token }}"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "s3cret", doc["token"])
	})

	// A variable outlives the key that was active when it was written, unlike a
	// cookie or a token. Reaching for the active key would make every stored
	// secret unreadable the first time the project's secret key is rotated.
	t.Run("decrypts with the key that wrote the secret, not the active one", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		retired := testCrypter("key-1")
		secret, err := domain.NewSecretVariable("token", variablesOwner, "s3cret", retired)
		require.NoError(t, err)

		// No GetProjectCrypter EXPECT: asking for the project's active key
		// would hand back key-2 here, which cannot read what key-1 wrote.
		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(retired, nil)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return([]*domain.Variable{secret}, nil)

		doc := map[string]any{"token": "${{ token }}"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "s3cret", doc["token"])
	})

	// One key lookup however many secrets one document holds under it.
	t.Run("resolves each key once per document", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		crypter := testCrypter("key-1")
		first, err := domain.NewSecretVariable("first", variablesOwner, "one", crypter)
		require.NoError(t, err)
		second, err := domain.NewSecretVariable("second", variablesOwner, "two", crypter)
		require.NoError(t, err)

		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(crypter, nil).Times(1)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).
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
		svc, statements, _, _ := newMockedVariableService(t)

		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return([]*domain.Variable{
			testVariable(t, "host", variablesOwner, "example.test"),
		}, nil)

		doc := map[string]any{"callback": "https://${{ host }}/callback"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "https://example.test/callback", doc["callback"])
	})

	t.Run("leaves a reference the owner holds nothing for", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return(nil, nil)

		doc := map[string]any{"url": "${{ nope }}"}
		require.NoError(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		assert.Equal(t, "${{ nope }}", doc["url"])
	})

	t.Run("refuses a document that would expand beyond the budget", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		big := testVariable(t, "big", variablesOwner, strings.Repeat("A", domain.MaxVariableStringLength))
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return([]*domain.Variable{big}, nil)

		doc := make(map[string]any, 200)
		for i := range 200 {
			doc[string(rune('a'+i%26))+string(rune('a'+i/26))] = "${{ big }}"
		}

		err := svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrVariableExpansionTooLarge())
	})

	t.Run("refuses a secret referenced as part of a larger string", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		secret, err := domain.NewSecretVariable("token", variablesOwner, "s3cret", testCrypter("key-1"))
		require.NoError(t, err)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return([]*domain.Variable{secret}, nil)

		doc := map[string]any{"token": "Bearer ${{ token }}"}
		err = svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrSecretNotWholeValue())
		// The rejected document keeps its placeholder: nothing was written.
		assert.Equal(t, "Bearer ${{ token }}", doc["token"])
	})

	t.Run("reports a key lookup failure", func(t *testing.T) {
		svc, statements, keys, _ := newMockedVariableService(t)

		secret, err := domain.NewSecretVariable("token", variablesOwner, "s3cret", testCrypter("key-1"))
		require.NoError(t, err)

		sentinel := errors.New("no key with that id")
		keys.EXPECT().GetCrypter(gomock.Any(), "key-1", jose.A256GCM).Return(nil, sentinel)
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return([]*domain.Variable{secret}, nil)

		err = svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, map[string]any{"token": "${{ token }}"})
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})

	// A value flagged secret that is not something a crypter produced cannot
	// name a key, and must fail rather than reach the document as it stands.
	t.Run("reports a secret that carries no key id", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		broken := &domain.Variable{
			Name:     "token",
			Owner:    variablesOwner,
			Value:    "not-ciphertext",
			IsSecret: true,
		}
		// No key service EXPECT: there is no key id to look up.
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return([]*domain.Variable{broken}, nil)

		doc := map[string]any{"token": "${{ token }}"}
		require.Error(t, svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, doc))
		// The placeholder stands: an unreadable secret never lands in the document.
		assert.Equal(t, "${{ token }}", doc["token"])
	})

	t.Run("reports a storage failure", func(t *testing.T) {
		svc, statements, _, _ := newMockedVariableService(t)

		sentinel := errors.New("connection refused")
		statements.EXPECT().GetVariables(gomock.Any(), variablesOwner, domain.DeploymentOriginKindPrimary, anyNames).Return(nil, sentinel)

		err := svc.ReplaceVariablesInPlace(t.Context(), variablesOwner, map[string]any{"url": "${{ url }}"})
		require.Error(t, err)
		assert.ErrorIs(t, err, sentinel)
	})
}
