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

// GenerateUser generates a user according to the [default-human-user-schema.json]
func (g *DataGenerator) GenerateUser(t *testing.T, email string) map[string]any {
	t.Helper()

	u := map[string]any{
		"$schema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
		"email":   email,
	}
	if randBool() {
		u["name"] = faker.FirstName()
	}
	if randBool() {
		u["phoneNumber"] = faker.Phonenumber()
	}

	return u
}

func randBool() bool {
	return rand.IntN(2) == 1
}
