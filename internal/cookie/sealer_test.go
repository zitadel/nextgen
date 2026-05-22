package cookie

import (
	"bytes"
	"crypto/rand"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func generateKey(t *testing.T) Key {
	bs := make([]byte, KeySize)
	_, err := rand.Read(bs)
	require.NoError(t, err)
	return Key(bs)
}

func newSealer(t *testing.T) *Sealer {
	t.Helper()
	s, err := NewSealer(generateKey(t))
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}
	return s
}

func TestSealer_Roundtrip(t *testing.T) {
	s := newSealer(t)
	payload := []byte(`{"session_id":"sess_123","current_step":"identify"}`)

	value, err := s.Seal(payload)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	got, err := s.Open(value)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("Open returned %q, want %q", got, payload)
	}
}

func TestSealer_RejectsTamperedCiphertext(t *testing.T) {
	s := newSealer(t)
	input := "hello"
	value, err := s.Seal([]byte(input))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	// JWE compact is `header.cek.iv.ct.tag`. Tampering the tag
	// (last segment) so GCM authentication fails.
	tampered := tamperTag(value)

	if decoded, err := s.Open(tampered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Open tampered: err = %v, want ErrInvalid (input: %s, sealed: %s, tampered: %s, decoded: %s)", err, input, value, tampered, decoded)
	}
}

func TestSealer_RejectsForeignKey(t *testing.T) {
	// A value sealed with a different key must not decrypt — GCM auth
	// fails and Open returns ErrInvalid.
	foreign, err := NewSealer(generateKey(t))
	if err != nil {
		t.Fatalf("NewSealer (foreign): %v", err)
	}
	value, err := foreign.Seal([]byte("hello"))
	if err != nil {
		t.Fatalf("Seal (foreign): %v", err)
	}

	s := newSealer(t)
	if _, err := s.Open(value); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Open foreign-key value: err = %v, want ErrInvalid", err)
	}
}

func TestSealer_RejectsMalformedInput(t *testing.T) {
	s := newSealer(t)

	cases := map[string]string{
		"empty":               "",
		"not a JWE":           "not-a-jwe",
		"wrong segment count": "aaa.bbb.ccc",
		"garbage segments":    "AAA.BBB.CCC.DDD.EEE",
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := s.Open(value); !errors.Is(err, ErrInvalid) {
				t.Fatalf("Open %q: err = %v, want ErrInvalid", name, err)
			}
		})
	}
}

// tamperTag flips the first character of the authentication-tag segment
// (the last dot-separated part of a JWE compact serialisation).
func tamperTag(value string) string {
	dot := strings.LastIndex(value, ".")
	if dot < 0 || dot+1 >= len(value) {
		return value
	}
	b := []byte(value)
	if b[dot+1] == 'A' {
		b[dot+1] = 'B'
	} else {
		b[dot+1] = 'A'
	}
	return string(b)
}
