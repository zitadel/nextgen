package pow

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

type vector struct {
	Name        string          `json:"name"`
	Counter     uint32          `json:"counter"`
	SolutionKey string          `json:"solution_key"`
	ContextJSON string          `json:"context_json"`
	Body        string          `json:"body"`
	DerivedKey  string          `json:"derived_key"`
	Proof       string          `json:"proof"`
	Public      PublicChallenge `json:"public"`
}

func vectors(t testing.TB) []vector {
	t.Helper()
	data, err := os.ReadFile("../../../../../docs/design/flowengine/testdata/pow-v1-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Vectors []vector `json:"vectors"`
	}
	if err := json.Unmarshal(data, &file); err != nil || len(file.Vectors) != 4 {
		t.Fatalf("load four reference vectors: %v", err)
	}
	return file.Vectors
}

func unhex(t testing.TB, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func (v vector) inputs(t testing.TB) (Binding, Keys, StoredChallenge, time.Time) {
	t.Helper()
	var c challengeContext
	if err := json.Unmarshal([]byte(v.ContextJSON), &c); err != nil {
		t.Fatal(err)
	}
	return c.Binding, Keys{Solution: [32]byte(unhex(t, v.SolutionKey))},
		StoredChallenge{Body: []byte(v.Body)}, time.Unix(c.ExpiresAt, 0).Add(-MaxLifetime)
}

type spyDeriver struct {
	calls int
	err   error
	input [20]byte
	salt  [16]byte
}

func (d *spyDeriver) derive(p Profile, input [20]byte, salt [16]byte) ([32]byte, error) {
	d.calls++
	d.input, d.salt = input, salt
	if d.err != nil {
		return [32]byte{}, d.err
	}
	return pbkdf2Deriver{}.derive(p, input, salt)
}

func TestReferenceVectors(t *testing.T) {
	t.Parallel()
	for _, v := range vectors(t) {
		t.Run(v.Name, func(t *testing.T) {
			binding, keys, stored, now := v.inputs(t)
			if err := Verify(stored, v.Proof, binding, keys, now); err != nil {
				t.Fatalf("verify independently generated WebCrypto proof: %v", err)
			}
			entropy := append(unhex(t, v.Public.Salt), unhex(t, v.Public.Nonce)...)
			entropy = binary.BigEndian.AppendUint16(entropy, uint16(v.Counter))
			deriver := new(spyDeriver)
			issued, err := (issuer{random: bytes.NewReader(entropy), deriver: deriver}).issue(binding, keys, now)
			if err != nil {
				t.Fatal(err)
			}
			if deriver.calls != 1 || binary.BigEndian.Uint32(deriver.input[16:]) != v.Counter {
				t.Fatalf("issuance must perform exactly one KDF at counter %d; got calls=%d input=%x", v.Counter, deriver.calls, deriver.input)
			}
			if string(issued.Stored.Body) != v.Body {
				t.Fatalf("Go framing differs from WebCrypto vector:\n%s", issued.Stored.Body)
			}
			if !reflect.DeepEqual(issued.Public, v.Public) {
				t.Fatalf("public projection mismatch: %+v", issued.Public)
			}
			profile, _ := LookupProfile(binding.ProfileID)
			key, err := pbkdf2Deriver{}.derive(profile, deriver.input, deriver.salt)
			if err != nil || hex.EncodeToString(key[:]) != v.DerivedKey {
				t.Fatalf("native KDF differs from WebCrypto: %x %v", key, err)
			}

		})
	}
}

func TestProfiles(t *testing.T) {
	t.Parallel()
	for level, trials := range map[int]uint32{1: 512, 2: 1024, 3: 2048, 4: 4096} {
		profile, err := ProfileForLevel(DefaultAlgorithm, level)
		if err != nil || profile.Level() != level || profile.MaxTrials() != trials || profile.Iterations() != 5000 || profile.Algorithm() != DefaultAlgorithm {
			t.Fatalf("profile %d changed: %+v %v", level, profile, err)
		}
		if got, err := LookupProfile(profile.ID()); err != nil || got != profile {
			t.Fatalf("registry mismatch: %+v %v", got, err)
		}
	}
	for _, level := range []int{-1, 0, 5, 256, int(^uint(0) >> 1)} {
		if _, err := ProfileForLevel(DefaultAlgorithm, level); !errors.Is(err, ErrUnsupportedProfile) {
			t.Fatalf("unbounded/zero level %d accepted: %v", level, err)
		}
	}
	for _, algorithm := range []Algorithm{"", "argon2id", "bcrypt", "PBKDF2_SHA256"} {
		if _, err := ProfileForLevel(algorithm, 1); !errors.Is(err, ErrUnsupportedProfile) {
			t.Fatalf("unsupported algorithm %q accepted", algorithm)
		}
	}
	for _, id := range []string{"", "pbkdf2_sha256_5000_l0", "pbkdf2_sha256_5000_l5", "argon2id_4096_l1", "PBKDF2_SHA256_5000_L1"} {
		if _, err := LookupProfile(id); !errors.Is(err, ErrUnsupportedProfile) {
			t.Fatalf("unsupported profile %q accepted", id)
		}
	}
}

func TestProofParsing(t *testing.T) {
	t.Parallel()
	v := vectors(t)[1]
	valid := v.Proof
	cases := map[string]string{
		"empty": "", "null": "null", "array": "[]", "empty object": "{}",
		"trailing value": valid + " {}", "trailing garbage": valid + "x",
		"over limit":        valid + strings.Repeat(" ", MaxProofBytes),
		"unknown field":     strings.TrimSuffix(valid, "}") + `,"counter":1023}`,
		"duplicate field":   strings.TrimSuffix(valid, "}") + `,"challenge_id":"other"}`,
		"escaped duplicate": strings.TrimSuffix(valid, "}") + `,"\u0070rotocol":"zitadel_pow_poc_v1"}`,
		"case alias":        strings.Replace(valid, "protocol", "Protocol", 1),
		"unknown version":   strings.Replace(valid, Protocol, "zitadel_pow_poc_v2", 1),
		"numeric version":   strings.Replace(valid, `"`+Protocol+`"`, "1", 1),
		"null version":      strings.Replace(valid, `"`+Protocol+`"`, "null", 1),
		"null key":          strings.Replace(valid, `"`+v.DerivedKey+`"`, "null", 1),
		"array key":         strings.Replace(valid, `"`+v.DerivedKey+`"`, "[]", 1),
		"upper hex":         strings.Replace(valid, v.DerivedKey, strings.ToUpper(v.DerivedKey), 1),
		"short key":         strings.Replace(valid, v.DerivedKey, v.DerivedKey[:62], 1),
		"long key":          strings.Replace(valid, v.DerivedKey, v.DerivedKey+"00", 1),
		"non hex":           strings.Replace(valid, v.DerivedKey, "g"+v.DerivedKey[1:], 1),
		"empty challenge":   strings.Replace(valid, v.Public.ChallengeID, "", 1),
		"oversized id":      strings.Replace(valid, v.Public.ChallengeID, strings.Repeat("a", 257), 1),
		"invalid UTF8":      strings.Replace(valid, v.Public.ChallengeID, string([]byte{0xff}), 1),
		"missing key":       `{"protocol":"zitadel_pow_poc_v1","challenge_id":"chl_vector_2"}`,
	}
	for name, proof := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseProof(proof); !errors.Is(err, ErrInvalidProof) {
				t.Fatalf("accepted malformed proof: %v", err)
			}
		})
	}
	for _, proof := range []string{valid, " \n" + valid + "\t", valid + strings.Repeat(" ", MaxProofBytes-len(valid))} {
		if _, err := ParseProof(proof); err != nil {
			t.Fatalf("valid bounded JSON rejected: %v", err)
		}
	}
}

