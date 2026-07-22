package ogenx_test

import (
	"testing"
	"time"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/ogenx"
)

func TestParseISODuration(t *testing.T) {
	t.Parallel()

	got, err := ogenx.ParseISODuration("PT3H")
	require.NoError(t, err)
	require.Equal(t, 3*time.Hour, got)
}

func TestISODurationDecode(t *testing.T) {
	t.Parallel()

	var d ogenx.ISODuration
	dec := jx.DecodeStr(`"PT2H"`)
	require.NoError(t, d.Decode(dec))
	require.Equal(t, 2*time.Hour, d.Std())
}

func TestISODurationEncode(t *testing.T) {
	t.Parallel()

	d := ogenx.ISODuration(time.Duration(2 * time.Hour))
	encoder := jx.GetEncoder()
	defer jx.PutEncoder(encoder)

	d.Encode(encoder)
	require.Equal(t, `"PT2H"`, encoder.String())
}
