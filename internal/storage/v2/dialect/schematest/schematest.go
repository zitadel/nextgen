// Package schematest asserts the nullable-binding contract shared by every
// dialect schema: the Nullable flag is set, the absent state binds untyped
// nil, and the present state binds the dereferenced value.
package schematest

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func assertNullableBindings[F ~uint8, T any](t *testing.T, schema database.Schema[F, T], cols []database.Column[F], filled *T, want []any) {
	t.Helper()
	for _, col := range cols {
		assert.True(t, schema.Nullable(col), schema.SQLName(col))
	}
	// A typed nil slips past the compare compiler's nil checks and binds NULL
	// into an ordered compare, so the absent state must bind untyped nil.
	for i, v := range schema.ValuesFrom(new(T), cols) {
		assert.True(t, v == nil, "%s must bind untyped nil", schema.SQLName(cols[i]))
	}
	assert.Equal(t, want, schema.ValuesFrom(filled, cols))
}

func TokenNullableBindings(t *testing.T, schema database.Schema[domain.TokenField, domain.Token]) {
	t.Helper()
	cols := []database.Column[domain.TokenField]{
		database.Col(domain.TokenFieldUserID),
		database.Col(domain.TokenFieldSessionID),
		database.Col(domain.TokenFieldOIDCSessionID),
		database.Col(domain.TokenFieldSAMLSessionID),
		database.Col(domain.TokenFieldExpiresAt),
	}
	expires := time.Unix(1700000000, 0).UTC()
	token := &domain.Token{
		UserID:        "usr_1",
		SessionID:     new("sess_1"),
		OIDCSessionID: new("oidcsess_1"),
		SAMLSessionID: new("samlsess_1"),
		ExpiresAt:     &expires,
	}
	assertNullableBindings(t, schema, cols, token,
		[]any{"usr_1", "sess_1", "oidcsess_1", "samlsess_1", expires})
}

func JSONSchemaNullableBindings(t *testing.T, schema database.Schema[domain.JSONSchemaField, domain.JSONSchema]) {
	t.Helper()
	cols := []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldObjectType)}
	assertNullableBindings(t, schema, cols, &domain.JSONSchema{ObjectType: new("user")}, []any{"user"})
}

func CryptoKeyNullableBindings(
	t *testing.T,
	encryption database.Schema[domain.EncryptionKeyField, domain.EncryptionKey],
	signing database.Schema[domain.SigningKeyField, domain.SigningKey],
) {
	t.Helper()
	activated := time.Unix(1700000000, 0).UTC()
	retired := activated.Add(time.Hour)
	want := []any{activated, retired}

	assertNullableBindings(t, encryption, []database.Column[domain.EncryptionKeyField]{
		database.Col(domain.EncryptionKeyFieldActivatedAt),
		database.Col(domain.EncryptionKeyFieldRetiredAt),
	}, &domain.EncryptionKey{ActivatedAt: &activated, RetiredAt: &retired}, want)

	assertNullableBindings(t, signing, []database.Column[domain.SigningKeyField]{
		database.Col(domain.SigningKeyFieldActivatedAt),
		database.Col(domain.SigningKeyFieldRetiredAt),
	}, &domain.SigningKey{ActivatedAt: &activated, RetiredAt: &retired}, want)
}