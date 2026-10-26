package ogenx

import (
	"math"
	"testing"
	"time"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
)

func TestParseISODuration(t *testing.T) {
	for _, tt := range []struct {
		name    string
		raw     string
		want    time.Duration
		wantErr bool
	}{
		{name: "hours", raw: "PT3H", want: 3 * time.Hour},
		{name: "minutes", raw: "PT45M", want: 45 * time.Minute},
		{name: "composite", raw: "P1DT2H3M4S", want: 24*time.Hour + 2*time.Hour + 3*time.Minute + 4*time.Second},
		{name: "fractional seconds", raw: "PT1.5S", want: 1500 * time.Millisecond},
		{name: "sub-nanosecond fraction", raw: "PT0.0000000004S", want: 0},
		{name: "largest duration", raw: "PT9223372036.854775807S", want: time.Duration(math.MaxInt64)},
		{name: "invalid", raw: "3h", wantErr: true},
		{name: "empty payload", raw: "P", wantErr: true},
		{name: "days past the largest duration", raw: "P200000D", wantErr: true},
		{name: "sum past the largest duration", raw: "P106751DT24H", wantErr: true},
		{name: "seconds past the largest duration", raw: "PT9999999999S", wantErr: true},
		{name: "one nanosecond past the largest duration", raw: "PT9223372036.854775808S", wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseISODuration(tt.raw)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestISODurationDecode(t *testing.T) {
	var d ISODuration
	dec := jx.DecodeStr(`"PT2H"`)
	require.NoError(t, d.Decode(dec))
	require.EqualValues(t, 2*time.Hour, d)
}

func TestISODurationEncode(t *testing.T) {
	var d = ISODuration(2 * time.Hour)
	encoder := jx.GetEncoder()
	defer jx.PutEncoder(encoder)

	d.Encode(encoder)
	require.Equal(t, `"PT2H"`, encoder.String())
}
