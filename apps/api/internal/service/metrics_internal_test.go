package service

import (
	"errors"
	"fmt"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics/metricstest"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// MetricsReader installs the collecting meter provider once, when the binary
// starts: a package variable rather than a TestMain, for the reason SpanExporter gives.
var MetricsReader = metricstest.Install()

func TestCredentialResult(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name string
		err  error
		want metrics.CredentialResult
	}{
		{"nil", nil, metrics.CredentialValid},
		{"revoked", domain.ErrTokenRevoked(), metrics.CredentialRevoked},
		{"malformed", domain.ErrInvalidToken().WithDetails("failed to decrypt"), metrics.CredentialInvalid},
		{"unknown key", domain.ErrEncryptionKeyNotFound(), metrics.CredentialInvalid},
		{"store unavailable", domain.ErrUnavailable().WithParent(errors.New("retry budget spent")), metrics.CredentialError},
		{"internal", domain.ErrInternal(errors.New("x")), metrics.CredentialError},
		{"not a domain error", errors.New("connection refused"), metrics.CredentialError},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, credentialResult(tt.err))
		})
	}
}

func TestPasswordResult(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name    string
		updated string
		err     error
		want    metrics.PasswordResult
	}{
		{"match", "", nil, metrics.PasswordMatch},
		{"match on an outdated hash", "new-hash", nil, metrics.PasswordUpdated},
		{"match, rehash failed", "", fmt.Errorf("%w: x", crypto.ErrRehashFailed), metrics.PasswordUpdated},
		{"mismatch", "", domain.ErrUserPasswordInvalid().WithParent(fmt.Errorf("%w: x", crypto.ErrHashMismatch)), metrics.PasswordMismatch},
		{"mismatch from the verifier", "", crypto.ErrHashMismatch, metrics.PasswordMismatch},
		{"unreadable hash", "", domain.ErrUserPasswordInvalid().WithParent(crypto.ErrInvalidHash), metrics.PasswordError},
		{"no cause", "", domain.ErrUserPasswordInvalid(), metrics.PasswordError},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, passwordResult(tt.updated, tt.err))
		})
	}
}

// A proof is rejected when it was checked and refused; everything that kept it
// from being checked is an error. ErrAuthAttemptProofRejected wraps whatever
// verify saw, so a storage failure under it still counts as an error.
func TestAuthResult(t *testing.T) {
	t.Parallel()
	rejected := domain.ErrAuthAttemptProofRejected
	for _, tt := range []struct {
		name string
		err  error
		want metrics.AuthResult
	}{
		{"nil", nil, metrics.AuthSuccess},
		{"rejected, no cause", rejected(nil), metrics.AuthRejected},
		{"rejected, user not found", rejected(database.NewNoRowFoundError(nil)), metrics.AuthRejected},
		{"rejected, login name ambiguous", rejected(&database.MultipleRowsFoundError{}), metrics.AuthRejected},
		{"rejected, identifier unresolved", rejected(errIdentifierUnresolved), metrics.AuthRejected},
		{"rejected, wrong password", rejected(domain.ErrUserPasswordInvalid().WithParent(crypto.ErrHashMismatch)), metrics.AuthRejected},
		{"rejected, webauthn refused", rejected(protocol.ErrVerification.WithDetails("signature")), metrics.AuthRejected},
		{"rejected, webauthn nested refusal", rejected(protocol.ErrParsingData.WithError(protocol.ErrBadRequest.WithDetails("short"))), metrics.AuthRejected},
		{"rejected, webauthn lookup found nothing", rejected(protocol.ErrBadRequest.WithDetails("lookup").WithError(database.NewNoRowFoundError(nil))), metrics.AuthRejected},
		{"rejected, webauthn lookup failed in storage", rejected(protocol.ErrBadRequest.WithDetails("lookup").WithError(database.NewUnavailableError(errors.New("down")))), metrics.AuthError},
		{"rejected, domain refusal", rejected(domain.ErrUserNotFound()), metrics.AuthRejected},
		{"rejected, storage unavailable", rejected(database.NewUnavailableError(errors.New("down"))), metrics.AuthError},
		{"rejected, unclassified storage failure", rejected(errors.New("connection refused")), metrics.AuthError},
		{"rejected, internal", rejected(domain.ErrInternal(errors.New("x"))), metrics.AuthError},
		{"attempt not found", domain.ErrAuthAttemptNotFound(), metrics.AuthRejected},
		{"internal", domain.ErrInternal(errors.New("x")), metrics.AuthError},
		{"unavailable", domain.ErrUnavailable(), metrics.AuthError},
		{"not a domain error", errors.New("persist failed"), metrics.AuthError},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, authResult(tt.err))
		})
	}
}

func TestFlowResult(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name string
		res  domain.FlowStepResult
		err  error
		want metrics.FlowResult
	}{
		{"error", domain.FlowStepResult{}, errors.New("x"), metrics.FlowFailed},
		{"error with a step", domain.FlowStepResult{Step: &domain.FlowStep{Complete: new(domain.FlowStepCompleteRedirect)}}, errors.New("x"), metrics.FlowFailed},
		{"no step", domain.FlowStepResult{}, nil, metrics.FlowStep},
		{"step", domain.FlowStepResult{Step: &domain.FlowStep{Name: "password"}}, nil, metrics.FlowStep},
		{"complete", domain.FlowStepResult{Step: &domain.FlowStep{Complete: new(domain.FlowStepCompleteRedirect)}}, nil, metrics.FlowComplete},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, flowResult(tt.res, tt.err))
		})
	}
}
