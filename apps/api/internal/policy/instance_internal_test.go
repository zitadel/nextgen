package policy

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNumberExponentInRange(t *testing.T) {
	for text, want := range map[string]bool{
		"12":       true,
		"1.2e1":    true,
		"1E20":     true,
		"1e-20":    true,
		"1e21":     false,
		"1e-21":    false,
		"1e999999": false,
		"1e+5":     true,
		"1e":       false,
	} {
		assert.Equal(t, want, numberExponentInRange(text), text)
	}
}

func TestToInt64_JSONNumber(t *testing.T) {
	for text, want := range map[string]int64{
		"12":                       12,
		"12.0":                     12,
		"1.2e1":                    12,
		"9223372036854775807.000":  9223372036854775807,
		"-9223372036854775808.000": -9223372036854775808,
	} {
		got, ok := toInt64(json.Number(text))
		assert.True(t, ok, text)
		assert.Equal(t, want, got, text)
	}
	for _, text := range []string{"0.99999999999999999", "9223372036854775808", "1e999999", "1e-999999", "12.5"} {
		_, ok := toInt64(json.Number(text))
		assert.False(t, ok, text)
	}
}
