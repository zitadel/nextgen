package isoduration_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/isoduration"
)

func TestParse(t *testing.T) {
	t.Parallel()

	for _, tt := range []struct {
		name    string
		raw     string
		want    time.Duration
		wantErr bool
	}{
		{name: "hours", raw: "PT3H", want: 3 * time.Hour},
		{name: "minutes", raw: "PT45M", want: 45 * time.Minute},
		{name: "composite", raw: "P1DT2H3M4S", want: 24*time.Hour + 2*time.Hour + 3*time.Minute + 4*time.Second},
		{name: "invalid", raw: "3h", wantErr: true},
		{name: "empty payload", raw: "P", wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := isoduration.Parse(tt.raw)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, got.Std())
		})
	}
}

func TestFormat(t *testing.T) {
	t.Parallel()
	require.Equal(t, "PT2H", isoduration.Format(2*time.Hour))
	require.Equal(t, "PT0S", isoduration.Format(0))
	require.Equal(t, "P1D", isoduration.Format(24*time.Hour))
}

func TestDurationMarshalJSON(t *testing.T) {
	t.Parallel()

	b, err := json.Marshal(isoduration.From(2 * time.Hour))
	require.NoError(t, err)
	require.Equal(t, `"PT2H"`, string(b))
}

func TestDurationDecodeEncode(t *testing.T) {
	t.Parallel()

	var d isoduration.Duration
	dec := jx.DecodeStr(`"PT2H"`)
	require.NoError(t, d.Decode(dec))
	require.Equal(t, 2*time.Hour, d.Std())

	encoder := jx.GetEncoder()
	defer jx.PutEncoder(encoder)
	d.Encode(encoder)
	require.Equal(t, `"PT2H"`, encoder.String())
}
