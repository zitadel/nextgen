package spike

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptrace"
	"strconv"

	"go.k6.io/k6/v2/lib"
	"go.k6.io/k6/v2/lib/netext/httpext"
	"go.k6.io/k6/v2/metrics"
)

// ownedDoer is the "module owns the HTTP path" shape. The generated client
// builds the request; this Do performs it over a Go transport, attaches k6's
// own httpext.Tracer through net/http/httptrace, reads the body to completion
// (k6 measures receiving up to EOF, so the trail must close after the read)
// and emits the module's nextgen_req_* samples on the VU's sample channel.
type ownedDoer struct {
	m  *ModuleInstance
	st *lib.State
}

func (d *ownedDoer) transport() http.RoundTripper {
	if d.m.root.cfg.OwnedTransport == "shared" {
		return d.m.root.shared
	}
	return d.st.Transport
}

func (d *ownedDoer) Do(r *http.Request) (*http.Response, error) {
	op := opFrom(r)
	r.Header.Set("Origin", d.m.root.cfg.Origin)

	tracer := new(httpext.Tracer)
	r = r.WithContext(httptrace.WithClientTrace(r.Context(), tracer.Trace()))

	resp, err := d.transport().RoundTrip(r)
	if err != nil {
		d.emit(tracer.Done(), op, 0, true)
		return nil, err
	}
	body, readErr := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	trail := tracer.Done()
	if readErr != nil {
		d.emit(trail, op, resp.StatusCode, true)
		return nil, readErr
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	d.emit(trail, op, resp.StatusCode, resp.StatusCode >= 400)
	return resp, nil
}

// emit mirrors httpext.Trail.SaveSamples under the module's own metric names
// and a bounded tag set: op, shape, status. No URL, no name.
func (d *ownedDoer) emit(trail *httpext.Trail, op string, status int, failed bool) {
	om := d.m.root.metrics
	tm := d.st.Tags.GetCurrentValues()
	tm.SetTag("op", op)
	tm.SetTag("shape", "owned")
	tm.SetTag("status", strconv.Itoa(status))

	sample := func(m *metrics.Metric, v float64) metrics.Sample {
		return metrics.Sample{
			TimeSeries: metrics.TimeSeries{Metric: m, Tags: tm.Tags},
			Time:       trail.EndTime,
			Metadata:   tm.Metadata,
			Value:      v,
		}
	}
	b2f := func(b bool) float64 {
		if b {
			return 1
		}
		return 0
	}
	metrics.PushIfNotDone(d.m.vu.Context(), d.st.Samples, metrics.Samples{
		sample(om.reqs, 1),
		sample(om.duration, metrics.D(trail.Duration)),
		sample(om.blocked, metrics.D(trail.Blocked)),
		sample(om.connecting, metrics.D(trail.Connecting)),
		sample(om.sending, metrics.D(trail.Sending)),
		sample(om.waiting, metrics.D(trail.Waiting)),
		sample(om.receiving, metrics.D(trail.Receiving)),
		sample(om.failed, b2f(failed)),
		sample(om.connReused, b2f(trail.ConnReused)),
	})
}
