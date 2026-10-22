package zotel

import (
	"github.com/zitadel/nextgen/internal/build"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
)

func CreateResource(serviceName string) (*resource.Resource, error) {
	attributes := []attribute.KeyValue{
		semconv.ServiceNameKey.String(serviceName),
	}
	if build.Version() != "" {
		attributes = append(attributes, semconv.ServiceVersionKey.String(build.Version()))
	}
	return resource.Merge(
		resource.Default(),
		resource.NewWithAttributes("", attributes...),
	)
}