func TestEveryBindingIsRequired(t *testing.T) {
	t.Parallel()
	v := vectors(t)[1]
	binding, keys, stored, now := v.inputs(t)
	value := reflect.ValueOf(binding)
	for n := range value.NumField() {
		name := value.Type().Field(n).Name
		t.Run(name, func(t *testing.T) {
			changed := binding
			field := reflect.ValueOf(&changed).Elem().Field(n)
			switch field.Kind() {
			case reflect.String:
				field.SetString(field.String() + "_other")
			case reflect.Uint64:
				field.SetUint(field.Uint() + 1)
			case reflect.Int64:
				field.SetInt(field.Int() + 1)
			default:
				t.Fatalf("add binding mutation coverage for %s", name)
			}
			want := ErrBindingMismatch
			if name == "ProfileID" {
				changed.ProfileID = "pbkdf2_sha256_5000_l3"
			}
			if err := Verify(stored, v.Proof, changed, keys, now); !errors.Is(err, want) {
				t.Fatalf("binding substitution: got %v, want %v", err, want)
			}
		})
	}

}

func replaceBody(t testing.TB, stored StoredChallenge, keys Keys, mutate func(map[string]json.RawMessage)) StoredChallenge {
	t.Helper()
	var body map[string]json.RawMessage
	if err := json.Unmarshal(stored.Body, &body); err != nil {
		t.Fatal(err)
	}
	mutate(body)
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return StoredChallenge{Body: data}
}

