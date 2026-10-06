package harness

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
)

// CountSeries returns how many distinct time series a k6 JSON sample file
// (--out json, gzipped, as `sweep --raw` writes it) holds: distinct metric
// names crossed with distinct tag sets. The count is what a cardinality
// explosion shows up in, so it is the number the smoke lane bounds.
func CountSeries(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", path, err)
	}
	defer zr.Close()

	series := map[string]struct{}{}
	sc := bufio.NewScanner(zr)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		var line struct {
			Type   string `json:"type"`
			Metric string `json:"metric"`
			Data   struct {
				Tags map[string]string `json:"tags"`
			} `json:"data"`
		}
		if err := json.Unmarshal(sc.Bytes(), &line); err != nil {
			return 0, fmt.Errorf("%s: %w", path, err)
		}
		if line.Type != "Point" {
			continue
		}
		keys := make([]string, 0, len(line.Data.Tags))
		for k := range line.Data.Tags {
			keys = append(keys, k)
		}
		slices.Sort(keys)
		var b strings.Builder
		b.WriteString(line.Metric)
		for _, k := range keys {
			b.WriteByte('\x00')
			b.WriteString(k)
			b.WriteByte('=')
			b.WriteString(line.Data.Tags[k])
		}
		series[b.String()] = struct{}{}
	}
	return len(series), sc.Err()
}
