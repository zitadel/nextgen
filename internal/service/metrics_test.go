package service_test

import (
	"crypto/rand"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/op"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/crypto"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// The reader is cumulative and shared by the whole binary, so every test here
// asserts the change it caused and none of them runs in parallel.

// counterDelta returns a func reporting how much the counter grew since now.
func counterDelta(t *testing.T, name string, attrs ...attribute.KeyValue) func() int64 {
	t.Helper()
	before := service.MetricsReader.CounterSum(t, name, attrs...)
	return func() int64 { return service.MetricsReader.CounterSum(t, name, attrs...) - before }
}

// histogramDelta returns a func reporting how many measurements the histogram
// gained since now.
func histogramDelta(t *testing.T, name string, attrs ...attribute.KeyValue) func() uint64 {
	t.Helper()
	before := service.MetricsReader.HistogramCount(t, name, attrs...)
	return func() uint64 { return service.MetricsReader.HistogramCount(t, name, attrs...) - before }
}

func result(v string) attribute.KeyValue { return metrics.ResultKey.String(v) }

func TestTokenService_IntrospectToken_metrics(t *testing.T) {
	var raw [32]byte
	_, err := rand.Read(raw[:])
	require.NoError(t, err)
	crypter := op.NewAES256GCMCrypto(raw, "enc_key_token")
	jwe, err := (&domain.Token{ProjectID: "proj_1", TokenID: "tkn_1", Type: domain.TokenTypeSessionToken}).JWE(crypter)
	require.NoError(t, err)
	expired := time.Now().Add(-time.Minute)

	for _, tc := range []struct {
		name           string
		token          string
		record         *domain.Token
		storeErr       error
		wantCredential metrics.CredentialResult
		wantRevocation metrics.RevocationResult // empty: no record was checked
	}{
		{"active record", jwe, &domain.Token{}, nil, metrics.CredentialValid, metrics.RevocationActive},
		{"record gone", jwe, nil, database.NewNoRowFoundError(nil), metrics.CredentialRevoked, metrics.RevocationRevoked},
		{"record expired", jwe, &domain.Token{ExpiresAt: &expired}, nil, metrics.CredentialRevoked, metrics.RevocationRevoked},
		{"store unavailable", jwe, nil, database.NewUnavailableError(errors.New("down")), metrics.CredentialError, metrics.RevocationError},
		{"malformed", "not-a-token", nil, nil, metrics.CredentialInvalid, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, statements, keys := newMockedTokenService(t)
			if tc.token == jwe {
				keys.EXPECT().GetCrypter(gomock.Any(), "enc_key_token", jose.A256GCM).Return(crypter, nil)
				statements.EXPECT().GetTokenByID(gomock.Any(), "proj_1", "tkn_1").Return(tc.record, tc.storeErr)
			}
			credential := histogramDelta(t, metrics.CredentialValidationDuration, result(string(tc.wantCredential)))
			revocations := map[metrics.RevocationResult]func() int64{}
			for _, r := range []metrics.RevocationResult{metrics.RevocationActive, metrics.RevocationRevoked, metrics.RevocationError} {
				revocations[r] = counterDelta(t, metrics.TokenRevocationChecks, result(string(r)))
			}

			_, err := svc.IntrospectToken(t.Context(), tc.token)
			if tc.wantCredential == metrics.CredentialValid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}

			assert.Equal(t, uint64(1), credential(), "credential validation %s", tc.wantCredential)
			for r, delta := range revocations {
				var want int64
				if r == tc.wantRevocation {
					want = 1
				}
				assert.Equal(t, want, delta(), "revocation checks %s", r)
			}
		})
	}
}

// A cold resolution of a token key wrapped by a project KEK unwraps twice:
// the KEK under the master key, then the token key under the KEK. A warm one
// unwraps nothing.
func TestKeyService_GetCrypter_metrics(t *testing.T) {
	svc, statements, masterKey := newMockedKeyService(t)
	kek := newActiveKEK(t, "proj-1", masterKey)
	kekCrypter, err := kek.Crypter(masterKey)
	require.NoError(t, err)
	tokenKey := newTokenEncryptionKey(t, "tek_child_1", "proj-1", kekCrypter)
	gomock.InOrder(
		statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(tokenKey, nil),
		statements.EXPECT().GetEncryptionKey(gomock.Any(), gomock.Any()).Return(kek, nil),
	)

	for _, call := range []struct {
		name          string
		wantPerKind   uint64
		unwrapsNeeded string
	}{
		{"cold", 1, "the KEK under the master key, the token key under the KEK"},
		{"warm", 0, "nothing: the crypter is cached"},
	} {
		master := histogramDelta(t, metrics.KeyChainResolutionDuration, metrics.KeyKindKey.String(string(metrics.KeyKindMaster)))
		project := histogramDelta(t, metrics.KeyChainResolutionDuration, metrics.KeyKindKey.String(string(metrics.KeyKindProject)))

		_, err := svc.GetCrypter(t.Context(), tokenKey.ID, jose.A256GCM)
		require.NoError(t, err)

		assert.Equal(t, call.wantPerKind, master(), "%s: master unwraps; %s", call.name, call.unwrapsNeeded)
		assert.Equal(t, call.wantPerKind, project(), "%s: project unwraps; %s", call.name, call.unwrapsNeeded)
	}
}

