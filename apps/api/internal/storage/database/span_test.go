package database_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var spanExporter = tracetest.NewInMemoryExporter()

// TestMain sets the global provider once: the package tracer delegates to the
// first provider set in the process.
func TestMain(m *testing.M) {
	otel.SetTracerProvider(sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(spanExporter),
		sdktrace.WithSampler(zotel.NewSampler(1.0)),
	))
	os.Exit(m.Run())
}

// tracedExecutor, tokenStatements and withTransaction mirror the dialect call
// chain that StartStatementSpan reads its span name from.
type tracedExecutor struct{ err error }

func (e tracedExecutor) Exec(ctx context.Context) error {
	_, end := database.StartStatementSpan(ctx, "postgresql")
	end(e.err)
	return e.err
}

func withTransaction(ctx context.Context, client tracedExecutor, fn func(ctx context.Context, tx tracedExecutor) error) error {
	return fn(ctx, client)
}

type tokenStatements struct{ client tracedExecutor }

func (s *tokenStatements) GetTokenByID(ctx context.Context) error {
	return s.client.Exec(ctx)
}

// execHelper stands for a package helper such as execAffected: it has no
// receiver, so the span takes the name of the method that called it.
func execHelper(ctx context.Context, client tracedExecutor) error {
	return client.Exec(ctx)
}

func (s *tokenStatements) ListTokens(ctx context.Context) error {
	return execHelper(ctx, s.client)
}

func (s tokenStatements) UpdateToken(ctx context.Context) error {
	return withTransaction(ctx, s.client, func(ctx context.Context, tx tracedExecutor) error {
		return tx.Exec(ctx)
	})
}

func sampledContext(t *testing.T) context.Context {
	t.Helper()
	ctx, span := otel.Tracer("test").Start(t.Context(), "request", trace.WithSpanKind(trace.SpanKindServer))
	require.True(t, span.SpanContext().IsSampled())
	t.Cleanup(func() { span.End() })
	return ctx
}

func TestStartStatementSpan_nameFromMethod(t *testing.T) {
	spanExporter.Reset()
	s := &tokenStatements{}

	require.NoError(t, s.GetTokenByID(sampledContext(t)))

	spans := spanExporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "tokenStatements.GetTokenByID", spans[0].Name)
	assert.Equal(t, []attribute.KeyValue{attribute.String("db.system.name", "postgresql")}, spans[0].Attributes)
	assert.Equal(t, codes.Unset, spans[0].Status.Code)
}

func TestStartStatementSpan_nameFromClosureInMethod(t *testing.T) {
	spanExporter.Reset()
	s := tokenStatements{}

	require.NoError(t, s.UpdateToken(sampledContext(t)))

	spans := spanExporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "tokenStatements.UpdateToken", spans[0].Name)
}

func TestStartStatementSpan_errorKeepsMessageOut(t *testing.T) {
	spanExporter.Reset()
	// Driver messages carry user values, so none of this may reach the span.
	s := &tokenStatements{client: tracedExecutor{err: errors.New("Key (email)=(x@y) already exists")}}

	require.Error(t, s.GetTokenByID(sampledContext(t)))

	spans := spanExporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, sdktrace.Status{Code: codes.Error}, spans[0].Status)
	assert.Contains(t, spans[0].Attributes, attribute.String("error.type", "*errors.errorString"))
	assert.Empty(t, spans[0].Events)
	for _, attr := range spans[0].Attributes {
		assert.NotContains(t, attr.Value.String(), "x@y")
	}
}

func TestStartStatementSpan_parentNotSampled(t *testing.T) {
	spanExporter.Reset()
	ctx := t.Context()

	got, end := database.StartStatementSpan(ctx, "postgresql")
	end(errors.New("boom"))

	assert.Equal(t, ctx, got, "no span may be started")
	assert.Empty(t, spanExporter.GetSpans())
}

func TestStartStatementSpan_nameFromMethodCallingAHelper(t *testing.T) {
	spanExporter.Reset()
	s := &tokenStatements{}

	require.NoError(t, s.ListTokens(sampledContext(t)))

	spans := spanExporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "tokenStatements.ListTokens", spans[0].Name)
}

func TestStartStatementSpan_notFoundIsNoError(t *testing.T) {
	for _, err := range []error{
		database.NewNoRowFoundError(nil),
		fmt.Errorf("get token: %w", sql.ErrNoRows),
	} {
		t.Run(fmt.Sprintf("%T", err), func(t *testing.T) {
			spanExporter.Reset()
			s := &tokenStatements{client: tracedExecutor{err: err}}

			require.Error(t, s.GetTokenByID(sampledContext(t)))

			spans := spanExporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, codes.Unset, spans[0].Status.Code)
			assert.Equal(t, []attribute.KeyValue{attribute.String("db.system.name", "postgresql")}, spans[0].Attributes)
		})
	}
}
