// Package sanctioned stands in for internal/httputil in tests: with
// -sanctioned=sanctioned nothing here is reported.
package sanctioned

import (
	"net"
	"net/http"
)

func build() *http.Client {
	d := &net.Dialer{}
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.DialContext = d.DialContext
	return &http.Client{Transport: t}
}
