package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	zmetrics "github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// useMetrics replaces the process-wide default Application for one test, so a
// test that calls it must not run in parallel.
func useMetrics(t *testing.T) sdkmetric.Reader {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	app, err := zmetrics.NewApplication(zmetrics.WithMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))))
	require.NoError(t, err)
	zmetrics.SetDefault(app)
	t.Cleanup(func() { zmetrics.SetDefault(nil) })
	return reader
}

// counts reads one instrument as `attribute values -> count`, with the
// attribute values of a point joined by "/" in the order given.
func counts(t *testing.T, reader sdkmetric.Reader, name string, keys ...string) map[string]uint64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))
	out := map[string]uint64{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name != name {
				continue
			}
			switch data := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, p := range data.DataPoints {
					out[joinAttrs(p.Attributes, keys)] += uint64(p.Value)
				}
			case metricdata.Histogram[float64]:
				for _, p := range data.DataPoints {
					out[joinAttrs(p.Attributes, keys)] += p.Count
				}
			}
		}
	}
	return out
}

func joinAttrs(set attribute.Set, keys []string) string {
	var parts []string
	for _, k := range keys {
		v, _ := set.Value(attribute.Key(k))
		parts = append(parts, v.AsString())
	}
	return strings.Join(parts, "/")
}

// poolOf is a pool whose statements are the given mock, so a key service and a
// token service built separately read the same fake database.
func poolOf(t *testing.T, statements *servicemocks.MockAllStatements) *servicemocks.MockPool {
	t.Helper()
	pool := servicemocks.NewMockPool(gomock.NewController(t))
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return pool
}

// tokenFixture builds a key service holding a master-wrapped KEK and a
// KEK-wrapped token key, and a bearer credential encrypted under that token
// key: the real two-level chain a request resolves on a cold cache.
type tokenFixture struct {
	svc        service.TokenService
	statements *servicemocks.MockAllStatements
	bearer     string
	tokenKey   *domain.EncryptionKey
	kek        *domain.EncryptionKey
}

func newTokenFixture(t *testing.T, token *domain.Token) *tokenFixture {
	t.Helper()
	keys, statements, masterKey := newMockedKeyService(t)

	kek := newActiveKEK(t, "proj-1", masterKey)
	kekCrypter, err := kek.Crypter(masterKey)
	require.NoError(t, err)
	tokenKey := newTokenEncryptionKey(t, "enc_token", "proj-1", kekCrypter)
	tokenCrypter, err := tokenKey.Crypter(kekCrypter)
	require.NoError(t, err)

	bearer, err := token.JWE(tokenCrypter)
	require.NoError(t, err)

	return &tokenFixture{
		svc:        service.NewTokenService(keys, service.NewPool(poolOf(t, statements))),
		statements: statements,
		bearer:     bearer,
		tokenKey:   tokenKey,
		kek:        kek,
	}
}

// expectChain answers the key reads of one cold resolution: the token key,
// then the KEK that wraps it.
func (f *tokenFixture) expectChain() {
	gomock.InOrder(
		f.statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(f.tokenKey, nil),
		f.statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(f.kek, nil),
	)
}

