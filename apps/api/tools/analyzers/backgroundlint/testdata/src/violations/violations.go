package violations

import "time"

type sweeper struct{}

func (s *sweeper) loop() {}

func start(s *sweeper) {
	go s.loop()                       // want `go statement outside internal/background`
	go func() {}()                    // want `go statement outside internal/background`
	time.AfterFunc(time.Hour, s.loop) // want `time.AfterFunc outside internal/background`
}

func withoutAReason(s *sweeper) {
	//background:allow
	go s.loop() // want `//background:allow directive needs a reason` `go statement outside internal/background`
}

func notADirective(s *sweeper) {
	go s.loop() //background:allowed by nobody // want `go statement outside internal/background`
}

// A timer the caller waits on starts nothing that outlives the call.
func waits() {
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	<-timer.C
}
