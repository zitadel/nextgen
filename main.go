package main

import (
	"log"

	"github.com/zitadel/nextgen/cmd/server"
)

func main() {
	if err := server.NewCommand().Execute(); err != nil {
		log.Fatal(err)
	}
}
