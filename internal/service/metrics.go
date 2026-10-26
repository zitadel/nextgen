package service

import (
	"errors"

	"github.com/go-webauthn/webauthn/protocol"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// credentialResult classifies the outcome of validating a bearer credential.
// Anything that is not the bearer's own doing, a read that failed or a key
// that could not be unwrapped, is an error, so a database outage does not read
// as a wave of bad credentials.
func credentialResult(err error) metrics.CredentialResult {
	switch {
	case err == nil:
		return metrics.CredentialValid
	case errors.Is(err, domain.ErrTokenRevoked()):
		return metrics.CredentialRevoked
	case domain.IsServerFault(err):
		return metrics.CredentialError
	default:
		// A refusal the credential earned: malformed, forged, expired, or
		// minted under a key this deployment does not hold.
		return metrics.CredentialInvalid
	}
}

// passwordResult classifies the outcome of verifying a password against its
// hash: the hash was read and the password did not match, or the hash could
// not be verified at all.
func passwordResult(err error) metrics.PasswordResult {
	switch {
	case err == nil:
		return metrics.PasswordMatch
	case errors.Is(err, crypto.ErrHashMismatch):
		return metrics.PasswordMismatch
	default:
		return metrics.PasswordError
	}
}

// authCheck names the kind of proof for the authentication outcome metric.
// A proof of no known kind is not counted: the set of values is closed.
func authCheck(proof Proof) (metrics.AuthCheck, bool) {
	if proof == nil {
		return "", false
	}
	switch proof.proofCheckType() {
	case domain.AuthCheckTypeUser:
		return metrics.CheckUser, true
	case domain.AuthCheckTypePassword:
		return metrics.CheckPassword, true
	case domain.AuthCheckTypePasskey:
		return metrics.CheckPasskey, true
	case domain.AuthCheckTypePasskeyRegistration:
		return metrics.CheckPasskeyRegistration, true
	default:
		return "", false
	}
}

// authResult classifies the outcome of verifying a proof: it worked, it was
// checked and refused, or it could not be completed.
//
// A rejected proof keeps its cause as the parent of auth_attempt.proof_rejected,
// and that cause decides: a storage failure that verify wrapped as a rejection
// is still a failure of the server, not of the proof. Reading the cause here
// is what keeps an outage from counting as a wave of wrong passwords.
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

// proofRejectedResult classifies a rejection by what verify wrapped: nothing,
// a login name that names no one user, a password that does not match, an
// assertion or attestation WebAuthn refused, or a refusal classified by the
// domain is the proof's own doing; anything else is a failure to verify it.
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
		// WebAuthn also wraps what our own lookups returned, such as a storage
		// failure while resolving a discoverable credential: that decides.
		if pe.Err == nil {
			return metrics.AuthRejected
		}
		return proofRejectedResult(pe.Err)
	}
	if _, ok := errors.AsType[domain.Error](cause); ok && !domain.IsServerFault(cause) {
		return metrics.AuthRejected
	}
	return metrics.AuthError
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
