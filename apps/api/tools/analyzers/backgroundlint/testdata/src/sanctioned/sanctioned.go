package sanctioned

func start(run func()) {
	go run()
}
