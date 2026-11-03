package main

// This is a benchmark candidate, not the product's admission service.
// All keys and scope values below are public, synthetic fixtures.

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/bits"
	"strconv"
	"strings"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go/v2"
	"github.com/go-jose/go-jose/v4"
)

const domainTag = "zitadel:pow:1:"
const fixtureHMAC = "public-benchmark-key-not-a-production-secret"
const fixtureKeyHMAC = "public-benchmark-derived-key-secret"

var fixtureKey = bytes.Repeat([]byte{0x42}, 32)

type Scope struct {
	Project     string `json:"project_id"`
	Attempt     string `json:"attempt_id"`
	Operation   string `json:"operation"`
	Requirement string `json:"requirement_id"`
	Generation  int    `json:"generation"`
}

var fixtureScope = Scope{"project_fixture", "attempt_fixture", "user.create", "requirement_fixture", 1}

type Claims struct {
	Scope
	Protocol   string `json:"protocol"`
	Purpose    string `json:"purpose"`
	Difficulty int    `json:"difficulty_bits"`
	Expires    int64  `json:"expires_at"`
	Random     string `json:"random"`
}

type OwnChallenge struct {
	Ticket     string `json:"ticket"`
	Difficulty int    `json:"difficulty_bits"`
}

type OwnProof struct {
	Counter string `json:"counter"`
}

type Candidate struct {
	Name        string `json:"name"`
	Bits        int    `json:"bits"`
	Cost        int    `json:"cost"`
	Precomputed bool   `json:"precomputed"`
	Own         bool   `json:"own"`
}

var candidates = []Candidate{
	{Name: "zitadel_sha256_16", Bits: 16, Own: true},
	{Name: "zitadel_sha256_18", Bits: 18, Own: true},
	{Name: "zitadel_sha256_20", Bits: 20, Own: true},
	{Name: "altcha_sha256_16", Bits: 16, Cost: 1},
	{Name: "altcha_sha256_20", Bits: 20, Cost: 1},
	{Name: "altcha_pbkdf2_1000", Bits: 8, Cost: 1000},
	{Name: "altcha_pbkdf2_5000", Bits: 8, Cost: 5000},
	{Name: "altcha_pbkdf2_precomputed", Bits: 8, Cost: 5000, Precomputed: true},
}

func makeEncrypter() jose.Encrypter {
	e, err := jose.NewEncrypter(jose.A256GCM, jose.Recipient{Algorithm: jose.DIRECT, Key: fixtureKey},
		(&jose.EncrypterOptions{}).WithType("zitadel-bot-challenge").WithHeader("kid", "public-fixture"))
	if err != nil {
		panic(err)
	}
	return e
}

var encrypter = makeEncrypter()

func issueOwn(difficulty int, expires time.Time) (OwnChallenge, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return OwnChallenge{}, err
	}
	claims := Claims{fixtureScope, "zitadel_pow_v1", "challenge", difficulty, expires.Unix(), base64.RawURLEncoding.EncodeToString(random)}
	data, err := json.Marshal(claims)
	if err != nil {
		return OwnChallenge{}, err
	}
	encrypted, err := encrypter.Encrypt(data)
	if err != nil {
		return OwnChallenge{}, err
	}
	ticket, err := encrypted.CompactSerialize()
	return OwnChallenge{ticket, difficulty}, err
}

func puzzleInput(ticket string) []byte {
	seed := sha256.Sum256([]byte(ticket))
	input := make([]byte, len(domainTag)+32+8)
	copy(input, domainTag)
	copy(input[len(domainTag):], seed[:])
	return input
}

func meets(digest [32]byte, difficulty int) bool {
	for _, b := range digest {
		if difficulty <= 0 {
			return true
		}
		n := bits.LeadingZeros8(b)
		if n >= difficulty {
			return true
		}
		if n < 8 {
			return false
		}
		difficulty -= 8
	}
	return difficulty <= 0
}

func solveOwn(c OwnChallenge) OwnProof {
	input := puzzleInput(c.Ticket)
	for n := uint64(0); ; n++ {
		binary.BigEndian.PutUint64(input[len(input)-8:], n)
		if meets(sha256.Sum256(input), c.Difficulty) {
			return OwnProof{strconv.FormatUint(n, 10)}
		}
	}
}

func verifyOwn(c OwnChallenge, p OwnProof, scope Scope, now time.Time) error {
	if len(c.Ticket) > 4096 || len(p.Counter) == 0 || len(p.Counter) > 20 || (len(p.Counter) > 1 && p.Counter[0] == '0') {
		return errors.New("size or noncanonical counter")
	}
	for _, b := range p.Counter {
		if b < '0' || b > '9' {
			return errors.New("counter encoding")
		}
	}
	n, err := strconv.ParseUint(p.Counter, 10, 64)
	if err != nil {
		return err
	}
	encrypted, err := jose.ParseEncrypted(c.Ticket, []jose.KeyAlgorithm{jose.DIRECT}, []jose.ContentEncryption{jose.A256GCM})
	if err != nil {
		return err
	}
	if encrypted.Header.KeyID != "public-fixture" || encrypted.Header.ExtraHeaders[jose.HeaderType] != "zitadel-bot-challenge" {
		return errors.New("ticket key or type")
	}
	plain, err := encrypted.Decrypt(fixtureKey)
	if err != nil {
		return err
	}
	var claims Claims
	if err := strictJSON(plain, &claims); err != nil {
		return err
	}
	if claims.Scope != scope || claims.Protocol != "zitadel_pow_v1" || claims.Purpose != "challenge" || now.Unix() >= claims.Expires || claims.Difficulty < 1 || claims.Difficulty > 24 {
		return errors.New("scope, protocol, expiry or cost")
	}
	// Projection tampering cannot lower the authenticated cost.
	if c.Difficulty != claims.Difficulty {
		return errors.New("projection mismatch")
	}
	input := puzzleInput(c.Ticket)
	binary.BigEndian.PutUint64(input[len(input)-8:], n)
	if !meets(sha256.Sum256(input), claims.Difficulty) {
		return errors.New("work invalid")
	}
	return nil
}

