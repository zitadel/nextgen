//go:build integration

package test_data

import (
	_ "embed"
	"encoding/json"
	"testing"
	"time"

	"github.com/go-faker/faker/v4"
	"github.com/stretchr/testify/require"
	"golang.org/x/exp/rand"
)

const hostPlaceholder = "{{host}}"

//go:embed create-schema-request-user-schema.json
var createSchemaRequestUserSchema []byte

//go:embed create-schema-request-user-schema-by-url.json
var createSchemaRequestUserSchemaByUrl []byte

//go:embed create-user-request.json
var createUserRequest []byte

type TestData struct {
	Schemas Schemas
	Users   Users

	Generator DataGenerator
}

func BuildTestData() TestData {
	return TestData{
		Schemas: Schemas{
			CreateSchemaRequestUserSchema: string(createSchemaRequestUserSchema),
			CreateSchemaRequestUserSchemaByUrl: string(createSchemaRequestUserSchemaByUrl),
		},
		Users: Users{
			CreateUserRequest: string(createUserRequest),
		},
		Generator: DataGenerator{},
	}
}

type Schemas struct {
	CreateSchemaRequestUserSchema      string
	CreateSchemaRequestUserSchemaByUrl string
}

type Users struct {
	CreateUserRequest string
}

type DataGenerator struct {
	CreateUserRequest string
}

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
			"houseNumber": rand.Intn(100) + 1,
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
	rand.Seed(uint64(time.Now().UnixNano()))
	return rand.Intn(2) == 1
}