func TestVerifierRejectsTampering(t *testing.T) {
	t.Parallel()
	v := vectors(t)[1]
	binding, keys, stored, now := v.inputs(t)
	type verification struct {
		stored  StoredChallenge
		proof   string
		keys    Keys
		binding Binding
		now     time.Time
	}
	cases := []struct {
		name   string
		change func(*verification)
		want   error
	}{
		{"salt tampered", func(c *verification) {
			c.stored.Body = bytes.Replace(c.stored.Body, []byte(v.Public.Salt), []byte(strings.Repeat("0", 32)), 1)
		}, ErrInvalidProof},
		{"oversized body", func(c *verification) { c.stored.Body = bytes.Repeat([]byte(" "), MaxChallengeBytes+1) }, ErrInvalidChallenge},
		{"wrong solution key", func(c *verification) { c.keys.Solution[0] ^= 1 }, ErrInvalidProof},
		{"unresolved keys", func(c *verification) { c.keys = Keys{} }, ErrInvalidKeys},
		{"expired at boundary", func(c *verification) { c.now = time.Unix(binding.ExpiresAt, 0) }, ErrExpired},
		{"expired after boundary", func(c *verification) { c.now = time.Unix(binding.ExpiresAt+1, 0) }, ErrExpired},
		{"unknown profile", func(c *verification) { c.binding.ProfileID = "future" }, ErrUnsupportedProfile},
		{"unresolved binding", func(c *verification) { c.binding.OperationInstanceID = "" }, ErrInvalidBinding},
		{"wrong challenge id", func(c *verification) { c.proof = strings.Replace(v.Proof, v.Public.ChallengeID, "other", 1) }, ErrInvalidProof},
		{"correct prefix only", func(c *verification) {
			c.proof = strings.Replace(v.Proof, v.DerivedKey, v.DerivedKey[:32]+strings.Repeat("0", 32), 1)
		}, ErrInvalidProof},
		{"wrong full key", func(c *verification) { c.proof = strings.Replace(v.Proof, v.DerivedKey, strings.Repeat("f", 64), 1) }, ErrInvalidProof},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			c := verification{stored: StoredChallenge{Body: bytes.Clone(stored.Body)}, proof: v.Proof, keys: keys, binding: binding, now: now}
			test.change(&c)
			if err := Verify(c.stored, c.proof, c.binding, c.keys, c.now); !errors.Is(err, test.want) {
				t.Fatalf("got %v, want %v", err, test.want)
			}
		})
	}
	if err := Verify(stored, v.Proof, binding, keys, time.Unix(binding.ExpiresAt, 0).Add(-time.Nanosecond)); err != nil {
		t.Fatalf("valid proof must work until exact expiry: %v", err)
	}
}