func strictJSON(data []byte, out any) error {
	// Count keys recursively before decoding so duplicate keys cannot change semantics.
	d := json.NewDecoder(bytes.NewReader(data))
	var value func() error
	value = func() error {
		t, err := d.Token()
		if err != nil {
			return err
		}
		if delim, ok := t.(json.Delim); ok {
			seen := map[string]bool{}
			for d.More() {
				if delim == '{' {
					key, err := d.Token()
					if err != nil {
						return err
					}
					s, ok := key.(string)
					if !ok || seen[s] {
						return errors.New("duplicate or invalid key")
					}
					seen[s] = true
				}
				if err := value(); err != nil {
					return err
				}
			}
			_, err = d.Token()
			return err
		}
		return nil
	}
	if err := value(); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing data")
	}
	d = json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	return d.Decode(out)
}

func (c Candidate) derive() altcha.DeriveKeyFunc {
	if c.Cost == 1 {
		return altcha.DeriveKeySHA()
	}
	return altcha.DeriveKeyPBKDF2()
}

func (c Candidate) issue(expires time.Time) (any, error) {
	if c.Own {
		return issueOwn(c.Bits, expires)
	}
	algorithm := "PBKDF2/SHA-256"
	if c.Cost == 1 {
		algorithm = "SHA-256"
	}
	prefix := ""
	for i := 0; i < c.Bits/4; i++ {
		prefix += "0"
	}
	options := altcha.CreateChallengeOptions{Algorithm: algorithm, DeriveKey: c.derive(), HMACSignatureSecret: fixtureHMAC, Cost: c.Cost, KeyLength: 32, KeyPrefix: prefix, ExpiresAt: &expires,
		Data: map[string]any{"project_id": fixtureScope.Project, "attempt_id": fixtureScope.Attempt, "operation": fixtureScope.Operation, "requirement_id": fixtureScope.Requirement, "generation": fixtureScope.Generation}}
	if c.Precomputed {
		var b [2]byte
		if _, err := rand.Read(b[:]); err != nil {
			return nil, err
		}
		counter := int(binary.BigEndian.Uint16(b[:]) % 512)
		options.Counter = &counter
		options.KeyPrefixLength = 16
		options.HMACKeySignatureSecret = fixtureKeyHMAC
	}
	return altcha.CreateChallenge(options)
}

func (c Candidate) solve(challenge any) (any, error) {
	if c.Own {
		return solveOwn(challenge.(OwnChallenge)), nil
	}
	p, err := altcha.SolveChallenge(altcha.SolveChallengeOptions{Challenge: challenge.(altcha.Challenge), DeriveKey: c.derive(), Timeout: time.Minute})
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, errors.New("solver timeout")
	}
	return *p, nil
}

func (c Candidate) verify(challenge, proof any) error {
	if c.Own {
		return verifyOwn(challenge.(OwnChallenge), proof.(OwnProof), fixtureScope, time.Now())
	}
	ch := challenge.(altcha.Challenge)
	params := ch.Parameters
	expectedAlgorithm := "PBKDF2/SHA-256"
	if c.Cost == 1 {
		expectedAlgorithm = "SHA-256"
	}
	if params.Cost != c.Cost || params.Algorithm != expectedAlgorithm || params.KeyLength != 32 || params.ExpiresAt <= 0 || (params.KeySignature != "") != c.Precomputed {
		return errors.New("ALTCHA configuration mismatch")
	}
	if c.Precomputed {
		if len(params.KeyPrefix) != 32 {
			return errors.New("ALTCHA prefix length")
		}
	} else if params.KeyPrefix != strings.Repeat("0", c.Bits/4) {
		return errors.New("ALTCHA prefix")
	}
	data, _ := json.Marshal(params.Data)
	var scope Scope
	if err := strictJSON(data, &scope); err != nil || scope != fixtureScope {
		return errors.New("ALTCHA scope")
	}
	result, err := altcha.VerifySolution(altcha.VerifySolutionOptions{Challenge: ch, Solution: proof.(altcha.Solution), DeriveKey: c.derive(), HMACSignatureSecret: fixtureHMAC, HMACKeySignatureSecret: fixtureKeyHMAC})
	if err != nil {
		return err
	}
	if !result.Verified {
		return fmt.Errorf("invalid ALTCHA proof: %+v", result)
	}
	return nil
}
