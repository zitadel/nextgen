package main

// Matched KDF experiment. Own means protocol/solver code owned by ZITADEL,
// using standard Go primitives, not a new cryptographic primitive.
import (
	"bytes"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go/v2"
	"golang.org/x/crypto/argon2"
)

type KDFProfile struct {
	ID        string `json:"id"`
	Family    string `json:"family"`
	Algorithm string `json:"algorithm"`
	Cost      int    `json:"cost"`
	MemoryKiB int    `json:"memory_kib"`
	Level     int    `json:"level"`
	Trials    int    `json:"trials"`
}

func matchedProfiles() []KDFProfile {
	var out []KDFProfile
	for _, f := range []struct {
		name, algorithm    string
		cost, memory, base int
	}{
		{"pbkdf2_5000", "PBKDF2/SHA-256", 5000, 0, 512},
		{"argon2id_4m", "ARGON2ID", 1, 4096, 32},
		{"argon2id_16m", "ARGON2ID", 1, 16384, 8},
		{"argon2id_64m", "ARGON2ID", 1, 65536, 2},
	} {
		for level := 1; level <= 4; level++ {
			out = append(out, KDFProfile{fmt.Sprintf("%s_l%d", f.name, level), f.name, f.algorithm, f.cost, f.memory, level, f.base << (level - 1)})
		}
	}
	return out
}
func findProfile(id string) KDFProfile {
	for _, p := range matchedProfiles() {
		if p.ID == id {
			return p
		}
	}
	panic("unknown fixed profile")
}
func (p KDFProfile) derive(salt, password []byte) ([]byte, error) {
	if p.Algorithm == "PBKDF2/SHA-256" {
		return pbkdf2.Key(sha256.New, string(password), salt, p.Cost, 32)
	}
	if p.Algorithm == "ARGON2ID" {
		return argon2.IDKey(password, salt, uint32(p.Cost), uint32(p.MemoryKiB), 1, 32), nil
	}
	return nil, errors.New("unknown algorithm")
}
func (p KDFProfile) libraryDerive() altcha.DeriveKeyFunc {
	if p.Algorithm == "PBKDF2/SHA-256" {
		return altcha.DeriveKeyPBKDF2()
	}
	return altcha.DeriveKeyArgon2id()
}
func passwordInput(nonce []byte, counter uint32) []byte {
	b := make([]byte, len(nonce)+4)
	copy(b, nonce)
	binary.BigEndian.PutUint32(b[len(nonce):], counter)
	return b
}
func randomCounter(p KDFProfile) int {
	var b [4]byte
	_, err := rand.Read(b[:])
	must(err)
	return int(binary.BigEndian.Uint32(b[:]) % uint32(p.Trials))
}

type KDFContext struct {
	Scope
	Protocol string `json:"protocol"`
	Profile  string `json:"profile_id"`
	Expires  int64  `json:"expires_at"`
	Salt     string `json:"salt"`
	Nonce    string `json:"nonce"`
}
type KDFBody struct {
	Context KDFContext `json:"context"`
	Prefix  string     `json:"key_prefix"`
	KeyMAC  string     `json:"key_mac"`
}
type KDFChallenge struct {
	Body KDFBody `json:"body"`
	MAC  string  `json:"mac"`
}
type KDFProof struct {
	Key string `json:"derived_key"`
}

func decodeMatchedProof(b []byte) (KDFProof, error) {
	var raw map[string]json.RawMessage
	if len(b) > 2048 {
		return KDFProof{}, errors.New("proof size")
	}
	if err := strictJSON(b, &raw); err != nil {
		return KDFProof{}, err
	}
	// encoding/json struct matching alone is case-insensitive. Require exact keys.
	key, ok := raw["derived_key"]
	if len(raw) != 1 || !ok || bytes.Equal(key, []byte("null")) {
		return KDFProof{}, errors.New("proof fields")
	}
	var proof KDFProof
	if err := json.Unmarshal(key, &proof.Key); err != nil || !lowerHex(proof.Key, 32) {
		return KDFProof{}, errors.New("proof encoding")
	}
	return proof, nil
}

