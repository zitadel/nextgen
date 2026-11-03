package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go/v2"
	"github.com/go-jose/go-jose/v4"
)

func TestOwnProofBoundaries(t *testing.T) {
	c, err := issueOwn(8, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	p := solveOwn(c)
	if err := verifyOwn(c, p, fixtureScope, time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, counter := range []string{"", "-1", "+1", "01", "1.0", "1e2", " 1", "18446744073709551616", strings.Repeat("1", 100)} {
		t.Run(counter, func(t *testing.T) {
			if verifyOwn(c, OwnProof{counter}, fixtureScope, time.Now()) == nil {
				t.Fatal("accepted invalid counter")
			}
		})
	}
	tampered := c
	tampered.Difficulty = 1
	if verifyOwn(tampered, p, fixtureScope, time.Now()) == nil {
		t.Fatal("accepted lower cost")
	}
	if verifyOwn(c, p, fixtureScope, time.Now().Add(2*time.Minute)) == nil {
		t.Fatal("accepted expired challenge")
	}
	scope := fixtureScope
	scope.Project = "other"
	if verifyOwn(c, p, scope, time.Now()) == nil {
		t.Fatal("accepted other project")
	}
	scope = fixtureScope
	scope.Operation = "password.verify"
	if verifyOwn(c, p, scope, time.Now()) == nil {
		t.Fatal("accepted other operation")
	}
	scope = fixtureScope
	scope.Attempt = "other"
	if verifyOwn(c, p, scope, time.Now()) == nil {
		t.Fatal("accepted other attempt")
	}
	scope = fixtureScope
	scope.Generation++
	if verifyOwn(c, p, scope, time.Now()) == nil {
		t.Fatal("accepted stale generation")
	}
	tampered = c
	tampered.Ticket = strings.Repeat("x", 4097)
	if verifyOwn(tampered, p, fixtureScope, time.Now()) == nil {
		t.Fatal("accepted oversized ticket")
	}
}

func TestStrictJSON(t *testing.T) {
	for _, input := range []string{`{"counter":"1","counter":"2"}`, `{"counter":"1","extra":1}`, `{"counter":"1"} {}`, `{"counter":1}`} {
		var p OwnProof
		if strictJSON([]byte(input), &p) == nil {
			t.Fatalf("accepted %s", input)
		}
	}
}

func TestAuthenticatedClaims(t *testing.T) {
	now := time.Unix(1800000000, 0)
	base := Claims{fixtureScope, "zitadel_pow_v1", "challenge", 1, now.Add(time.Minute).Unix(), "public-fixture"}
	for _, name := range []string{"protocol", "purpose", "expired", "cost_zero", "cost_high", "key", "type", "tampered_ciphertext"} {
		t.Run(name, func(t *testing.T) {
			claims := base
			key := fixtureKey
			typ := "zitadel-bot-challenge"
			switch name {
			case "protocol":
				claims.Protocol = "future"
			case "purpose":
				claims.Purpose = "receipt"
			case "expired":
				claims.Expires = now.Unix()
			case "cost_zero":
				claims.Difficulty = 0
			case "cost_high":
				claims.Difficulty = 25
			case "key":
				key = []byte("01234567890123456789012345678901")
			case "type":
				typ = "session"
			}
			e, err := jose.NewEncrypter(jose.A256GCM, jose.Recipient{Algorithm: jose.DIRECT, Key: key}, (&jose.EncrypterOptions{}).WithType(jose.ContentType(typ)).WithHeader("kid", "public-fixture"))
			if err != nil {
				t.Fatal(err)
			}
			obj, err := e.Encrypt(wire(claims))
			if err != nil {
				t.Fatal(err)
			}
			ticket, err := obj.CompactSerialize()
			if err != nil {
				t.Fatal(err)
			}
			if name == "tampered_ciphertext" {
				parts := strings.Split(ticket, ".")
				if parts[3][0] == 'A' {
					parts[3] = "B" + parts[3][1:]
				} else {
					parts[3] = "A" + parts[3][1:]
				}
				ticket = strings.Join(parts, ".")
			}
			if verifyOwn(OwnChallenge{ticket, claims.Difficulty}, OwnProof{"0"}, fixtureScope, now) == nil {
				t.Fatal("accepted invalid authenticated claims")
			}
		})
	}
}

func FuzzStrictProof(f *testing.F) {
	f.Add([]byte(`{"counter":"1"}`))
	f.Add([]byte(`{"counter":"1","counter":"2"}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		if len(b) > 4096 {
			return
		}
		var p OwnProof
		_ = strictJSON(b, &p)
	})
}

func TestALTCHADerivationVector(t *testing.T) {
	var v struct {
		Parameters altcha.ChallengeParameters `json:"parameters"`
		Counter    uint32                     `json:"counter"`
		Key        string                     `json:"derived_key"`
	}
	b, err := os.ReadFile("testdata/altcha-vector.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	salt, err := hex.DecodeString(v.Parameters.Salt)
	if err != nil {
		t.Fatal(err)
	}
	nonce, err := hex.DecodeString(v.Parameters.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	password := append(nonce, make([]byte, 4)...)
	binary.BigEndian.PutUint32(password[len(password)-4:], v.Counter)
	key, err := altcha.DeriveKeyPBKDF2()(v.Parameters, salt, password)
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(key) != v.Key {
		t.Fatalf("key %x", key)
	}
}

func TestPrecomputedNeverDerivesOnVerification(t *testing.T) {
	c := candidates[len(candidates)-1]
	ch, err := c.issue(time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	p, err := c.solve(ch)
	if err != nil {
		t.Fatal(err)
	}
	derive := func(_ altcha.ChallengeParameters, _, _ []byte) ([]byte, error) {
		t.Error("verification ran KDF")
		return nil, errors.New("KDF forbidden")
	}
	options := altcha.VerifySolutionOptions{Challenge: ch.(altcha.Challenge), Solution: p.(altcha.Solution), DeriveKey: derive, HMACSignatureSecret: fixtureHMAC, HMACKeySignatureSecret: fixtureKeyHMAC}
	result, err := altcha.VerifySolution(options)
	if err != nil || !result.Verified {
		t.Fatalf("valid proof: %+v %v", result, err)
	}
	// The counter is not authenticated in this mode; our product proof omits it.
	options.Solution.Counter = 0
	result, err = altcha.VerifySolution(options)
	if err != nil || !result.Verified {
		t.Fatalf("counter changed proof validity: %+v %v", result, err)
	}
	options.Solution.DerivedKey = strings.Repeat("0", 64)
	result, err = altcha.VerifySolution(options)
	if err != nil || result.Verified {
		t.Fatalf("bad key: %+v %v", result, err)
	}
	broken := ch.(altcha.Challenge)
	broken.Parameters.KeySignature = ""
	if c.verify(broken, p) == nil {
		t.Fatal("adapter accepted missing key signature")
	}
}

func TestDigestVector(t *testing.T) {
	// Pins domain separation, ticket bytes and unsigned big-endian encoding.
	input := puzzleInput("fixture-ticket")
	binary.BigEndian.PutUint64(input[len(input)-8:], 0x0102030405060708)
	digest := sha256.Sum256(input)
	const expected = "569acc01eb9b3c62c9f0bec110995475086a75a39b256ca360b562318f03dabb"
	if hex.EncodeToString(digest[:]) != expected {
		t.Fatalf("digest %x", digest)
	}
	t.Logf("input=%x digest=%x", input, digest)
}

func TestLibraryRoundTripAndScope(t *testing.T) {
	for _, candidate := range candidates[3:] {
		c := candidate
		c.Bits = 4
		t.Run(c.Name, func(t *testing.T) {
			ch, err := c.issue(time.Now().Add(time.Minute))
			if err != nil {
				t.Fatal(err)
			}
			p, err := c.solve(ch)
			if err != nil {
				t.Fatal(err)
			}
			a, b := decode(c, wire(ch), wire(p))
			if err := c.verify(a, b); err != nil {
				t.Fatal(err)
			}
			var raw map[string]any
			json.Unmarshal(wire(ch), &raw)
			raw["parameters"].(map[string]any)["data"].(map[string]any)["project_id"] = "other"
			a, b = decode(c, wire(raw), wire(p))
			if c.verify(a, b) == nil {
				t.Fatal("accepted other scope")
			}
		})
	}
}
