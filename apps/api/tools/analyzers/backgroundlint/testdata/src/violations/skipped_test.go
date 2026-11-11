package violations

func inATest() {
	go func() {}()
}
