package openapi

//go:generate go run ./cmd/gen_error_schemas
//go:generate go run ./cmd/gen_event_schemas
//go:generate go run ./cmd/gen_openapi_errors
//go:generate go tool ogen --config .ogen.yaml --target generated --clean openapi/openapi-spec.yaml
