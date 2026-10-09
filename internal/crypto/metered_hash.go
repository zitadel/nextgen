package crypto

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/passwap"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// NewMeteredHashVerifier times every verification of next for the password
// verification metric. A verification is deliberately slow (it is the cost
// parameter doing its job), so how long it takes under load is what says whether
// the server is spending its CPU on logins.
//
// The result separates a wrong password from a hash that could not be read, so
// a spike in the first reads as credential stuffing and in the second as a
// broken migration.
func NewMeteredHashVerifier(next HashVerifier) HashVerifier {
	return meteredHashVerifier{next: next}
}

type meteredHashVerifier struct{ next HashVerifier }

// VerifyHash implements [HashVerifier].
func (m meteredHashVerifier) VerifyHash(encoded string, target string) error {
	start := time.Now()
	err := m.next.VerifyHash(encoded, target)

	result := metrics.PasswordMatch
	switch {
	case err == nil:
	case errors.Is(err, passwap.ErrPasswordMismatch):
		result = metrics.PasswordMismatch
	default:
		result = metrics.PasswordError
	}
	metrics.Default().RecordPasswordVerification(context.Background(), result, time.Since(start))
	return err
}
