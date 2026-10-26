package ogenx

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-faster/jx"
)

var iso8601Duration = regexp.MustCompile(`^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$`)

// ISODuration is an ogen-compatible JSON type for ISO-8601 durations.
type ISODuration time.Duration

func (d ISODuration) Encode(e *jx.Encoder) {
	e.Str(formatISODuration(time.Duration(d)))
}

func (d *ISODuration) Decode(dec *jx.Decoder) error {
	if d == nil {
		return fmt.Errorf("unable to decode ISODuration to nil")
	}
	raw, err := dec.Str()
	if err != nil {
		return err
	}
	parsed, err := ParseISODuration(raw)
	if err != nil {
		return err
	}
	*d = ISODuration(parsed)
	return nil
}

func ParseISODuration(raw string) (time.Duration, error) {
	m := iso8601Duration.FindStringSubmatch(raw)
	if m == nil {
		return 0, fmt.Errorf("must be an ISO-8601 duration like PT3H")
	}
	if m[1] == "" && m[2] == "" && m[3] == "" && m[4] == "" {
		return 0, fmt.Errorf("duration must include at least one unit")
	}
	total := time.Duration(0)
	for i, unit := range []struct {
		name string
		size time.Duration
	}{{"day", 24 * time.Hour}, {"hour", time.Hour}, {"minute", time.Minute}} {
		if m[i+1] == "" {
			continue
		}
		count, err := strconv.ParseInt(m[i+1], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid %s component", unit.name)
		}
		next, ok := addScaled(total, count, unit.size)
		if !ok {
			return 0, fmt.Errorf("invalid %s component", unit.name)
		}
		total = next
	}
	if m[4] != "" {
		next, err := addSeconds(total, m[4])
		if err != nil {
			return 0, err
		}
		total = next
	}
	return total, nil
}

// addScaled adds count*unit to total. It refuses a count, a product, or a sum
// that does not fit in a time.Duration.
func addScaled(total time.Duration, count int64, unit time.Duration) (time.Duration, bool) {
	if count < 0 || unit <= 0 || count > int64(math.MaxInt64/unit) {
		return 0, false
	}
	extra := time.Duration(count) * unit
	if total > math.MaxInt64-extra {
		return 0, false
	}
	return total + extra, true
}

// addSeconds adds an ISO-8601 seconds component. Fractional digits are scaled
// to nanoseconds; digits past the ninth are dropped.
func addSeconds(total time.Duration, raw string) (time.Duration, error) {
	whole, frac, _ := strings.Cut(raw, ".")
	seconds, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid second component")
	}
	total, ok := addScaled(total, seconds, time.Second)
	if !ok {
		return 0, fmt.Errorf("invalid second component")
	}
	if frac == "" {
		return total, nil
	}
	if len(frac) > 9 {
		frac = frac[:9]
	} else {
		frac += strings.Repeat("0", 9-len(frac))
	}
	nanos, err := strconv.ParseInt(frac, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid second component")
	}
	total, ok = addScaled(total, nanos, time.Nanosecond)
	if !ok {
		return 0, fmt.Errorf("invalid second component")
	}
	return total, nil
}

func formatISODuration(d time.Duration) string {
	if d < 0 {
		return "PT0S"
	}
	if d == 0 {
		return "PT0S"
	}
	seconds := d / time.Second
	days := seconds / (24 * 3600)
	seconds -= days * 24 * 3600
	hours := seconds / 3600
	seconds -= hours * 3600
	minutes := seconds / 60
	seconds -= minutes * 60

	out := "P"
	if days > 0 {
		out += fmt.Sprintf("%dD", days)
	}
	if hours > 0 || minutes > 0 || seconds > 0 {
		out += "T"
		if hours > 0 {
			out += fmt.Sprintf("%dH", hours)
		}
		if minutes > 0 {
			out += fmt.Sprintf("%dM", minutes)
		}
		if seconds > 0 {
			out += fmt.Sprintf("%dS", seconds)
		}
	}
	return out
}
