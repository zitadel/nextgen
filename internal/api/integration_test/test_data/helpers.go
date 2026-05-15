//go:build integration

package test_data

import _ "embed"

//go:embed create-schema-request-user-schema.json
var CreateSchemaRequestUserSchema []byte

//go:embed create-schema-request-user-schema-by-url.json
var CreateSchemaRequestUserSchemaByUrl []byte
