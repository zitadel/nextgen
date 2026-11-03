package oauth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"regexp"
)

// errPKCE is a code verifier that does not prove the request it is presented
// for. The token endpoint answers it with invalid_grant.
var errPKCE = errors.New("pkce: the code verifier does not match the challenge")

// pkceVerifier is RFC 7636 §4.1's code verifier: 43 to 128 unreserved
// characters.
var pkceVerifier = regexp.MustCompile(`^[A-Za-z0-9\-._~]{43,128}$`)

// pkceChallenge is an S256 challenge: the unpadded base64url of a SHA-256.
var pkceChallenge = regexp.MustCompile(`^[A-Za-z0-9\-_]{43}$`)

// validChallenge reports whether an authorization request's PKCE parameters
// are the only kind this server takes: S256 (ADR 082 §2). plain is refused,
// and so is a request without a challenge.
func validChallenge(challenge, method string) bool {
	return method == "S256" && pkceChallenge.MatchString(challenge)
}

// verifyPKCE checks verifier against the S256 challenge the code was issued
// for (RFC 7636 §4.6).
func verifyPKCE(challenge, verifier string) error {
	if !pkceVerifier.MatchString(verifier) {
		return errPKCE
	}
	sum := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(computed), []byte(challenge)) != 1 {
		return errPKCE
	}
	return nil
}
