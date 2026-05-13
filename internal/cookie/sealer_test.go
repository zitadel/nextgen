package cookie

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

func filledKey(fill byte) Key {
	var k Key
	for i := range k {
		k[i] = fill
	}
	return k
}

func newSealer(t *testing.T, maxAge time.Duration) *Sealer {
	t.Helper()
	s, err := NewSealer(filledKey(0xAA), maxAge)
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}
	return s
}

// SetNow replaces the sealer's clock for tests. The production
// constructor does not expose this seam.
func SetNow(s *Sealer, now func() time.Time) {
	s.now = now
}

func TestSealer_Roundtrip(t *testing.T) {
	s := newSealer(t, 10*time.Minute)
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

func TestSealer_RoundtripEmptyPayload(t *testing.T) {
	s := newSealer(t, 10*time.Minute)
	value, err := s.Seal(nil)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	got, err := s.Open(value)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("Open returned %d bytes, want 0", len(got))
	}
}

func TestSealer_RejectsTamperedCiphertext(t *testing.T) {
	s := newSealer(t, 10*time.Minute)
	value, err := s.Seal([]byte("hello"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	// JWE compact is `header.cek.iv.ct.tag`. Flip a byte inside the
	// tag (last segment) so GCM authentication fails.
	tampered := flipLastByte(value)

	if _, err := s.Open(tampered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Open tampered: err = %v, want ErrInvalid", err)
	}
}

func TestSealer_RejectsForeignKey(t *testing.T) {
	// A value sealed with a different key must not decrypt — GCM auth
	// fails and Open returns ErrInvalid.
	foreign, err := NewSealer(filledKey(0xCC), 10*time.Minute)
	if err != nil {
		t.Fatalf("NewSealer (foreign): %v", err)
	}
	value, err := foreign.Seal([]byte("hello"))
	if err != nil {
		t.Fatalf("Seal (foreign): %v", err)
	}

	s := newSealer(t, 10*time.Minute)
	if _, err := s.Open(value); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Open foreign-key value: err = %v, want ErrInvalid", err)
	}
}

func TestSealer_RejectsExpired(t *testing.T) {
	s := newSealer(t, time.Minute)

	value, err := s.Seal([]byte("hello"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	SetNow(s, func() time.Time {
		return time.Now().Add(2 * time.Minute)
	})

	if _, err := s.Open(value); !errors.Is(err, ErrExpired) {
		t.Fatalf("Open expired: err = %v, want ErrExpired", err)
	}
}

func TestSealer_RejectsMalformedInput(t *testing.T) {
	s := newSealer(t, 10*time.Minute)

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

func TestNewSealer_RejectsZeroMaxAge(t *testing.T) {
	if _, err := NewSealer(filledKey(0xAA), 0); err == nil {
		t.Fatalf("expected error for max-age=0")
	}
}

// flipLastByte returns value with its final character changed. For a
// JWE compact serialization the final segment is the GCM tag, so this
// guarantees authentication failure on Decrypt.
func flipLastByte(value string) string {
	if value == "" {
		return value
	}
	b := []byte(value)
	last := b[len(b)-1]
	if last == 'A' {
		b[len(b)-1] = 'B'
	} else {
		b[len(b)-1] = 'A'
	}
	return string(b)
}
