package postgres

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// The absent state must bind untyped nil: a typed nil slips past the compare
// compiler's nil checks and binds NULL into an ordered compare.

func TestTokenSchemaNullableBindings(t *testing.T) {
	cols := []database.Column[domain.TokenField]{
		database.Col(domain.TokenFieldUserID),
		database.Col(domain.TokenFieldSessionID),
		database.Col(domain.TokenFieldOIDCSessionID),
		database.Col(domain.TokenFieldSAMLSessionID),
		database.Col(domain.TokenFieldExpiresAt),
	}
	for _, col := range cols {
		assert.True(t, tokenSchema.Nullable(col), tokenSchema.SQLName(col))
	}
	for i, v := range tokenSchema.ValuesFrom(&domain.Token{}, cols) {
		assert.True(t, v == nil, "%s must bind untyped nil", tokenSchema.SQLName(cols[i]))
	}

	expires := time.Unix(1700000000, 0).UTC()
	token := &domain.Token{
		UserID:        "usr_1",
		SessionID:     new("sess_1"),
		OIDCSessionID: new("oidcsess_1"),
		SAMLSessionID: new("samlsess_1"),
		ExpiresAt:     &expires,
	}
	assert.Equal(t,
		[]any{"usr_1", "sess_1", "oidcsess_1", "samlsess_1", expires},
		tokenSchema.ValuesFrom(token, cols),
	)
}

func TestJSONSchemaSchemaNullableBindings(t *testing.T) {
	col := database.Col(domain.JSONSchemaFieldObjectType)
	cols := []database.Column[domain.JSONSchemaField]{col}

	assert.True(t, jsonSchemaSchema.Nullable(col))
	v := jsonSchemaSchema.ValuesFrom(&domain.JSONSchema{}, cols)[0]
	assert.True(t, v == nil, "object_type must bind untyped nil")

	schema := &domain.JSONSchema{ObjectType: new("user")}
	assert.Equal(t, []any{"user"}, jsonSchemaSchema.ValuesFrom(schema, cols))
}

func TestCryptoKeySchemasNullableBindings(t *testing.T) {
	activated := time.Unix(1700000000, 0).UTC()
	retired := activated.Add(time.Hour)

	encCols := []database.Column[domain.EncryptionKeyField]{
		database.Col(domain.EncryptionKeyFieldActivatedAt),
		database.Col(domain.EncryptionKeyFieldRetiredAt),
	}
	for _, col := range encCols {
		assert.True(t, encryptionKeySchema.Nullable(col), encryptionKeySchema.SQLName(col))
	}
	for i, v := range encryptionKeySchema.ValuesFrom(&domain.EncryptionKey{}, encCols) {
		assert.True(t, v == nil, "%s must bind untyped nil", encryptionKeySchema.SQLName(encCols[i]))
	}
	encKey := &domain.EncryptionKey{ActivatedAt: &activated, RetiredAt: &retired}
	assert.Equal(t, []any{activated, retired}, encryptionKeySchema.ValuesFrom(encKey, encCols))

	signCols := []database.Column[domain.SigningKeyField]{
		database.Col(domain.SigningKeyFieldActivatedAt),
		database.Col(domain.SigningKeyFieldRetiredAt),
	}
	for _, col := range signCols {
		assert.True(t, signingKeySchema.Nullable(col), signingKeySchema.SQLName(col))
	}
	for i, v := range signingKeySchema.ValuesFrom(&domain.SigningKey{}, signCols) {
		assert.True(t, v == nil, "%s must bind untyped nil", signingKeySchema.SQLName(signCols[i]))
	}
	signKey := &domain.SigningKey{ActivatedAt: &activated, RetiredAt: &retired}
	assert.Equal(t, []any{activated, retired}, signingKeySchema.ValuesFrom(signKey, signCols))
}
