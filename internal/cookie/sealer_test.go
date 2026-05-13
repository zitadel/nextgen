package cookie

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

func key(version byte, fill byte) Key {
	k := Key{Version: version}
	for i := range k.Bytes {
		k.Bytes[i] = fill
	}
	return k
}

func newSealer(t *testing.T, previous *Key, maxAge time.Duration) *Sealer {
	t.Helper()
	s, err := NewSealer(key(1, 0xAA), previous, maxAge)
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
	s := newSealer(t, nil, 10*time.Minute)
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
	s := newSealer(t, nil, 10*time.Minute)
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
	s := newSealer(t, nil, 10*time.Minute)
	value, err := s.Seal([]byte("hello"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	raw[len(raw)-5] ^= 0x01
	tampered := base64.RawURLEncoding.EncodeToString(raw)

	if _, err := s.Open(tampered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Open tampered: err = %v, want ErrInvalid", err)
	}
}

func TestSealer_RejectsSwappedVersionByte(t *testing.T) {
	s := newSealer(t, nil, 10*time.Minute)
	value, err := s.Seal([]byte("hello"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	raw[0] = 0xFF
	tampered := base64.RawURLEncoding.EncodeToString(raw)

	if _, err := s.Open(tampered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Open unknown version: err = %v, want ErrInvalid", err)
	}
}

func TestSealer_RejectsExpired(t *testing.T) {
	s := newSealer(t, nil, time.Minute)

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

func TestSealer_OpensWithPreviousKey(t *testing.T) {
	// Pre-rotation sealer holds v=1; after rotation v=2 is current and v=1
	// is the previous key. Values issued by the old sealer must still open.
	oldCurrent := key(1, 0xAA)
	oldSealer, err := NewSealer(oldCurrent, nil, 10*time.Minute)
	if err != nil {
		t.Fatalf("NewSealer (old): %v", err)
	}
	value, err := oldSealer.Seal([]byte("hello"))
	if err != nil {
		t.Fatalf("Seal (old): %v", err)
	}

	newCurrent := key(2, 0xBB)
	prev := oldCurrent
	newSealer, err := NewSealer(newCurrent, &prev, 10*time.Minute)
	if err != nil {
		t.Fatalf("NewSealer (new): %v", err)
	}

	got, err := newSealer.Open(value)
	if err != nil {
		t.Fatalf("Open after rotation: %v", err)
	}
	if string(got) != "hello" {
		t.Fatalf("Open after rotation: got %q, want %q", got, "hello")
	}
}

func TestSealer_SealAlwaysUsesCurrentKey(t *testing.T) {
	prev := key(1, 0xAA)
	s, err := NewSealer(key(2, 0xBB), &prev, 10*time.Minute)
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	value, err := s.Seal([]byte("hello"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	if raw[0] != 2 {
		t.Fatalf("Seal used version byte %d, want 2 (current)", raw[0])
	}
}

func TestSealer_RejectsMalformedInput(t *testing.T) {
	s := newSealer(t, nil, 10*time.Minute)

	cases := map[string]string{
		"not base64":  "!!!not-base64!!!",
		"empty":       "",
		"too short":   base64.RawURLEncoding.EncodeToString([]byte{1, 2, 3}),
		"only header": base64.RawURLEncoding.EncodeToString(append([]byte{1}, make([]byte, 12)...)),
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := s.Open(value); !errors.Is(err, ErrInvalid) {
				t.Fatalf("Open %q: err = %v, want ErrInvalid", name, err)
			}
		})
	}
}

func TestNewSealer_RejectsInvalidConfig(t *testing.T) {
	current := key(1, 0xAA)
	t.Run("zero max-age", func(t *testing.T) {
		if _, err := NewSealer(current, nil, 0); err == nil {
			t.Fatalf("expected error for max-age=0")
		}
	})
	t.Run("previous version collides with current", func(t *testing.T) {
		prev := key(1, 0xBB)
		_, err := NewSealer(current, &prev, time.Minute)
		if err == nil || !strings.Contains(err.Error(), "version") {
			t.Fatalf("expected version-collision error, got %v", err)
		}
	})
}