func TestIntrospectToken_Metrics(t *testing.T) {
	tests := []struct {
		name           string
		record         func(f *tokenFixture)
		wantErr        bool
		wantValidation string
		wantRevocation map[string]uint64
	}{
		{
			name: "an active token",
			record: func(f *tokenFixture) {
				f.statements.EXPECT().GetTokenByID(gomock.Any(), "proj-1", "tkn_1").Return(&domain.Token{}, nil)
			},
			wantValidation: "valid",
			wantRevocation: map[string]uint64{"active": 1},
		},
		{
			name: "a token whose record is gone",
			record: func(f *tokenFixture) {
				f.statements.EXPECT().GetTokenByID(gomock.Any(), "proj-1", "tkn_1").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr:        true,
			wantValidation: "revoked",
			wantRevocation: map[string]uint64{"revoked": 1},
		},
		{
			name: "a token whose record has expired",
			record: func(f *tokenFixture) {
				past := time.Now().Add(-time.Hour)
				f.statements.EXPECT().GetTokenByID(gomock.Any(), "proj-1", "tkn_1").Return(&domain.Token{ExpiresAt: &past}, nil)
			},
			wantErr:        true,
			wantValidation: "revoked",
			wantRevocation: map[string]uint64{"revoked": 1},
		},
		{
			name: "a record that cannot be read is the server's failure, not the bearer's",
			record: func(f *tokenFixture) {
				f.statements.EXPECT().GetTokenByID(gomock.Any(), "proj-1", "tkn_1").Return(nil, errors.New("connection refused"))
			},
			wantErr:        true,
			wantValidation: "error",
			wantRevocation: map[string]uint64{"error": 1},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader := useMetrics(t)
			f := newTokenFixture(t, &domain.Token{ProjectID: "proj-1", TokenID: "tkn_1", Type: domain.TokenTypeProjectToken})
			f.expectChain()
			tt.record(f)

			_, err := f.svc.IntrospectToken(t.Context(), f.bearer)
			assert.Equal(t, tt.wantErr, err != nil)

			assert.Equal(t, map[string]uint64{tt.wantValidation: 1}, counts(t, reader, zmetrics.CredentialValidationDuration, "result"))
			assert.Equal(t, tt.wantRevocation, counts(t, reader, zmetrics.TokenRevocationChecks, "result"))
			// The cold chain resolved the KEK under the master key, then the token key under the KEK.
			assert.Equal(t, map[string]uint64{"master": 1, "project": 1}, counts(t, reader, zmetrics.KeyChainResolutionDuration, "kek"))
		})
	}
}

func TestIntrospectToken_Metrics_unrevocableAndInvalid(t *testing.T) {
	t.Run("a credential that cannot be revoked is not checked, and so not counted", func(t *testing.T) {
		reader := useMetrics(t)
		// A typeless token has no record to look up.
		f := newTokenFixture(t, &domain.Token{ProjectID: "proj-1", Type: domain.TokenTypeUnspecified})
		f.expectChain()

		_, err := f.svc.IntrospectToken(t.Context(), f.bearer)
		require.NoError(t, err)

		assert.Equal(t, map[string]uint64{"valid": 1}, counts(t, reader, zmetrics.CredentialValidationDuration, "result"))
		assert.Empty(t, counts(t, reader, zmetrics.TokenRevocationChecks, "result"))
	})

	t.Run("a credential that is not one", func(t *testing.T) {
		reader := useMetrics(t)
		f := newTokenFixture(t, &domain.Token{ProjectID: "proj-1", TokenID: "tkn_1", Type: domain.TokenTypeProjectToken})

		_, err := f.svc.IntrospectToken(t.Context(), "not-a-jwe")
		require.Error(t, err)

		assert.Equal(t, map[string]uint64{"invalid": 1}, counts(t, reader, zmetrics.CredentialValidationDuration, "result"))
		assert.Empty(t, counts(t, reader, zmetrics.TokenRevocationChecks, "result"))
	})
}

// A resolution that the cache answers is not a resolution: the second request
// reads nothing and records nothing.
func TestIntrospectToken_Metrics_cachedKeysAreNotResolutions(t *testing.T) {
	reader := useMetrics(t)
	f := newTokenFixture(t, &domain.Token{ProjectID: "proj-1", TokenID: "tkn_1", Type: domain.TokenTypeProjectToken})
	f.expectChain()
	f.statements.EXPECT().GetTokenByID(gomock.Any(), "proj-1", "tkn_1").Return(&domain.Token{}, nil).Times(2)

	for range 2 {
		_, err := f.svc.IntrospectToken(t.Context(), f.bearer)
		require.NoError(t, err)
	}

	assert.Equal(t, map[string]uint64{"valid": 2}, counts(t, reader, zmetrics.CredentialValidationDuration, "result"))
	assert.Equal(t, map[string]uint64{"active": 2}, counts(t, reader, zmetrics.TokenRevocationChecks, "result"))
	assert.Equal(t, map[string]uint64{"master": 1, "project": 1}, counts(t, reader, zmetrics.KeyChainResolutionDuration, "kek"))
}

type stubFlowService struct {
	service.FlowService
	result domain.FlowStepResult
	err    error
}

func (s stubFlowService) Start(context.Context, service.StartFlowRequest) (domain.FlowStepResult, error) {
	return s.result, s.err
}

func (s stubFlowService) Submit(context.Context, service.SubmitFlowRequest) (domain.FlowStepResult, error) {
	return s.result, s.err
}

func (s stubFlowService) GetStep(context.Context, service.GetFlowStepRequest) (domain.FlowStepResult, error) {
	return s.result, s.err
}