func TestAuthenticatedMalformedStorage(t *testing.T) {
	t.Parallel()
	v := vectors(t)[1]
	binding, keys, stored, now := v.inputs(t)
	// Even authenticated storage must pass strict decoding.
	for name, body := range map[string]string{
		"null": "null", "array": "[]", "empty": "{}", "trailing": v.Body + "{}",
		"unknown field":          strings.TrimSuffix(v.Body, "}") + `,"other":true}`,
		"duplicate":              strings.Replace(v.Body, `"context":`, `"key_prefix":"00","context":`, 1),
		"context duplicate":      strings.Replace(v.Body, `"protocol":`, `"protocol":"zitadel_pow_poc_v1","protocol":`, 1),
		"context case alias":     strings.Replace(v.Body, `"profile_id"`, `"Profile_id"`, 1),
		"null context":           `{"context":null,"key_prefix":"00","key_mac":"00"}`,
		"missing context member": strings.Replace(v.Body, `"expires_at":1793631900,`, "", 1),
		"null expiry":            strings.Replace(v.Body, `"expires_at":1793631900`, `"expires_at":null`, 1),
		"float expiry":           strings.Replace(v.Body, `"expires_at":1793631900`, `"expires_at":1793631900.0`, 1),
		"negative expiry":        strings.Replace(v.Body, `"expires_at":1793631900`, `"expires_at":-1`, 1),
		"null project":           strings.Replace(v.Body, `"prj_vector"`, "null", 1),
		"unknown protocol":       strings.Replace(v.Body, Protocol, "zitadel_pow_poc_v2", 1),
		"uppercase salt":         strings.Replace(v.Body, v.Public.Salt, strings.ToUpper(v.Public.Salt), 1),
		"short nonce":            strings.Replace(v.Body, v.Public.Nonce, "00", 1),
		"null prefix":            strings.Replace(v.Body, `"`+v.Public.KeyPrefix+`"`, "null", 1),
		"short prefix":           strings.Replace(v.Body, v.Public.KeyPrefix, "00", 1),
	} {
		t.Run(name, func(t *testing.T) {
			bad := StoredChallenge{Body: []byte(body)}
			if err := Verify(bad, v.Proof, binding, keys, now); err == nil {
				t.Fatal("malformed authenticated storage accepted")
			}
		})
	}
	for _, field := range []string{"key_mac", "key_prefix"} {
		for _, raw := range []string{"null", "[]", `""`, `"00"`, `"` + strings.Repeat("F", 64) + `"`} {
			bad := replaceBody(t, stored, keys, func(body map[string]json.RawMessage) { body[field] = json.RawMessage(raw) })
			if err := Verify(bad, v.Proof, binding, keys, now); err == nil {
				t.Fatalf("invalid %s accepted: %s", field, raw)
			}
		}
	}
	// A correctly signed prefix substitution must fail even if the full-key MAC
	// remains valid, and vice versa. Both authenticators are mandatory.
	bad := replaceBody(t, stored, keys, func(body map[string]json.RawMessage) {
		body["key_prefix"] = json.RawMessage(`"` + strings.Repeat("0", 32) + `"`)
	})
	if err := Verify(bad, v.Proof, binding, keys, now); !errors.Is(err, ErrInvalidProof) {
		t.Fatalf("wrong prefix with correct solution MAC: %v", err)
	}
	// Reordering the context must not authenticate the solution.
	bad = replaceBody(t, stored, keys, func(body map[string]json.RawMessage) {
		var ctx map[string]json.RawMessage
		_ = json.Unmarshal(body["context"], &ctx)
		body["context"], _ = json.Marshal(ctx)
	})
	if err := Verify(bad, v.Proof, binding, keys, now); !errors.Is(err, ErrInvalidProof) {
		t.Fatalf("solution MAC must cover original context bytes: %v", err)
	}
}

func TestIssuerFailsBeforeKDF(t *testing.T) {
	t.Parallel()
	v := vectors(t)[0]
	binding, keys, _, now := v.inputs(t)
	for name, modify := range map[string]func(*Binding, *Keys){
		"missing operation": func(b *Binding, _ *Keys) { b.Operation = "" },
		"expired":           func(b *Binding, _ *Keys) { b.ExpiresAt = now.Unix() },
		"excessive TTL":     func(b *Binding, _ *Keys) { b.ExpiresAt++ },
		"future algorithm":  func(b *Binding, _ *Keys) { b.ProfileID = "argon2id_4096_l1" },
		"missing keys":      func(_ *Binding, k *Keys) { *k = Keys{} },
		"invalid UTF8":      func(b *Binding, _ *Keys) { b.ProjectID = string([]byte{0xff}) },
		"large ID":          func(b *Binding, _ *Keys) { b.ProjectID = strings.Repeat("a", 257) },
		"large body after escaping": func(b *Binding, _ *Keys) {
			b.ProjectID, b.Operation, b.OperationInstanceID = strings.Repeat("\x00", 256), strings.Repeat("\x00", 256), strings.Repeat("\x00", 256)
		},
	} {
		t.Run(name, func(t *testing.T) {
			b, k := binding, keys
			modify(&b, &k)
			deriver := new(spyDeriver)
			issued, err := (issuer{random: bytes.NewReader(make([]byte, 34)), deriver: deriver}).issue(b, k, now)
			if err == nil || deriver.calls != 0 || len(issued.Stored.Body) != 0 {
				t.Fatalf("invalid issuance performed work: error=%v calls=%d", err, deriver.calls)
			}
		})
	}
	for _, size := range []int{0, 15, 16, 31, 32, 33} {
		deriver := new(spyDeriver)
		_, err := (issuer{random: bytes.NewReader(make([]byte, size)), deriver: deriver}).issue(binding, keys, now)
		if err == nil || deriver.calls != 0 {
			t.Fatalf("entropy failure at %d bytes must not derive: %v", size, err)
		}
	}
	derivationFailure := errors.New("derivation unavailable")
	deriver := &spyDeriver{err: derivationFailure}
	_, err := (issuer{random: bytes.NewReader(make([]byte, 34)), deriver: deriver}).issue(binding, keys, now)
	if !errors.Is(err, derivationFailure) || deriver.calls != 1 {
		t.Fatalf("preserve issuer failure for server-fault mapping: %v", err)
	}
}

