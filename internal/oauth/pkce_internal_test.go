package oauth

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// RFC 7636 Appendix B's worked example.
const (
	rfcVerifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
)

func TestVerifyPKCE(t *testing.T) {
	tests := []struct {
		name      string
		challenge string
		verifier  string
		ok        bool
	}{
		{"the verifier the challenge was made from", rfcChallenge, rfcVerifier, true},
		{"another verifier", rfcChallenge, "aBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", false},
		{"the challenge itself, as plain would send it", rfcChallenge, rfcChallenge, false},
		{"a verifier shorter than 43 characters", rfcChallenge, "short", false},
		{"a verifier with a character outside the unreserved set", rfcChallenge, rfcVerifier[:42] + "+", false},
		{"no verifier", rfcChallenge, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := verifyPKCE(tt.challenge, tt.verifier)
			if tt.ok {
				assert.NoError(t, err)
			} else {
				assert.ErrorIs(t, err, errPKCE)
			}
		})
	}
}

func TestValidChallenge(t *testing.T) {
	assert.True(t, validChallenge(rfcChallenge, "S256"))
	assert.False(t, validChallenge(rfcChallenge, "plain"), "plain is refused (ADR 082 §2)")
	assert.False(t, validChallenge(rfcChallenge, ""), "a method must be named")
	assert.False(t, validChallenge("", "S256"), "a challenge is required")
	assert.False(t, validChallenge(rfcChallenge+"x", "S256"), "an S256 challenge is 43 characters")
}
