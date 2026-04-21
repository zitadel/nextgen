package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	connString = "postgres://zitadel:zitadel@postgres:5432/nextgen?sslmode=disable"
	timeout    = 5 * time.Second
)

var (
	conn *pgx.Conn
)

func init() {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var err error
	conn, err = pgx.Connect(ctx, connString)
	if err != nil {
		panic(fmt.Sprintf("unable to connect to database: %v", err))
	}
}

func main() {
	if len(os.Args) != 2 {
		printUsageAndExit()
	}
	switch os.Args[1] {
	case "get-user":
		runGetUser()
	default:
		printUsageAndExit()
	}
}

func printUsageAndExit() {
	fmt.Fprintf(os.Stderr, "usage: %s <command>\n", os.Args[0])
	fmt.Fprintf(os.Stderr, "commands:\n")
	fmt.Fprintf(os.Stderr, "  get-user\n")
	os.Exit(1)
}

func runGetUser() {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	user, err := GetUser(ctx, "inst_5", "usr_00501017")
	if err != nil {
		panic(err)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(user)
}