func TestIssueAndSolve(t *testing.T) {
	t.Parallel()
	binding, keys, _, now := vectors(t)[0].inputs(t)
	issued, err := Issue(binding, keys, now)
	if err != nil {
		t.Fatal(err)
	}
	p, _ := LookupProfile(issued.Public.ProfileID)
	var input [20]byte
	copy(input[:16], unhex(t, issued.Public.Nonce))
	salt := [16]byte(unhex(t, issued.Public.Salt))
	for counter := uint32(0); counter < p.MaxTrials(); counter++ {
		binary.BigEndian.PutUint32(input[16:], counter)
		key, err := pbkdf2Deriver{}.derive(p, input, salt)
		if err != nil {
			t.Fatal(err)
		}
		if hex.EncodeToString(key[:16]) != issued.Public.KeyPrefix {
			continue
		}
		proof := `{"protocol":"` + Protocol + `","challenge_id":"` + binding.ChallengeID + `","derived_key":"` + hex.EncodeToString(key[:]) + `"}`
		if err := Verify(issued.Stored, proof, binding, keys, now); err != nil {
			t.Fatalf("native solver could not verify: %v", err)
		}
		return
	}
	t.Fatal("issued challenge has no solution in its profile's search range")
}

func TestNoServerMaterialInProjection(t *testing.T) {
	t.Parallel()
	binding, keys, _, now := vectors(t)[0].inputs(t)
	issued, err := Issue(binding, keys, now)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(issued.Public)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := exactObject(data, "protocol", "challenge_id", "profile_id", "salt", "nonce", "key_prefix", "expires_at"); err != nil {
		t.Fatalf("unexpected public fields: %s", data)
	}
	for _, secret := range []string{binding.ProjectID, binding.OperationInstanceID,
		hex.EncodeToString(keys.Solution[:])} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatalf("public projection leaked server material: %s", data)
		}
	}
	if data, err := json.Marshal(issued.Stored); err != nil || string(data) != "{}" {
		t.Fatalf("stored challenge must not accidentally serialize to a client: %s %v", data, err)
	}
}

func FuzzParseProof(f *testing.F) {
	for _, v := range vectors(f) {
		f.Add(v.Proof)
	}
	for _, seed := range []string{"null", "{}", `{"Protocol":"zitadel_pow_poc_v1"}`, strings.Repeat("x", MaxProofBytes+1)} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		proof, err := ParseProof(input)
		if err == nil && (len(input) > MaxProofBytes || proof.ChallengeID == "") {
			t.Fatal("accepted invalid proof")
		}
	})
}

func FuzzVerifyStoredChallenge(f *testing.F) {
	v := vectors(f)[1]
	binding, keys, _, now := v.inputs(f)
	f.Add([]byte(v.Body), v.Proof)
	f.Add([]byte(`{"context":null,"key_prefix":null,"key_mac":null}`), "null")
	f.Fuzz(func(t *testing.T, body []byte, proof string) {
		if len(body) > MaxChallengeBytes+1 || len(proof) > MaxProofBytes+1 {
			return
		}
		// Mutate both stored data and the untrusted proof.
		stored := StoredChallenge{Body: body}
		err := Verify(stored, proof, binding, keys, now)
		if err == nil {
			parsed, parseErr := ParseProof(proof)
			if parseErr != nil || hex.EncodeToString(parsed.DerivedKey[:]) != v.DerivedKey {
				t.Fatal("authenticated a different solution")
			}
		}
	})
}
