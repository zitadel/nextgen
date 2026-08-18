package test_data

import (
	_ "embed"
	"math/rand/v2"
	"testing"

	"github.com/go-faker/faker/v4"
)

//go:embed create-schema-request-user-schema.json
var createSchemaRequestUserSchema []byte

//go:embed create-schema-request-user-schema-by-url.json
var createSchemaRequestUserSchemaByUrl []byte

type TestData struct {
	Schemas Schemas

	Generator DataGenerator
}

func BuildTestData() TestData {
	return TestData{
		Schemas: Schemas{
			CreateSchemaRequestUserSchema:      string(createSchemaRequestUserSchema),
			CreateSchemaRequestUserSchemaByUrl: string(createSchemaRequestUserSchemaByUrl),
		},
		Generator: DataGenerator{},
	}
}

type Schemas struct {
	CreateSchemaRequestUserSchema      string
	CreateSchemaRequestUserSchemaByUrl string
}

type DataGenerator struct{}

// UserSchemaURL names the schema the generated attributes satisfy.
const UserSchemaURL = "https://test.example.schemas.com/schemas/default-human-user.json"

// GenerateUser generates the attributes of a user according to the
// [default-human-user-schema.json]. The result is the document the schema
// validates, so it carries no envelope fields.
func (g *DataGenerator) GenerateUser(t *testing.T, email string) map[string]any {
	t.Helper()

	u := map[string]any{
		"email":      email,
		"password":   "my-strong-password",
		"givenName":  faker.FirstName(),
		"familyName": faker.LastName(),
	}
	if randBool() {
		u["dateOfBirth"] = faker.Date()
	}

	return u
}

func randBool() bool {
	return rand.IntN(2) == 1
}
