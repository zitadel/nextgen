package main

import (
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestMatchedProfileInteroperabilityAndBinding(t *testing.T) {
	for _, p := range matchedProfiles() {
		if p.Level != 1 {
			continue
		}
		t.Run(p.ID, func(t *testing.T) {
			expires := time.Now().Add(time.Minute)
			library, err := libraryKDFIssue(p, expires, 1)
			if err != nil {
				t.Fatal(err)
			}
			salt, _ := hex.DecodeString(library.Parameters.Salt)
			nonce, _ := hex.DecodeString(library.Parameters.Nonce)
			own, err := ownKDFIssue(p, expires, 1, salt, nonce)
			if err != nil {
				t.Fatal(err)
			}
			op, on, err := ownKDFSolve(p, own)
			if err != nil {
				t.Fatal(err)
			}
			lp, ln, err := libraryKDFSolve(p, library)
			if err != nil {
				t.Fatal(err)
			}
			if on != 1 || ln != 1 || op != lp {
				t.Fatal("KDF framing differs")
			}
			if err := ownKDFVerify(p, own, lp, fixtureScope, time.Now()); err != nil {
				t.Fatal(err)
			}
			if err := libraryKDFVerify(p, library, op); err != nil {
				t.Fatal(err)
			}
			higher := findProfile(p.Family + "_l2")
			if ownKDFVerify(higher, own, op, fixtureScope, time.Now()) == nil || libraryKDFVerify(higher, library, lp) == nil {
				t.Fatal("lower-level proof accepted")
			}
			scope := fixtureScope
			scope.Generation++
			if ownKDFVerify(p, own, op, scope, time.Now()) == nil {
				t.Fatal("old generation accepted")
			}
			scope = fixtureScope
			scope.Project = "other"
			if ownKDFVerify(p, own, op, scope, time.Now()) == nil {
				t.Fatal("other project accepted")
			}
			if ownKDFVerify(p, own, op, fixtureScope, expires) == nil {
				t.Fatal("expired proof accepted")
			}
			for _, bad := range []string{"", strings.Repeat("0", 64), op.Key[:32], strings.ToUpper(op.Key), op.Key + "00"} {
				if ownKDFVerify(p, own, KDFProof{bad}, fixtureScope, time.Now()) == nil || libraryKDFVerify(p, library, KDFProof{bad}) == nil {
					t.Fatal("malformed or invalid key accepted")
				}
			}
			tampered := own
			tampered.Body.Context.Nonce = strings.Repeat("0", 32)
			if ownKDFVerify(p, tampered, op, fixtureScope, time.Now()) == nil {
				t.Fatal("unauthenticated nonce accepted")
			}
			tampered = own
			tampered.Body.Context.Expires++
			if ownKDFVerify(p, tampered, op, fixtureScope, time.Now()) == nil {
				t.Fatal("unauthenticated expiry accepted")
			}
			broken := library
			broken.Parameters.KeySignature = ""
			if libraryKDFVerify(p, broken, lp) == nil {
				t.Fatal("missing fast-path signature accepted")
			}
		})
	}
}
func TestMatchedProfileRanges(t *testing.T) {
	for _, p := range matchedProfiles() {
		if p.Level > 1 {
			previous := findProfile(fmt.Sprintf("%s_l%d", p.Family, p.Level-1))
			if p.Trials != 2*previous.Trials || p.Cost != previous.Cost || p.MemoryKiB != previous.MemoryKiB {
				t.Fatal("level changes server KDF cost")
			}
		}
	}
}

func TestMatchedProofDecoder(t *testing.T) {
	valid := `{"derived_key":"` + strings.Repeat("ab", 32) + `"}`
	if _, err := decodeMatchedProof([]byte(valid)); err != nil {
		t.Fatal(err)
	}
	for _, b := range []string{
		`null`, `{}`, `[]`, `{"derived_key":null}`, `{"derived_key":12}`,
		strings.Replace(valid, "derived_key", "DERIVED_KEY", 1),
		strings.Replace(valid, "}", `,"DERIVED_KEY":"00"}`, 1),
		strings.Replace(valid, "}", `,"derived_key":"00"}`, 1),
		strings.Replace(valid, "}", `,"counter":0}`, 1),
		strings.Replace(valid, "ab", "AB", 1), valid + `{}`, strings.Repeat(" ", 2048) + valid,
	} {
		if _, err := decodeMatchedProof([]byte(b)); err == nil {
			t.Fatalf("accepted malformed proof: %q", b)
		}
	}
}
func FuzzMatchedProofDecoder(f *testing.F) {
	f.Add([]byte(`{"derived_key":"00"}`))
	f.Add([]byte(`{"derived_key":"00","derived_key":"ff"}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		if len(b) > 2048 {
			return
		}
		_, _ = decodeMatchedProof(b)
	})
}
