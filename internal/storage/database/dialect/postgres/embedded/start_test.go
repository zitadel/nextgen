package embedded

import (
	"fmt"
	"net"
	"testing"
)

func TestGetPortReleasesReservedTCP4Port(t *testing.T) {
	port, releasePort, err := getPort()
	if err != nil {
		t.Fatalf("get port: %v", err)
	}

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	listener, err := net.Listen("tcp4", addr)
	if err == nil {
		_ = listener.Close()
		_ = releasePort()
		t.Fatalf("port %d was not reserved before release", port)
	}

	if err = releasePort(); err != nil {
		t.Fatalf("release port: %v", err)
	}

	listener, err = net.Listen("tcp4", addr)
	if err != nil {
		t.Fatalf("port %d was not released: %v", port, err)
	}
	_ = listener.Close()
}
