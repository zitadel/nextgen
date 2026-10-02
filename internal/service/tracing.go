package service

import (
	"context"
	"errors"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/domain"
)

var (
	tracer = otel.Tracer("github.com/zitadel/nextgen/internal/service")

	// Domain codes that mean the server failed, not the client.
	internalCode    = domain.ErrInternal(nil).Code
	unavailableCode = domain.ErrUnavailable().Code
)

// startSpan starts the span of a service operation, named "<Service>.<Method>".
// Use the returned context for the rest of the method and end the span with
// a pointer to the method's named error result:
//
//	ctx, end := startSpan(ctx, "UserService.CreateUser")
//	defer end(&err)
//
// On error the span gets the domain error code (or the Go type) as error.type,
// never the message: messages carry user values. The status is Error only for
// a real failure: an error that is not a domain error, or an internal or
// unavailable one. A not found, a validation error or a wrong password is an
// outcome of the operation and keeps the status unset. Nothing is started
// when the parent is not sampled.
func startSpan(ctx context.Context, name string) (context.Context, func(*error)) {
	if !trace.SpanContextFromContext(ctx).IsSampled() {
		return ctx, func(*error) {}
	}
	ctx, span := tracer.Start(ctx, name)
	return ctx, func(errp *error) {
		if err := *errp; err != nil {
			de, ok := errors.AsType[domain.Error](err)
			errType := de.Code
			if !ok {
				errType = fmt.Sprintf("%T", err)
			}
			if !ok || de.Code == internalCode || de.Code == unavailableCode {
				span.SetStatus(codes.Error, "")
			}
			span.SetAttributes(semconv.ErrorTypeKey.String(errType))
		}
		span.End()
	}
}
