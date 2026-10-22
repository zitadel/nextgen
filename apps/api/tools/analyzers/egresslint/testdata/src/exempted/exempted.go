package exempted

import (
	"net/http"
	"time"
)

type sink struct {
	client *http.Client
}

func newSink() *sink {
	return &sink{
		// Operator-configured URL, not user-injectable: stdlib client by design (ADR 061).
		//egress:allow operator-configured sink, not user-injectable
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func trailing() *http.Client {
	return &http.Client{} //egress:allow health probe against our own listener
}

func directiveOnlyCoversItsLine() {
	//egress:allow covers the next line only
	_ = &http.Client{}
	_ = &http.Client{} // want `constructs an http.Client outside the hardened egress package`
}
