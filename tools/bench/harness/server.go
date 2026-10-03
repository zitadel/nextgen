package harness

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Server is a local nextgen server the sweep starts for itself: SQLite in a
// fresh data directory, migrations applied on start, no embedded UI, and the
// request log streams off — the default request logging is a measured
// throughput cost and is not what a benchmark is there to measure.
type Server struct {
	Base string
	Dir  string
	cmd  *exec.Cmd
	done chan error
}

// ServerConfig says what to start.
type ServerConfig struct {
	// Binary is the nextgen server executable.
	Binary string
	// Dir receives the config, the data directory and server.log.
	Dir string
	// Port to listen on; 0 picks a free one.
	Port int
}

// StartServer launches the server and returns once /healthz answers. A
// process that exits before that is reported with the tail of its log.
func StartServer(ctx context.Context, cfg ServerConfig) (*Server, error) {
	if cfg.Port == 0 {
		p, err := freePort()
		if err != nil {
			return nil, err
		}
		cfg.Port = p
	}
	if err := os.MkdirAll(filepath.Join(cfg.Dir, "data"), 0o755); err != nil {
		return nil, err
	}
	bin, err := filepath.Abs(cfg.Binary)
	if err != nil {
		return nil, err
	}
	config := fmt.Sprintf(`server:
  address: ":%d"
  data_dir: ./data
  console_enabled: false
  login_enabled: false
platform:
  bootstrap_project: true
instrumentation:
  log:
    level: warn
    add_source: false
    streams: [runtime, ready]
`, cfg.Port)
	if err := os.WriteFile(filepath.Join(cfg.Dir, "nextgen.yaml"), []byte(config), 0o644); err != nil {
		return nil, err
	}
	logFile, err := os.Create(filepath.Join(cfg.Dir, "server.log"))
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, bin, "-c", "nextgen.yaml", "--migrate")
	cmd.Dir = cfg.Dir
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 10 * time.Second
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, err
	}
	s := &Server{Base: fmt.Sprintf("http://localhost:%d", cfg.Port), Dir: cfg.Dir, cmd: cmd, done: make(chan error, 1)}
	go func() {
		s.done <- cmd.Wait()
		_ = logFile.Close()
	}()

	if err := s.waitHealthy(ctx, 60*time.Second); err != nil {
		_ = s.Stop()
		return nil, err
	}
	return s, nil
}

func (s *Server) waitHealthy(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	//egress:allow benchmark harness probing the server it started
	client := &http.Client{Timeout: time.Second}
	for time.Now().Before(deadline) {
		select {
		case err := <-s.done:
			s.done <- err
			return fmt.Errorf("server exited before becoming healthy: %w\n%s", err, s.logTail())
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
		resp, err := client.Get(s.Base + "/healthz")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
	}
	return fmt.Errorf("server did not answer /healthz within %s\n%s", timeout, s.logTail())
}

// Stop terminates the server and waits for it to exit.
func (s *Server) Stop() error {
	if s.cmd.Process == nil {
		return nil
	}
	_ = s.cmd.Process.Signal(syscall.SIGTERM)
	select {
	case err := <-s.done:
		if exit, ok := errors.AsType[*exec.ExitError](err); ok && exit.ExitCode() == -1 {
			return nil // signalled, as asked
		}
		return err
	case <-time.After(15 * time.Second):
		_ = s.cmd.Process.Kill()
		return <-s.done
	}
}

func (s *Server) logTail() string {
	b, err := os.ReadFile(filepath.Join(s.Dir, "server.log"))
	if err != nil {
		return ""
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) > 20 {
		lines = lines[len(lines)-20:]
	}
	return strings.Join(lines, "\n")
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
