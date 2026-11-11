package exempted

import "time"

type sweeper struct{}

func (s *sweeper) loop() {}

func trailing(s *sweeper) {
	go s.loop() //background:allow the task "sweep"
}

func above(s *sweeper) {
	//background:allow the task "sweep"
	time.AfterFunc(time.Hour, s.loop)
}

func directiveOnlyCoversItsLine(s *sweeper) {
	//background:allow the listener
	go s.loop()
	go s.loop() // want `go statement outside internal/background`
}
