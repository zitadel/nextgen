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
		CreateSchemaRequestUserSchema:      strings.ReplaceAll(string(createSchemaRequestUserSchema), hostPlaceholder, host),
		CreateSchemaRequestUserSchemaByUrl: strings.ReplaceAll(string(createSchemaRequestUserSchemaByUrl), hostPlaceholder, host),
	}
}
