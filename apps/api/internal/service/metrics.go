package service

import (
	"errors"

	"github.com/go-webauthn/webauthn/protocol"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// credentialResult maps a validation error to its CredentialResult. A missing
// project KEK row surfaces as ErrEncryptionKeyNotFound, indistinguishable here
// from a key id the bearer presented, so it counts as invalid.
func credentialResult(err error) metrics.CredentialResult {
	switch {
	case err == nil:
		return metrics.CredentialValid
	case errors.Is(err, domain.ErrTokenRevoked()):
		return metrics.CredentialRevoked
	case domain.IsServerFault(err):
		return metrics.CredentialError
	default:
		return metrics.CredentialInvalid
	}
}

// passwordResult maps a verification's outcome to its PasswordResult: updated
// is the new hash a match on an outdated hash computed, or empty.
func passwordResult(updated string, err error) metrics.PasswordResult {
	switch {
	case updated != "" || errors.Is(err, crypto.ErrRehashFailed):
		return metrics.PasswordUpdated
	case err == nil:
		return metrics.PasswordMatch
	case errors.Is(err, crypto.ErrHashMismatch):
		return metrics.PasswordMismatch
	default:
		return metrics.PasswordError
	}
}

// authChecks names the kind of proof for the authentication outcome metric. A
// proof kind not in the map is not counted: the set of values is closed.
var authChecks = map[domain.AuthCheckType]metrics.AuthCheck{
	domain.AuthCheckTypeUser:                metrics.CheckUser,
	domain.AuthCheckTypePassword:            metrics.CheckPassword,
	domain.AuthCheckTypePasskey:             metrics.CheckPasskey,
	domain.AuthCheckTypePasskeyRegistration: metrics.CheckPasskeyRegistration,
}

// authResult classifies the outcome of verifying a proof: it worked, it was
// checked and refused, or it could not be completed.
func authResult(err error) metrics.AuthResult {
	if err == nil {
		return metrics.AuthSuccess
	}
	if errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)) {
		rejected, _ := errors.AsType[domain.Error](err)
		return proofRejectedResult(rejected.Parent)
	}
	if domain.IsServerFault(err) {
		return metrics.AuthError
	}
	return metrics.AuthRejected
}

// proofRejectedResult classifies the cause verify wrapped: the proof's own
// doing, or a failure to verify it.
func proofRejectedResult(cause error) metrics.AuthResult {
	if cause == nil || errors.Is(cause, errIdentifierUnresolved) {
		return metrics.AuthRejected
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](cause); ok {
		return metrics.AuthRejected
	}
	if _, ok := errors.AsType[*database.MultipleRowsFoundError](cause); ok {
		return metrics.AuthRejected
	}
	if pe, ok := errors.AsType[*protocol.Error](cause); ok {
		// WebAuthn nests its own errors: the innermost one says whether it
		// wraps anything but a refusal.
		for inner, ok := errors.AsType[*protocol.Error](pe.Err); ok; inner, ok = errors.AsType[*protocol.Error](pe.Err) {
			pe = inner
		}
		if pe.Err == nil {
			return metrics.AuthRejected
		}
	}
	if domain.IsServerFault(cause) {
		return metrics.AuthError
	}
	return metrics.AuthRejected
}

// flowResult classifies where a flow engine operation left the flow: at a
// step the client renders next, at a terminal step, or in an error.
func flowResult(res domain.FlowStepResult, err error) metrics.FlowResult {
	switch {
	case err != nil:
		return metrics.FlowFailed
	case res.Step != nil && res.Step.Complete != nil:
		return metrics.FlowComplete
	default:
		return metrics.FlowStep
	}
}
