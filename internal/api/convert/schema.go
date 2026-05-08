package convert

import (
	"github.com/ianlancetaylor/jsonschema"
	api "github.com/zitadel/nextgen/api/generated"
)

func UserSchemaToJsonschema(schema api.UserSchema) *jsonschema.Schema {
	// TODO: implement this
	return nil
}

func JsonschemaToGetApiSchemaByIdResponse(schema *jsonschema.Schema) *api.GetSchemaByIdOK {
	// TODO: implement this
	return nil
}
