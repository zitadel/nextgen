package openapi

//go:generate corepack pnpm exec tsx ../../../scripts/generate-meta-schemas.ts
//go:generate go run ./cmd/gen_error_schemas
//go:generate go run ./cmd/gen_event_schemas
//go:generate go run ./cmd/gen_openapi_errors
//go:generate go tool ogen --config .ogen.yaml --target ../internal/api/generated --clean openapi/openapi-spec.yaml
//go:generate go tool ogen --config .ogen-client.yaml --target ../../../packages/go/api --package api --clean openapi/openapi-spec.yaml
