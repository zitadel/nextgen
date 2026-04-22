package main

import (
	"context"
	"encoding/json"
	"errors"
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
	dts, err := conn.LoadTypes(ctx, []string{
		"zitadel_nextgen.uniqueness_scope",
		"zitadel_nextgen.incoming_user_attribute",
		"zitadel_nextgen._incoming_user_attribute",
	})
	if err != nil {
		panic(fmt.Sprintf("failed to load types: %v", err))
	}
	conn.TypeMap().RegisterTypes(dts)
}

func main() {
	if len(os.Args) != 2 {
		printUsageAndExit()
	}
	switch os.Args[1] {
	case "get-user-by-id":
		runGetUserByID()
	case "create-user":
		runCreateUser()
	default:
		printUsageAndExit()
	}
}

func printUsageAndExit() {
	fmt.Fprintf(os.Stderr, "usage: %s <command>\n", os.Args[0])
	fmt.Fprintf(os.Stderr, "commands:\n")
	fmt.Fprintf(os.Stderr, "  create-user\n")
	fmt.Fprintf(os.Stderr, "  get-user-by-id\n")
	os.Exit(1)
}

func runCreateUser() {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var err error
	in := &IncommingUser{
		SchemaURL:      "./user.schema.json",
		ID:             "test_99999999",
		OrganizationID: "org_0001",
		Attributes: []IncommingUserAttribute{
			// Ignoring errors for brevity, in production code you should handle them properly
			func() IncommingUserAttribute {
				a, _ := NewIncommingUserAttribute("username", "johndoe", UserUniquenessGlobal)
				return a
			}(),
			func() IncommingUserAttribute {
				a, attrErr := NewIncommingUserAttribute("email", "johndoe@example.com", UserUniquenessGlobal)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncommingUserAttribute {
				a, attrErr := NewIncommingUserAttribute("email_verified", false, UserUniquenessUnspecified)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncommingUserAttribute {
				a, attrErr := NewIncommingUserAttribute("nickname", "Johnny", UserUniquenessOrganization)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncommingUserAttribute {
				a, attrErr := NewIncommingUserAttribute("address.country", "USA", UserUniquenessUnspecified)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncommingUserAttribute {
				a, attrErr := NewIncommingUserAttribute("address.city", "New York", UserUniquenessUnspecified)
				err = errors.Join(err, attrErr)
				return a
			}(),
		},
	}
	if err != nil {
		panic(err)
	}

	user, err := CreateUser(ctx, "inst_1", in)
	if err != nil {
		panic(err)
	}
	printUser(user)
}

func runGetUserByID() {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	user, err := GetUserByID(ctx, "inst_5", "usr_00501017")
	if err != nil {
		panic(err)
	}
	printUser(user)
}

func printUser(user *User) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(user)
}
