package test_data

import (
	_ "embed"
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/go-faker/faker/v4"
	"github.com/stretchr/testify/require"
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

// GenerateUser generates a user according to the [createSchemaRequestUserSchema]
func (g *DataGenerator) GenerateUser(t *testing.T) []byte {
	t.Helper()

	u := map[string]any{
		"email": faker.Email(),
	}
	if randBool() {
		u["firstName"] = faker.FirstName()
	}
	if randBool() {
		u["lastName"] = faker.LastName()
	}
	if randBool() {
		addr := faker.GetRealAddress()
		u["address"] = map[string]any{
			"street":      addr.Address,
			"houseNumber": rand.IntN(100) + 1,
			"city":        addr.City,
			"postalCode":  addr.PostalCode,
			"country":     faker.GetCountryInfo().Name,
		}
	}

	bs, err := json.Marshal(u)
	require.NoError(t, err)
	return bs
}

func randBool() bool {
	return rand.IntN(2) == 1
}

type DataGenerator struct{}

// GenerateUser generates a user according to the [default-human-user-schema.json]
func (g *DataGenerator) GenerateUser(t *testing.T) map[string]any {
	t.Helper()

	u := map[string]any{
		"email": faker.Email(),
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