func keyed(secret, domain string, b []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(domain))
	m.Write(b)
	return hex.EncodeToString(m.Sum(nil))
}
func solutionMAC(c KDFContext, key []byte) string {
	return keyed(fixtureKeyHMAC, "zitadel:pow:solution:1:", append(wire(c), key...))
}
func ownKDFIssue(p KDFProfile, expires time.Time, counter int, salt, nonce []byte) (KDFChallenge, error) {
	if salt == nil {
		salt = make([]byte, 16)
		nonce = make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			return KDFChallenge{}, err
		}
		if _, err := rand.Read(nonce); err != nil {
			return KDFChallenge{}, err
		}
	}
	c := KDFContext{fixtureScope, "zitadel_kdf_candidate_v1", p.ID, expires.Unix(), hex.EncodeToString(salt), hex.EncodeToString(nonce)}
	key, err := p.derive(salt, passwordInput(nonce, uint32(counter)))
	if err != nil {
		return KDFChallenge{}, err
	}
	body := KDFBody{c, hex.EncodeToString(key[:16]), solutionMAC(c, key)}
	return KDFChallenge{body, keyed(fixtureHMAC, "zitadel:pow:parameters:1:", wire(body))}, nil
}
func lowerHex(s string, bytes int) bool {
	if len(s) != 2*bytes {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}
func ownKDFVerify(p KDFProfile, ch KDFChallenge, proof KDFProof, scope Scope, now time.Time) error {
	c := ch.Body.Context
	if c.Protocol != "zitadel_kdf_candidate_v1" || c.Profile != p.ID || c.Scope != scope || now.Unix() >= c.Expires {
		return errors.New("context")
	}
	if !lowerHex(c.Salt, 16) || !lowerHex(c.Nonce, 16) || !lowerHex(ch.Body.Prefix, 16) || !lowerHex(ch.Body.KeyMAC, 32) || !lowerHex(ch.MAC, 32) || !lowerHex(proof.Key, 32) {
		return errors.New("encoding")
	}
	expected := keyed(fixtureHMAC, "zitadel:pow:parameters:1:", wire(ch.Body))
	if !hmac.Equal([]byte(expected), []byte(ch.MAC)) {
		return errors.New("parameter authentication")
	}
	key, _ := hex.DecodeString(proof.Key)
	if !hmac.Equal([]byte(solutionMAC(c, key)), []byte(ch.Body.KeyMAC)) || !strings.HasPrefix(proof.Key, ch.Body.Prefix) {
		return errors.New("work")
	}
	return nil
}
func ownKDFSolve(p KDFProfile, ch KDFChallenge) (KDFProof, int, error) {
	salt, err := hex.DecodeString(ch.Body.Context.Salt)
	if err != nil {
		return KDFProof{}, 0, err
	}
	nonce, err := hex.DecodeString(ch.Body.Context.Nonce)
	if err != nil {
		return KDFProof{}, 0, err
	}
	prefix, err := hex.DecodeString(ch.Body.Prefix)
	if err != nil {
		return KDFProof{}, 0, err
	}
	password := passwordInput(nonce, 0)
	for n := 0; n < p.Trials; n++ {
		binary.BigEndian.PutUint32(password[len(nonce):], uint32(n))
		key, err := p.derive(salt, password)
		if err != nil {
			return KDFProof{}, 0, err
		}
		if bytes.HasPrefix(key, prefix) {
			return KDFProof{hex.EncodeToString(key)}, n, nil
		}
	}
	return KDFProof{}, 0, errors.New("bounded search exhausted")
}

type MatchedScope struct {
	Scope
	Profile string `json:"profile_id"`
	Trials  int    `json:"trials"`
}

func expectedMatchedScope(p KDFProfile) MatchedScope {
	return MatchedScope{fixtureScope, p.ID, p.Trials}
}
func libraryKDFIssue(p KDFProfile, expires time.Time, counter int) (altcha.Challenge, error) {
	var data map[string]any
	must(json.Unmarshal(wire(expectedMatchedScope(p)), &data))
	return altcha.CreateChallenge(altcha.CreateChallengeOptions{Algorithm: p.Algorithm, Cost: p.Cost, Counter: &counter, CounterMode: altcha.CounterModeUint32, Data: data, DeriveKey: p.libraryDerive(), ExpiresAt: &expires, HMACSignatureSecret: fixtureHMAC, HMACKeySignatureSecret: fixtureKeyHMAC, KeyLength: 32, KeyPrefixLength: 16, MemoryCost: p.MemoryKiB, Parallelism: 1})
}
func libraryKDFVerify(p KDFProfile, ch altcha.Challenge, proof KDFProof) error {
	c := ch.Parameters
	if c.Algorithm != p.Algorithm || c.Cost != p.Cost || c.MemoryCost != p.MemoryKiB || c.Parallelism != 1 || c.KeyLength != 32 || c.ExpiresAt <= 0 {
		return errors.New("fixed profile")
	}
	if !lowerHex(c.Salt, 16) || !lowerHex(c.Nonce, 16) || !lowerHex(c.KeyPrefix, 16) || !lowerHex(c.KeySignature, 32) || !lowerHex(ch.Signature, 32) || !lowerHex(proof.Key, 32) {
		return errors.New("encoding")
	}
	var scope MatchedScope
	if err := strictJSON(wire(c.Data), &scope); err != nil || scope != expectedMatchedScope(p) {
		return errors.New("scope")
	}
	result, err := altcha.VerifySolution(altcha.VerifySolutionOptions{Challenge: ch, Solution: altcha.Solution{DerivedKey: proof.Key}, DeriveKey: p.libraryDerive(), HMACSignatureSecret: fixtureHMAC, HMACKeySignatureSecret: fixtureKeyHMAC, CounterMode: altcha.CounterModeUint32})
	if err != nil {
		return err
	}
	if !result.Verified {
		return errors.New("ALTCHA work")
	}
	return nil
}
func libraryKDFSolve(p KDFProfile, ch altcha.Challenge) (KDFProof, int, error) {
	calls := 0
	derive := p.libraryDerive()
	solution, err := altcha.SolveChallenge(altcha.SolveChallengeOptions{Challenge: ch, CounterMode: altcha.CounterModeUint32, Timeout: 2 * time.Minute, DeriveKey: func(params altcha.ChallengeParameters, salt, password []byte) ([]byte, error) {
		calls++
		if calls > p.Trials {
			return nil, errors.New("bounded search exhausted")
		}
		return derive(params, salt, password)
	}})
	if err != nil {
		return KDFProof{}, 0, err
	}
	if solution == nil {
		return KDFProof{}, 0, errors.New("timeout")
	}
	return KDFProof{solution.DerivedKey}, solution.Counter, nil
}

type MatchedSample struct {
	Own             KDFChallenge     `json:"own"`
	Library         altcha.Challenge `json:"altcha"`
	Counter         int              `json:"counter"` // synthetic fixture only; never a product challenge field
	Proof           KDFProof         `json:"proof"`
	NativeOwnMS     float64          `json:"native_own_ms"`
	NativeLibraryMS float64          `json:"native_altcha_ms"`
}
type MatchedGroup struct {
	Profile KDFProfile                          `json:"profile"`
	Samples []MatchedSample                     `json:"samples"`
	Server  map[string]map[string][]Measurement `json:"server"`
}
type MatchedCorpus struct {
	Created string         `json:"created_at"`
	Go      string         `json:"go"`
	Groups  []MatchedGroup `json:"groups"`
}

func matchedMain(samples int, out, verify, memoryProfile, implementation string, concurrency int) {
	if memoryProfile != "" {
		matchedMemory(findProfile(memoryProfile), implementation, concurrency)
		return
	}
	path := filepath.Join(out, "matched-corpus.json")
	if verify != "" {
		var corpus MatchedCorpus
		b, err := os.ReadFile(path)
		must(err)
		must(json.Unmarshal(b, &corpus))
		var rows []struct {
			Profile        string   `json:"profile"`
			Index          int      `json:"index"`
			Implementation string   `json:"implementation"`
			Proof          KDFProof `json:"proof"`
		}
		b, err = os.ReadFile(verify)
		must(err)
		must(json.Unmarshal(b, &rows))
		for _, r := range rows {
			found := false
			for _, g := range corpus.Groups {
				if g.Profile.ID != r.Profile {
					continue
				}
				found = true
				s := g.Samples[r.Index]
				if r.Proof != s.Proof {
					panic("cross-language derived key mismatch")
				}
				if r.Implementation == "own" {
					must(ownKDFVerify(g.Profile, s.Own, r.Proof, fixtureScope, time.Now()))
				} else if r.Implementation == "altcha" {
					must(libraryKDFVerify(g.Profile, s.Library, r.Proof))
				} else {
					panic("unknown implementation")
				}
			}
			if !found {
				panic("unknown profile")
			}
		}
		fmt.Printf("Verified %d matched browser proofs in Go\n", len(rows))
		return
	}
	if samples < 4 || samples > 256 {
		panic("samples must be 4..256")
	}
	expires := time.Now().Add(24 * time.Hour)
	corpus := MatchedCorpus{Created: time.Now().UTC().Format(time.RFC3339), Go: runtime.Version()}
	// Shared uniform quantiles across all levels keep search luck comparable.
	draws := make([]uint32, samples)
	for i := range draws {
		var b [4]byte
		_, err := rand.Read(b[:])
		must(err)
		draws[i] = binary.BigEndian.Uint32(b[:])
	}
	for _, p := range matchedProfiles() {
		g := MatchedGroup{Profile: p, Server: map[string]map[string][]Measurement{"own": {}, "altcha": {}}}
		for i := 0; i < samples; i++ {
			n := int((uint64(draws[i]) * uint64(p.Trials)) >> 32)
			lib, err := libraryKDFIssue(p, expires, n)
			must(err)
			salt, _ := hex.DecodeString(lib.Parameters.Salt)
			nonce, _ := hex.DecodeString(lib.Parameters.Nonce)
			own, err := ownKDFIssue(p, expires, n, salt, nonce)
			must(err)
			var op, lp KDFProof
			var ownMS, libMS float64
			solveOwn := func() {
				start := time.Now()
				var found int
				op, found, err = ownKDFSolve(p, own)
				must(err)
				if found != n {
					panic("unexpected own counter")
				}
				ownMS = float64(time.Since(start).Nanoseconds()) / 1e6
			}
			solveLib := func() {
				start := time.Now()
				var found int
				lp, found, err = libraryKDFSolve(p, lib)
				must(err)
				if found != n {
					panic("unexpected ALTCHA counter")
				}
				libMS = float64(time.Since(start).Nanoseconds()) / 1e6
			}
			if i%2 == 0 {
				solveOwn()
				solveLib()
			} else {
				solveLib()
				solveOwn()
			}
			if op != lp {
				panic("paired derivation mismatch")
			}
			must(ownKDFVerify(p, own, op, fixtureScope, time.Now()))
			must(libraryKDFVerify(p, lib, lp))
			g.Samples = append(g.Samples, MatchedSample{own, lib, n, op, ownMS, libMS})
		}
		// Three repeated batches, reverse implementation order every batch.
		sample := g.Samples[0]
		ownWire, libraryWire := wire(sample.Own), wire(sample.Library)
		bad := KDFProof{strings.Repeat("0", 64)}
		for rep := 0; rep < 3; rep++ {
			names := []string{"own", "altcha"}
			if rep%2 == 1 {
				names = []string{"altcha", "own"}
			}
			for _, impl := range names {
				issueN := 100
				if p.MemoryKiB > 0 {
					issueN = 16
				}
				issue := func() {
					if impl == "own" {
						_, err := ownKDFIssue(p, expires, randomCounter(p), nil, nil)
						must(err)
					} else {
						_, err := libraryKDFIssue(p, expires, randomCounter(p))
						must(err)
					}
				}
				verify := func(proof KDFProof) error {
					if impl == "own" {
						return ownKDFVerify(p, sample.Own, proof, fixtureScope, time.Now())
					}
					return libraryKDFVerify(p, sample.Library, proof)
				}
				g.Server[impl]["issue"] = append(g.Server[impl]["issue"], measure(issueN, issue))
				g.Server[impl]["verify"] = append(g.Server[impl]["verify"], measure(1000, func() { must(verify(sample.Proof)) }))
				g.Server[impl]["bad_work"] = append(g.Server[impl]["bad_work"], measure(1000, func() {
					if verify(bad) == nil {
						panic("invalid proof passed")
					}
				}))
				g.Server[impl]["decode_verify"] = append(g.Server[impl]["decode_verify"], measure(1000, func() {
					if impl == "own" {
						var ch KDFChallenge
						must(strictJSON(ownWire, &ch))
						must(ownKDFVerify(p, ch, sample.Proof, fixtureScope, time.Now()))
					} else {
						var ch altcha.Challenge
						must(strictJSON(libraryWire, &ch))
						must(libraryKDFVerify(p, ch, sample.Proof))
					}
				}))
			}
		}
		corpus.Groups = append(corpus.Groups, g)
		write(path, corpus)
		fmt.Printf("Matched Go: %s (%d paired samples)\n", p.ID, samples)
	}
}
func matchedMemory(p KDFProfile, implementation string, concurrency int) {
	if concurrency < 1 || concurrency > 16 {
		panic("invalid concurrency")
	}
	runtime.GC()
	var initial runtime.MemStats
	runtime.ReadMemStats(&initial)
	start := make(chan struct{})
	done := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for j := 0; j < 3; j++ {
				if implementation == "own" {
					_, err := ownKDFIssue(p, time.Now().Add(time.Hour), 0, nil, nil)
					must(err)
				} else {
					_, err := libraryKDFIssue(p, time.Now().Add(time.Hour), 0)
					must(err)
				}
			}
		}()
	}
	go func() { wg.Wait(); close(done) }()
	close(start)
	ticker := time.NewTicker(200 * time.Microsecond)
	defer ticker.Stop()
	peak := initial.HeapAlloc
	for {
		select {
		case <-ticker.C:
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			if m.HeapAlloc > peak {
				peak = m.HeapAlloc
			}
		case <-done:
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			if m.HeapAlloc > peak {
				peak = m.HeapAlloc
			}
			must(json.NewEncoder(os.Stdout).Encode(map[string]any{"profile": p.ID, "implementation": implementation, "concurrency": concurrency, "sampled_peak_heap_bytes": peak, "baseline_heap_bytes": initial.HeapAlloc, "total_allocated_bytes": m.TotalAlloc - initial.TotalAlloc}))
			return
		}
	}
}
