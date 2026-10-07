package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
)

// sampledRequest resets the exporter and returns the context of a sampled
// request span, ended when the test ends.
func sampledRequest(t *testing.T) context.Context {
	t.Helper()
	service.SpanExporter.Reset()
	ctx, root := otel.Tracer("test").Start(t.Context(), "request", trace.WithSpanKind(trace.SpanKindServer))
	require.True(t, root.SpanContext().IsSampled())
	t.Cleanup(func() { root.End() })
	return ctx
}

func spanNamed(t *testing.T, name string) tracetest.SpanStub {
	t.Helper()
	for _, s := range service.SpanExporter.GetSpans() {
		if s.Name == name {
			return s
		}
	}
	require.Failf(t, "span not found", "no span named %q", name)
	return tracetest.SpanStub{}
}

func TestSetPasswordAction_Prepare_span(t *testing.T) {
	ctrl := gomock.NewController(t)
	hasher := cryptomock.NewMockHasher(ctrl)
	hasher.EXPECT().Hash("s3cret").Return("hash", nil)

	action := service.NewSetUserPasswordAction(service.SetPasswordInput{
		ProjectID: "proj_1",
		UserID:    "user_1",
		Password:  "s3cret",
	}, service.FixedProjectHasherResolver{Hasher: hasher})
	require.NoError(t, action.Prepare(sampledRequest(t)))

	span := spanNamed(t, "password.Hash")
	assert.Equal(t, sdktrace.Status{}, span.Status)
	assert.Empty(t, span.Attributes)
}

// A wrong password is the client's mistake, not a failure of the server: the
// span says which error it was and keeps its status unset.
func TestAuthAttemptService_VerifyProof_Password_wrongPasswordSpan(t *testing.T) {
	ctrl := gomock.NewController(t)
	verifier := cryptomock.NewMockHashVerifier(ctrl)
	stmts := mocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.AuthAttempt{
		ProjectID: "proj",
		ID:        "att-1",
		Checks: []domain.AuthCheck{
			&domain.AuthFactorUser{UserID: "user-1"},
			domain.SetAuthChallengePassword("ch-pass", time.Now(), time.Time{}, 0),
		},
	}, nil)
	stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(&domain.UserPassword{EncodedHash: "encoded"}, nil)
	verifier.EXPECT().VerifyHash("encoded", "wrong").Return(errors.New("mismatch"))
	stmts.EXPECT().AuthAttemptChallengeFailed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)

	svc := newAuthAttemptSvcWithVerifier(ctrl, stmts, nil, nil, verifier)
	_, err := svc.VerifyProof(sampledRequest(t), service.VerifyProofInput{
		ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-pass",
		Proof: service.PasswordProof{Password: "wrong"},
	})
	require.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))

	span := spanNamed(t, "password.Verify")
	assert.Equal(t, sdktrace.Status{}, span.Status)
	assert.Equal(t, []attribute.KeyValue{attribute.String("error.type", domain.ErrUserPasswordInvalid().Code)}, span.Attributes)
}