func TestAuthAttemptService_VerifyProof_password_metrics(t *testing.T) {
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
	check := metrics.CheckKey.String(string(metrics.CheckPassword))

	for _, tc := range []struct {
		name         string
		passwordErr  error // from GetUserPassword
		verifyErr    error // from the hash verifier
		wantOutcome  metrics.AuthResult
		wantPassword metrics.PasswordResult // empty: no hash was verified
	}{
		{"match", nil, nil, metrics.AuthSuccess, metrics.PasswordMatch},
		{"mismatch", nil, fmt.Errorf("%w: x", crypto.ErrHashMismatch), metrics.AuthRejected, metrics.PasswordMismatch},
		{"hash unreadable", nil, crypto.ErrInvalidHash, metrics.AuthRejected, metrics.PasswordError},
		{"no password set", database.NewNoRowFoundError(nil), nil, metrics.AuthRejected, ""},
		// The storage failure is wrapped as a rejected proof; the metric
		// reads the cause and still counts it as an error.
		{"password store unavailable", database.NewUnavailableError(errors.New("down")), nil, metrics.AuthError, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			projectHasher := cryptomock.NewMockPasswordHasher(ctrl)
			hashers := mocks.NewMockProjectHasherResolver(ctrl)
			stmts := mocks.NewMockAllStatements(ctrl)
			stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).Return(newAttempt(), nil)
			if tc.passwordErr != nil {
				stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(nil, tc.passwordErr)
			} else {
				stmts.EXPECT().GetUserPassword(gomock.Any(), gomock.Any()).Return(&domain.UserPassword{EncodedHash: "encoded"}, nil)
				hashers.EXPECT().HasherForProject(gomock.Any(), gomock.Any()).Return(projectHasher, nil)
				projectHasher.EXPECT().VerifyAndRehash("encoded", "pw").Return("", tc.verifyErr)
			}
			if tc.wantOutcome == metrics.AuthSuccess {
				stmts.EXPECT().AuthAttemptChallengeSucceeded(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
			} else {
				stmts.EXPECT().AuthAttemptChallengeFailed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
			}
			outcomes := map[metrics.AuthResult]func() int64{}
			for _, r := range []metrics.AuthResult{metrics.AuthSuccess, metrics.AuthRejected, metrics.AuthError} {
				outcomes[r] = counterDelta(t, metrics.AuthAttemptOutcomes, check, result(string(r)))
			}
			passwords := map[metrics.PasswordResult]func() uint64{}
			for _, r := range []metrics.PasswordResult{metrics.PasswordMatch, metrics.PasswordMismatch, metrics.PasswordError} {
				passwords[r] = histogramDelta(t, metrics.PasswordVerificationDuration, result(string(r)))
			}

			svc := newAuthAttemptSvcWithHashers(ctrl, stmts, nil, nil, hashers, nil)
			_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
				ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-pass",
				Proof: service.PasswordProof{Password: "pw"},
			})
			if tc.wantOutcome == metrics.AuthSuccess {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}

			for r, delta := range outcomes {
				var want int64
				if r == tc.wantOutcome {
					want = 1
				}
				assert.Equal(t, want, delta(), "outcome %s", r)
			}
			for r, delta := range passwords {
				var want uint64
				if r == tc.wantPassword {
					want = 1
				}
				assert.Equal(t, want, delta(), "password verification %s", r)
			}
		})
	}
}

func TestAuthAttemptService_VerifyProof_user_metrics(t *testing.T) {
	check := metrics.CheckKey.String(string(metrics.CheckUser))
	for _, tc := range []struct {
		name      string
		lookupErr error
		want      metrics.AuthResult
	}{
		{"not found", database.NewNoRowFoundError(nil), metrics.AuthRejected},
		{"lookup failed", errors.New("connection reset"), metrics.AuthError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			users := mocks.NewMockUserLookup(ctrl)
			stmts := mocks.NewMockAllStatements(ctrl)
			stmts.EXPECT().GetAuthAttemptByID(gomock.Any(), gomock.Any(), gomock.Any()).Return(&domain.AuthAttempt{
				ProjectID: "proj",
				ID:        "att-1",
				Checks:    []domain.AuthCheck{domain.SetAuthChallengeUser("ch-1", time.Now(), time.Time{}, 0)},
			}, nil)
			stmts.EXPECT().GetJSONSchemaByID(gomock.Any(), "proj", "sch_v2").Return(&domain.JSONSchema{URL: "sch_v2", ObjectType: new("human-user")}, nil)
			stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).Return(&database.ListResult[*domain.JSONSchema]{
				Items: []*domain.JSONSchema{{URL: "sch_v2"}},
			}, nil)
			users.EXPECT().GetByAttributes(gomock.Any(), "proj", gomock.Any(), gomock.Any()).Return(nil, tc.lookupErr)
			stmts.EXPECT().AuthAttemptChallengeFailed(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
			rejected := counterDelta(t, metrics.AuthAttemptOutcomes, check, result(string(metrics.AuthRejected)))
			failed := counterDelta(t, metrics.AuthAttemptOutcomes, check, result(string(metrics.AuthError)))

			svc := newAuthAttemptSvc(ctrl, stmts, nil, users)
			_, err := svc.VerifyProof(t.Context(), service.VerifyProofInput{
				ProjectID: "proj", AttemptID: "att-1", ChallengeID: "ch-1",
				Proof: service.UserProof{AttributeName: "email", LoginName: "u@example.com", UserSchemaURL: "sch_v2"},
			})
			require.Error(t, err)

			var wantRejected, wantFailed int64
			if tc.want == metrics.AuthRejected {
				wantRejected = 1
			} else {
				wantFailed = 1
			}
			assert.Equal(t, wantRejected, rejected(), "rejected")
			assert.Equal(t, wantFailed, failed(), "error")
		})
	}
}

