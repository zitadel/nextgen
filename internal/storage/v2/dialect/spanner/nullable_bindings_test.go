package spanner

import (
	"testing"

	"github.com/zitadel/nextgen/internal/storage/v2/dialect/schematest"
)

func TestTokenSchemaNullableBindings(t *testing.T) {
	schematest.TokenNullableBindings(t, tokenSchema)
}

func TestJSONSchemaSchemaNullableBindings(t *testing.T) {
	schematest.JSONSchemaNullableBindings(t, jsonSchemaSchema)
}

func TestCryptoKeySchemasNullableBindings(t *testing.T) {
	schematest.CryptoKeyNullableBindings(t, encryptionKeySchema, signingKeySchema)
}