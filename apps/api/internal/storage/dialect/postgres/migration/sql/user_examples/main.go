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
	case "put-user":
		runPutUser()
	case "patch-user":
		runPatchUser()
	default:
		printUsageAndExit()
	}
}

func printUsageAndExit() {
	fmt.Fprintf(os.Stderr, "usage: %s <command>\n", os.Args[0])
	fmt.Fprintf(os.Stderr, "commands:\n")
	fmt.Fprintf(os.Stderr, "  create-user\n")
	fmt.Fprintf(os.Stderr, "  get-user-by-id\n")
	fmt.Fprintf(os.Stderr, "  put-user\n")
	fmt.Fprintf(os.Stderr, "  patch-user\n")
	os.Exit(1)
}

func runCreateUser() {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var err error
	in := &IncomingUser{
		SchemaURL:      "./user.schema.json",
		ID:             "test_99999999",
		OrganizationID: "org_0001",
		Attributes: []IncomingUserAttribute{
			func() IncomingUserAttribute {
				a, attrErr := NewIncomingUserAttribute("username", "john_doe", UserUniquenessGlobal)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncomingUserAttribute {
				a, attrErr := NewIncomingUserAttribute("email", "johndoe@example.com", UserUniquenessGlobal)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncomingUserAttribute {
				a, attrErr := NewIncomingUserAttribute("email_verified", false, UserUniquenessUnspecified)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncomingUserAttribute {
				a, attrErr := NewIncomingUserAttribute("nickname", "Johnny", UserUniquenessOrganization)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncomingUserAttribute {
				a, attrErr := NewIncomingUserAttribute("address.country", "USA", UserUniquenessUnspecified)
				err = errors.Join(err, attrErr)
				return a
			}(),
			func() IncomingUserAttribute {
				a, attrErr := NewIncomingUserAttribute("address.city", "New York", UserUniquenessUnspecified)
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
	printResult(user)
}

func runGetUserByID() {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	user, err := GetUserByID(ctx, "inst_5", "user_00501017")
	if err != nil {
		panic(err)
	}
	printResult(user)
}

func runPutUser() {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var err error
	attributes := []IncomingUserAttribute{
		func() IncomingUserAttribute {
			a, attrErr := NewIncomingUserAttribute("username", "john_doe", UserUniquenessGlobal)
			err = errors.Join(err, attrErr)
			return a
		}(),
		func() IncomingUserAttribute {
			a, attrErr := NewIncomingUserAttribute("email", "john-updated@example.com", UserUniquenessGlobal)
			err = errors.Join(err, attrErr)
			return a
		}(),
		func() IncomingUserAttribute {
			a, attrErr := NewIncomingUserAttribute("email_verified", true, UserUniquenessUnspecified)
			err = errors.Join(err, attrErr)
			return a
		}(),
		func() IncomingUserAttribute {
			a, attrErr := NewIncomingUserAttribute("nickname", "Johnny Put", UserUniquenessOrganization)
			err = errors.Join(err, attrErr)
			return a
		}(),
		func() IncomingUserAttribute {
			a, attrErr := NewIncomingUserAttribute("address.country", "USA", UserUniquenessUnspecified)
			err = errors.Join(err, attrErr)
			return a
		}(),
	}
	if err != nil {
		panic(err)
	}

	result, err := PutUser(ctx, "inst_5", "user_00501017", attributes)
	if err != nil {
		panic(err)
	}
	printResult(result)
}

func runPatchUser() {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var err error
	attributes := []IncomingUserAttribute{
		func() IncomingUserAttribute {
			a, attrErr := NewIncomingUserAttribute("email", "john-patched@example.com", UserUniquenessGlobal)
			err = errors.Join(err, attrErr)
			return a
		}(),
		func() IncomingUserAttribute {
			a, attrErr := NewIncomingUserAttribute("email_verified", false, UserUniquenessUnspecified)
			err = errors.Join(err, attrErr)
			return a
		}(),
		func() IncomingUserAttribute {
			a, attrErr := NewIncomingUserAttribute("nickname", "Johnny Patched", UserUniquenessOrganization)
			err = errors.Join(err, attrErr)
			return a
		}(),
	}
	if err != nil {
		panic(err)
	}

	deleteKeys := []string{"address.city"}

	user, err := PatchUser(ctx, "inst_5", "user_00501017", attributes, deleteKeys)
	if err != nil {
		panic(err)
	}
	printResult(user)
}

func printResult(result any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(result)
}
