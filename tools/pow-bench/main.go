package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go/v2"
)

type Sample struct {
	Challenge json.RawMessage `json:"challenge"`
	Proof     json.RawMessage `json:"proof"`
	NativeMS  float64         `json:"native_ms"`
}
type Measurement struct {
	NS     float64 `json:"ns_per_op"`
	Bytes  float64 `json:"bytes_per_op"`
	Allocs float64 `json:"allocs_per_op"`
	N      int     `json:"n"`
}
type Group struct {
	Candidate Candidate              `json:"candidate"`
	Samples   []Sample               `json:"samples"`
	Server    map[string]Measurement `json:"server"`
}
type Corpus struct {
	Created string  `json:"created_at"`
	Go      string  `json:"go"`
	OS      string  `json:"os"`
	Arch    string  `json:"arch"`
	Groups  []Group `json:"groups"`
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func wire(value any) json.RawMessage { b, err := json.Marshal(value); must(err); return b }
func write(path string, v any) {
	b, err := json.MarshalIndent(v, "", "  ")
	must(err)
	must(os.WriteFile(path, append(b, '\n'), 0644))
}
func measure(n int, f func()) Measurement {
	for i := 0; i < 20; i++ {
		f()
	}
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	start := time.Now()
	for i := 0; i < n; i++ {
		f()
	}
	elapsed := time.Since(start)
	runtime.ReadMemStats(&after)
	return Measurement{float64(elapsed.Nanoseconds()) / float64(n), float64(after.TotalAlloc-before.TotalAlloc) / float64(n), float64(after.Mallocs-before.Mallocs) / float64(n), n}
}
func decode(c Candidate, ch, p json.RawMessage) (any, any) {
	if c.Own {
		var a OwnChallenge
		var b OwnProof
		must(strictJSON(ch, &a))
		must(strictJSON(p, &b))
		return a, b
	}
	var a altcha.Challenge
	var b altcha.Solution
	must(strictJSON(ch, &a))
	must(strictJSON(p, &b))
	return a, b
}
func main() {
	suite := flag.String("suite", "original", "original or matched")
	memoryProfile := flag.String("memory-profile", "", "Matched profile for isolated concurrent issuance")
	implementation := flag.String("implementation", "own", "own or altcha")
	concurrency := flag.Int("concurrency", 1, "Concurrent issuers for memory probe")
	samples := flag.Int("samples", 32, "Challenges per candidate")
	out := flag.String("out", "dist", "Output directory")
	verify := flag.String("verify", "", "Browser proof file to verify against corpus")
	flag.Parse()
	must(os.MkdirAll(*out, 0755))
	if *suite == "matched" {
		matchedMain(*samples, *out, *verify, *memoryProfile, *implementation, *concurrency)
		return
	}
	if *verify != "" {
		var corpus Corpus
		b, err := os.ReadFile(filepath.Join(*out, "corpus.json"))
		must(err)
		must(json.Unmarshal(b, &corpus))
		var rows []struct {
			Candidate string          `json:"candidate"`
			Index     int             `json:"index"`
			Proof     json.RawMessage `json:"proof"`
		}
		b, err = os.ReadFile(*verify)
		must(err)
		must(json.Unmarshal(b, &rows))
		for _, r := range rows {
			found := false
			for _, g := range corpus.Groups {
				if r.Candidate != g.Candidate.Name {
					continue
				}
				found = true
				ch, p := decode(g.Candidate, g.Samples[r.Index].Challenge, r.Proof)
				must(g.Candidate.verify(ch, p))
			}
			if !found {
				panic("unknown candidate")
			}
		}
		fmt.Printf("Verified %d browser proofs in Go\n", len(rows))
		return
	}
	corpus := Corpus{Created: time.Now().UTC().Format(time.RFC3339), Go: runtime.Version(), OS: runtime.GOOS, Arch: runtime.GOARCH}
	// A day is only for a repeatable benchmark run. Product TTL is much shorter.
	expires := time.Now().Add(24 * time.Hour)
	for _, c := range candidates {
		g := Group{Candidate: c, Server: map[string]Measurement{}}
		for i := 0; i < *samples; i++ {
			ch, err := c.issue(expires)
			must(err)
			start := time.Now()
			p, err := c.solve(ch)
			must(err)
			ms := float64(time.Since(start).Nanoseconds()) / 1e6
			must(c.verify(ch, p))
			g.Samples = append(g.Samples, Sample{wire(ch), wire(p), ms})
		}
		ch, p := decode(c, g.Samples[0].Challenge, g.Samples[0].Proof)
		g.Server["issue"] = measure(1000, func() { _, err := c.issue(expires); must(err) })
		g.Server["verify_valid"] = measure(1000, func() { must(c.verify(ch, p)) })
		g.Server["decode_and_verify"] = measure(1000, func() { a, b := decode(c, g.Samples[0].Challenge, g.Samples[0].Proof); must(c.verify(a, b)) })
		badP := p
		if c.Own {
			badP = OwnProof{"18446744073709551615"}
		} else {
			x := p.(altcha.Solution)
			x.Counter++
			x.DerivedKey = "0000000000000000000000000000000000000000000000000000000000000000"
			badP = x
		}
		g.Server["verify_bad_work"] = measure(1000, func() {
			if c.verify(ch, badP) == nil {
				panic("bad work accepted")
			}
		})
		badCh := ch
		if c.Own {
			x := ch.(OwnChallenge)
			x.Ticket = x.Ticket[:len(x.Ticket)-10] + "AAAAAAAAAA"
			badCh = x
		} else {
			x := ch.(altcha.Challenge)
			x.Signature = "00"
			badCh = x
		}
		g.Server["verify_bad_signature"] = measure(1000, func() {
			if c.verify(badCh, p) == nil {
				panic("bad signature accepted")
			}
		})
		corpus.Groups = append(corpus.Groups, g)
		fmt.Printf("Native + server: %s (%d samples)\n", c.Name, *samples)
	}
	write(filepath.Join(*out, "corpus.json"), corpus)
}
