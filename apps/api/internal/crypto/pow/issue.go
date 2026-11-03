package pow

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"time"
)

// deriver is deliberately private to issuance. Verify is a separate function
// with no deriver dependency, including for legacy/unknown/malformed inputs.
type deriver interface {
	derive(Profile, [nonceSize + 4]byte, [saltSize]byte) ([keySize]byte, error)
}

type pbkdf2Deriver struct{}

func (pbkdf2Deriver) derive(profile Profile, input [nonceSize + 4]byte, salt [saltSize]byte) ([keySize]byte, error) {
	key, err := pbkdf2.Key(sha256.New, string(input[:]), salt[:], profile.Iterations(), keySize)
	if err != nil {
		return [keySize]byte{}, err
	}
	defer clear(key)
	return [keySize]byte(key), nil
}

type issuer struct {
	random  io.Reader
	deriver deriver
}

// Issue performs exactly one KDF invocation at any supported cost level. The
// caller must bound issuance and retain the result for repeated reads.
func Issue(binding Binding, keys Keys, now time.Time) (Challenge, error) {
	return issuer{random: rand.Reader, deriver: pbkdf2Deriver{}}.issue(binding, keys, now)
}

func (i issuer) issue(binding Binding, keys Keys, now time.Time) (Challenge, error) {
	if err := binding.validate(); err != nil {
		return Challenge{}, err
	}
	profile, err := LookupProfile(binding.ProfileID)
	if err != nil {
		return Challenge{}, err
	}
	if err := keys.validate(); err != nil {
		return Challenge{}, err
	}
	if binding.ExpiresAt <= now.Unix() {
		return Challenge{}, ErrExpired
	}
	if binding.ExpiresAt > now.Add(MaxLifetime).Unix() {
		return Challenge{}, ErrInvalidBinding
	}
	var salt [saltSize]byte
	var nonce [nonceSize]byte
	if _, err := io.ReadFull(i.random, salt[:]); err != nil {
		return Challenge{}, fmt.Errorf("pow: generate salt: %w", err)
	}
	if _, err := io.ReadFull(i.random, nonce[:]); err != nil {
		return Challenge{}, fmt.Errorf("pow: generate nonce: %w", err)
	}
	counter, err := rand.Int(i.random, new(big.Int).SetUint64(uint64(profile.MaxTrials())))
	if err != nil {
		return Challenge{}, fmt.Errorf("pow: sample counter: %w", err)
	}
	var input [nonceSize + 4]byte
	copy(input[:], nonce[:])
	binary.BigEndian.PutUint32(input[nonceSize:], uint32(counter.Uint64()))
	defer clear(input[:])
	ctx, err := json.Marshal(binding.context(hex.EncodeToString(salt[:]), hex.EncodeToString(nonce[:])))
	if err != nil {
		return Challenge{}, fmt.Errorf("pow: encode context: %w", err)
	}
	// Fixed overhead for the body, prefix and MAC. Reject before spending a KDF.
	if len(ctx)+len(`{"context":,"key_prefix":"","key_mac":""}`)+2*prefixSize+2*sha256.Size > MaxChallengeBytes {
		return Challenge{}, ErrInvalidBinding
	}
	key, err := i.deriver.derive(profile, input, salt)
	if err != nil {
		return Challenge{}, fmt.Errorf("pow: derive solution: %w", err)
	}
	defer clear(key[:])
	prefix := hex.EncodeToString(key[:prefixSize])
	body, err := json.Marshal(challengeBody{
		Context: ctx, KeyPrefix: prefix,
		KeyMAC: hex.EncodeToString(authenticate(keys.Solution[:], solutionDomain, ctx, key[:])),
	})
	if err != nil {
		return Challenge{}, fmt.Errorf("pow: encode challenge: %w", err)
	}
	return Challenge{
		Stored: StoredChallenge{Body: body},
		Public: PublicChallenge{
			Protocol: Protocol, ChallengeID: binding.ChallengeID, ProfileID: profile.ID(),
			Salt: hex.EncodeToString(salt[:]), Nonce: hex.EncodeToString(nonce[:]),
			KeyPrefix: prefix, ExpiresAt: time.Unix(binding.ExpiresAt, 0).UTC(),
		},
	}, nil
}
