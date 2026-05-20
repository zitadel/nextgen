//go:build integration

package test_data

import (
	_ "embed"
	"strings"
)

const hostPlaceholder = "{{host}}"

//go:embed create-schema-request-user-schema.json
var createSchemaRequestUserSchema []byte

//go:embed create-schema-request-user-schema-by-url.json
var createSchemaRequestUserSchemaByUrl []byte

type Schemas struct {
	CreateSchemaRequestUserSchema      string
	CreateSchemaRequestUserSchemaByUrl string
}

func BuildSchemas(host string) Schemas {
	return Schemas{
		CreateSchemaRequestUserSchema:      strings.Replace(string(createSchemaRequestUserSchema), hostPlaceholder, host, -1),
		CreateSchemaRequestUserSchemaByUrl: strings.Replace(string(createSchemaRequestUserSchemaByUrl), hostPlaceholder, host, -1),
	}
}
