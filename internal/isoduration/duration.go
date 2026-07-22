package isoduration

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/go-faster/jx"
)

var iso8601Duration = regexp.MustCompile(`^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$`)

// Duration is an ISO-8601 duration for JSON APIs (for example PT3H, P1D).
type Duration time.Duration

// From converts a standard library duration to an ISO-serializable duration.
func From(d time.Duration) Duration {
	return Duration(d)
}

// Std returns the underlying time.Duration for domain calculations.
func (d Duration) Std() time.Duration {
	return time.Duration(d)
}

func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(Format(d.Std()))
}

func (d *Duration) UnmarshalJSON(b []byte) error {
	var raw string
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	parsed, err := Parse(raw)
	if err != nil {
		return err
	}
	*d = parsed
	return nil
}

// Encode implements ogen/jx JSON encoding for request and response bodies.
func (d Duration) Encode(e *jx.Encoder) {
	e.Str(Format(d.Std()))
}

// Decode implements ogen/jx JSON decoding for request and response bodies.
func (d *Duration) Decode(dec *jx.Decoder) error {
	if d == nil {
		return fmt.Errorf("unable to decode Duration to nil")
	}
	raw, err := dec.Str()
	if err != nil {
		return err
	}
	parsed, err := Parse(raw)
	if err != nil {
		return err
	}
	*d = parsed
	return nil
}

// Parse parses an ISO-8601 duration string into a Duration.
func Parse(raw string) (Duration, error) {
	m := iso8601Duration.FindStringSubmatch(raw)
	if m == nil {
		return 0, fmt.Errorf("must be an ISO-8601 duration like PT3H")
	}
	if m[1] == "" && m[2] == "" && m[3] == "" && m[4] == "" {
		return 0, fmt.Errorf("duration must include at least one unit")
	}
	total := time.Duration(0)
	if m[1] != "" {
		days, err := strconv.ParseInt(m[1], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid day component")
		}
		total += time.Duration(days) * 24 * time.Hour
	}
	if m[2] != "" {
		hours, err := strconv.ParseInt(m[2], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid hour component")
		}
		total += time.Duration(hours) * time.Hour
	}
	if m[3] != "" {
		minutes, err := strconv.ParseInt(m[3], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid minute component")
		}
		total += time.Duration(minutes) * time.Minute
	}
	if m[4] != "" {
		seconds, err := strconv.ParseFloat(m[4], 64)
		if err != nil {
			return 0, fmt.Errorf("invalid second component")
		}
		total += time.Duration(seconds * float64(time.Second))
	}
	return Duration(total), nil
}

// Format renders d as an ISO-8601 duration string.
func Format(d time.Duration) string {
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
