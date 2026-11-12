package service

import (
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
)

// validateBuiltinSchema checks document against the newest built-in schema of
// kind and returns it decoded.
func validateBuiltinSchema(schemas BuiltinSchemaProvider, kind domain.KnownSchemaKind, document []byte) (map[string]any, error) {
	uri, err := schemas.LatestSchemaURI(kind)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("built-in schema not registered").WithDetails(map[string]string{"schema_kind": string(kind)})
	}
	schema, err := schemas.GetBuiltinSchema(uri)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("built-in schema not compiled").WithDetails(map[string]string{"schema_kind": string(kind)})
	}
	var doc map[string]any
	if err := json.Unmarshal(document, &doc); err != nil {
		return nil, domain.ErrRequestInvalid().WithParent(err)
	}
	if err := schema.Validate(doc); err != nil {
		// The validator's messages quote the rejected value, and a secret
		// pasted where its variable reference belongs is one: the log gets
		// the failures' locations only.
		return nil, domain.ErrRequestInvalid().WithDetails(domain.FlattenValidationErrors(err)).WithParent(domain.SchemaValidationCause(err))
	}
	return doc, nil
}