func TestFlowService_metrics(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &domain.FlowState{ProjectID: def.ProjectID, AuthAttemptID: "att-1", FlowProgress: domain.FlowProgress{DefinitionID: def.ID}}
	op := func(v metrics.FlowOperation) attribute.KeyValue { return metrics.OperationKey.String(string(v)) }
	completeStep := &domain.FlowStep{Name: "done", Complete: new(domain.FlowStepCompleteRedirect)}

	for _, tc := range []struct {
		name    string
		call    func(t *testing.T) error
		wantOp  metrics.FlowOperation
		wantRes metrics.FlowResult
	}{
		{"start at a step", func(t *testing.T) error {
			sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: &domain.FlowState{ProjectID: def.ProjectID}, Step: &domain.FlowStep{Name: "start"}}}
			_, err := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}).Start(t.Context(), service.StartFlowRequest{Definition: def, Purpose: domain.FlowDefinitionPurposeLogin})
			return err
		}, metrics.FlowStart, metrics.FlowStep},
		{"start completes", func(t *testing.T) error {
			sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: &domain.FlowState{ProjectID: def.ProjectID}, Step: completeStep}}
			_, err := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}).Start(t.Context(), service.StartFlowRequest{Definition: def, Purpose: domain.FlowDefinitionPurposeLogin})
			return err
		}, metrics.FlowStart, metrics.FlowComplete},
		{"start fails", func(t *testing.T) error {
			_, err := service.NewFlowService(stubDB(t), &fakeStateMachine{}, domain.BuiltinSchemaBases{}).Start(t.Context(), service.StartFlowRequest{})
			return err
		}, metrics.FlowStart, metrics.FlowFailed},
		{"submit completes", func(t *testing.T) error {
			sm := &fakeStateMachine{processResult: domain.FlowStepResult{State: state, Step: completeStep}}
			_, err := service.NewFlowService(stubSubmitDB(t, def, &domain.AuthAttempt{ProjectID: def.ProjectID, ID: "att-1"}), sm, domain.BuiltinSchemaBases{}).Submit(t.Context(), service.SubmitFlowRequest{State: state})
			return err
		}, metrics.FlowSubmit, metrics.FlowComplete},
		{"submit fails", func(t *testing.T) error {
			sm := &fakeStateMachine{processErr: domain.ErrFlowIntegrity()}
			_, err := service.NewFlowService(stubSubmitDB(t, def, &domain.AuthAttempt{ProjectID: def.ProjectID, ID: "att-1"}), sm, domain.BuiltinSchemaBases{}).Submit(t.Context(), service.SubmitFlowRequest{State: state})
			return err
		}, metrics.FlowSubmit, metrics.FlowFailed},
		{"render a step", func(t *testing.T) error {
			sm := &fakeStateMachine{renderResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "password"}}}
			_, err := service.NewFlowService(stubGetFlowDefinition(t, def), sm, domain.BuiltinSchemaBases{}).GetStep(t.Context(), service.GetFlowStepRequest{State: state})
			return err
		}, metrics.FlowRender, metrics.FlowStep},
	} {
		t.Run(tc.name, func(t *testing.T) {
			deltas := map[metrics.FlowResult]func() int64{}
			for _, r := range []metrics.FlowResult{metrics.FlowStep, metrics.FlowComplete, metrics.FlowFailed} {
				deltas[r] = counterDelta(t, metrics.FlowStepTransitions, op(tc.wantOp), result(string(r)))
			}

			err := tc.call(t)
			if tc.wantRes == metrics.FlowFailed {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}

			for r, delta := range deltas {
				var want int64
				if r == tc.wantRes {
					want = 1
				}
				assert.Equal(t, want, delta(), "%s %s", tc.wantOp, r)
			}
		})
	}
}