func TestMeteredFlowService(t *testing.T) {
	complete := domain.FlowStepCompleteShow
	tests := []struct {
		name   string
		result domain.FlowStepResult
		err    error
		want   string
	}{
		{name: "a step to act on", result: domain.FlowStepResult{Step: &domain.FlowStep{Name: "per-project-step-name"}}, want: "step"},
		{name: "a terminal step", result: domain.FlowStepResult{Step: &domain.FlowStep{Complete: &complete}}, want: "complete"},
		{name: "a handoff", result: domain.FlowStepResult{HandoffToken: "handoff"}, want: "complete"},
		{name: "an error", err: errors.New("boom"), want: "error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader := useMetrics(t)
			svc := service.NewMeteredFlowService(stubFlowService{result: tt.result, err: tt.err})

			gotStart, errStart := svc.Start(t.Context(), service.StartFlowRequest{})
			gotSubmit, errSubmit := svc.Submit(t.Context(), service.SubmitFlowRequest{})
			gotStep, errStep := svc.GetStep(t.Context(), service.GetFlowStepRequest{})

			// The wrapper is transparent.
			for _, got := range []domain.FlowStepResult{gotStart, gotSubmit, gotStep} {
				assert.Equal(t, tt.result, got)
			}
			for _, err := range []error{errStart, errSubmit, errStep} {
				assert.Equal(t, tt.err, err)
			}

			assert.Equal(t, map[string]uint64{
				"start/" + tt.want:  1,
				"submit/" + tt.want: 1,
				"render/" + tt.want: 1,
			}, counts(t, reader, zmetrics.FlowStepTransitions, "operation", "result"))
		})
	}
}

// A verified proof is counted once, by kind and outcome, however it ended.
func TestAuthAttemptService_VerifyProof_Metrics(t *testing.T) {
	newAttempt := func() *domain.AuthAttempt {
		return &domain.AuthAttempt{
			ProjectID: "proj",
			ID:        "att-1",
			Checks: []domain.AuthCheck{
				&domain.AuthFactorUser{UserID: "user-1"},
				domain.SetAuthChallengePassword("ch-pass", time.Now(), time.Time{}, 0),
			},
		}
	}
	input := func(challengeID string) service.VerifyProofInput {
		return service.VerifyProofInput{ProjectID: "proj", AttemptID: "att-1", ChallengeID: challengeID, Proof: service.PasswordProof{Password: "secret"}}
	}

	tests := []struct {
		name        string
		challengeID string
		arrange     func(stmts *servicemocks.MockAllStatements)
		want        string
	}{
		{
			name:        "a proof that checks out",
			challengeID: "ch-pass",
			arrange: func(stmts *servicemocks.MockAllStatements) {
				stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(&domain.UserPassword{EncodedHash: "encoded"}, nil)
				stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
			},
			want: "password/success",
		},
		{
			name:        "a proof that is refused",
			challengeID: "ch-pass",
			arrange: func(stmts *servicemocks.MockAllStatements) {
				stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(nil, errors.New("password missing"))
				stmts.EXPECT().AuthAttemptChallengeFailed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
			},
			want: "password/rejected",
		},
		{
			name:        "a proof for a challenge that does not exist is neither",
			challengeID: "ch-other",
			arrange:     func(*servicemocks.MockAllStatements) {},
			want:        "password/error",
		},
		{
			name:        "a verified proof that could not be persisted",
			challengeID: "ch-pass",
			arrange: func(stmts *servicemocks.MockAllStatements) {
				stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(&domain.UserPassword{EncodedHash: "encoded"}, nil)
				stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(errors.New("write failed"))
			},
			want: "password/error",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader := useMetrics(t)
			ctrl := gomock.NewController(t)
			verifier := cryptomock.NewMockHashVerifier(ctrl)
			verifier.EXPECT().VerifyHash(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
			stmts := servicemocks.NewMockAllStatements(ctrl)
			stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).Return(newAttempt(), nil)
			tt.arrange(stmts)

			svc := newAuthAttemptSvcWithVerifier(ctrl, stmts, nil, nil, verifier)
			_, _ = svc.VerifyProof(t.Context(), input(tt.challengeID))

			assert.Equal(t, map[string]uint64{tt.want: 1}, counts(t, reader, zmetrics.AuthAttemptOutcomes, "check", "result"))
		})
	}
}
