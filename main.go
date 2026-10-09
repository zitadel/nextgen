package main

import (
	"log"

	"github.com/zitadel/zitadel/v5/cmd/server"
)

func main() {
	if err := server.NewCommand().Execute(); err != nil {
		log.Fatal(err)
	}
}
