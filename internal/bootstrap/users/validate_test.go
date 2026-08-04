package users_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/bootstrap/users"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
)

func testHasher(t *testing.T) *crypto.PasswapHasher {
	t.Helper()
	h, err := (&crypto.HashConfig{
		Hasher: crypto.HasherConfig{
			Algorithm: crypto.HashNameBcrypt,
			Params: map[string]any{
				"cost": 10,
			},
		},
		Verifiers: []crypto.HashName{crypto.HashNameBcrypt},
		Limits: crypto.HashLimitsConfig{
			Bcrypt: crypto.BcryptLimitsConfig{MinCost: 10, MaxCost: 16},
		},
	}).NewHasher()
	require.NoError(t, err)
	return h
}

func validDocument() *users.Document {
	return &users.Document{
		Header: users.Header{
			ProjectID: "proj_demo",
			TeamID:    "team_demo",
			SchemaURL: "https://schemas.test/demo.json",
			ID:        "user_demo",
		},
		Attributes: map[domain.AttributeKey]json.RawMessage{
			"username":             json.RawMessage(`"admin"`),
			"email":                json.RawMessage(`"admin@demo.local"`),
			"zitadel.source":       json.RawMessage(`"cli"`),
			"zitadel.default_user": json.RawMessage(`true`),
		},
		Authenticators: map[domain.AttributeKey]json.RawMessage{
			"password": json.RawMessage(`{"encoded_hash":"$2a$10$n0iK.MdnhoKlMKk.sFZofeQSTKxcGnsssJD9WvPiXHvo.X/.P/t6m","change_required":false}`),
		},
	}
}

func TestValidate_valid(t *testing.T) {
	require.NoError(t, users.Validate(validDocument(), testHasher(t)))
}

func TestValidate_missingUsername(t *testing.T) {
	doc := validDocument()
	delete(doc.Attributes, "username")
	err := users.Validate(doc, testHasher(t))
	require.Error(t, err)
	require.Contains(t, err.Error(), "username")
}

func TestValidate_wrongSource(t *testing.T) {
	doc := validDocument()
	doc.Attributes["zitadel.source"] = json.RawMessage(`"api"`)
	err := users.Validate(doc, testHasher(t))
	require.Error(t, err)
	require.Contains(t, err.Error(), "zitadel.source")
}

func TestValidate_unknownAuthenticator(t *testing.T) {
	doc := validDocument()
	doc.Authenticators["totp"] = json.RawMessage(`{}`)
	err := users.Validate(doc, testHasher(t))
	require.Error(t, err)
	require.Contains(t, err.Error(), "password")
}

func TestValidate_nonScalarAttribute(t *testing.T) {
	doc := validDocument()
	doc.Attributes["tags"] = json.RawMessage(`["a"]`)
	err := users.Validate(doc, testHasher(t))
	require.Error(t, err)
	require.Contains(t, err.Error(), "scalar")
}
