package violations

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"syscall"
	"time"

	"github.com/go-resty/resty/v2" // want `imports third-party dialing library "github.com/go-resty/resty/v2"`
	"google.golang.org/grpc"       // want `imports third-party dialing library "google.golang.org/grpc"`
	"google.golang.org/grpc/codes" // subpackage: inspecting status codes does not dial
)

type wrapper struct {
	client *http.Client // pointer field: fine, needs a construction elsewhere
}

type aliasClient = http.Client

type definedClient http.Client // want `constructs an http.Client as the underlying type of definedClient`

type byValue struct {
	http.Client             // want `constructs an http.Client as a by-value struct field`
	inner       http.Client // want `constructs an http.Client as a by-value struct field`
	d           net.Dialer  // want `constructs a net.Dialer as a by-value struct field`
	t           *http.Transport
}

func zero[T any]() *T { return new(T) }

func indirections() {
	_ = &aliasClient{} // want `constructs an http.Client outside the hardened egress package`
	var c definedClient
	_ = (*http.Client)(&c)   // want `constructs an http.Client by conversion`
	_ = zero[http.Client]()  // want `constructs an http.Client as a generic type argument`
	_ = zero[net.Dialer]()   // want `constructs a net.Dialer as a generic type argument`
	_ = zero[*http.Client]() // pointer type argument: nothing is constructed
}

func literals() {
	_ = &http.Client{Timeout: time.Second} // want `constructs an http.Client outside the hardened egress package`
	_ = http.Client{}                      // want `constructs an http.Client outside the hardened egress package`
	_ = &http.Transport{}                  // want `constructs an http.Transport outside the hardened egress package`
	_ = &net.Dialer{Timeout: time.Second}  // want `constructs a net.Dialer outside the hardened egress package`
	_ = &tls.Dialer{}                      // want `constructs a tls.Dialer outside the hardened egress package`
	_ = wrapper{client: &http.Client{}}    // want `constructs an http.Client outside the hardened egress package`
}

func viaNew() {
	_ = new(http.Client)                 // want `constructs an http.Client via new\(\)`
	_ = new(http.Transport)              // want `constructs an http.Transport via new\(\)`
	_ = make([]http.Client, 1)           // want `constructs an http.Client via make\(\)`
	_ = make(map[string]http.Client)     // want `constructs an http.Client via make\(\)`
	_ = make(chan net.Dialer, 1)         // want `constructs a net.Dialer via make\(\)`
	_ = make([]*http.Client, 1)          // pointer elements: nothing constructed
	_ = make(map[string]*http.Client, 1) // pointer elements: nothing constructed
	_ = resty.New()
	_ = codes.OK
	_ = grpc.Version
}

func containers() {
	var a [2]http.Client // want `constructs an http.Client as a zero-value declaration`
	_ = a
	var m map[string]http.Client // want `constructs an http.Client as a zero-value declaration`
	_ = m
	var ps []*http.Client // pointer elements: nothing constructed
	_ = ps
}

type holdsMany struct {
	pool  []http.Client  // want `constructs an http.Client as a by-value struct field`
	ptrs  []*http.Client // pointer elements: fine
	byKey map[string]*net.Dialer
}

func zeroValue() {
	var c http.Client // want `constructs an http.Client as a zero-value declaration`
	_ = c
	var d net.Dialer // want `constructs a net.Dialer as a zero-value declaration`
	_ = d
}

func defaults(url string) {
	_, _ = http.Get(url)                        // want `calls http.Get outside the hardened egress package`
	_, _ = http.Head(url)                       // want `calls http.Head outside the hardened egress package`
	_, _ = http.Post(url, "text/plain", nil)    // want `calls http.Post outside the hardened egress package`
	_, _ = http.PostForm(url, nil)              // want `calls http.PostForm outside the hardened egress package`
	_ = http.DefaultClient                      // want `uses http.DefaultClient outside the hardened egress package`
	_ = http.DefaultTransport                   // want `uses http.DefaultTransport outside the hardened egress package`
	_, _ = http.DefaultClient.Get(url)          // want `uses http.DefaultClient outside the hardened egress package`
	_ = http.DefaultTransport.(*http.Transport) // want `uses http.DefaultTransport outside the hardened egress package`
}

func dials(ctx context.Context, addr string) {
	_, _ = net.Dial("tcp", addr)                                     // want `calls net.Dial outside the hardened egress package`
	_, _ = net.DialTimeout("tcp", addr, time.Second)                 // want `calls net.DialTimeout outside the hardened egress package`
	_, _ = tls.Dial("tcp", addr, nil)                                // want `calls tls.Dial outside the hardened egress package`
	_, _ = tls.DialWithDialer(&net.Dialer{}, "tcp", addr, nil)       // want `calls tls.DialWithDialer` `constructs a net.Dialer`
	fd, _ := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0) // want `calls syscall.Socket`
	_ = syscall.Connect(fd, &syscall.SockaddrInet4{})                // want `calls syscall.Connect`
}

func notEgress() {
	// Server-side and request-construction uses of net/http are fine.
	_, _ = http.NewRequest(http.MethodGet, "http://example", nil)
	_ = http.StatusOK
	_ = &http.Server{}
	var h http.Header
	_ = h
	// A method named Get on an unrelated type is not http.Get.
	var w wrapper
	_ = w.client
}

// notADirective: a longer word sharing the prefix is not the directive and
// must not exempt anything.
func notADirective() {
	//egress:allowed because reasons
	_ = &http.Client{} // want `constructs an http.Client outside the hardened egress package`
	_ = &http.Client{} //egress:allow-ish // want `constructs an http.Client outside the hardened egress package`
}

// missingReason is reported because the directive carries no justification.
func missingReason() {
	//egress:allow
	_ = &http.Client{} // want `directive needs a reason` `constructs an http.Client outside the hardened egress package`
}
