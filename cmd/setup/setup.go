package setup

import (
	"log"

	"github.com/spf13/cobra"
)

func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "setup",
		Short: "Run setup tasks (seed data, create first instance)",
		RunE: func(_ *cobra.Command, _ []string) error {
			log.Println("setup: nothing to do yet")
			return nil
		},
	}

	cmd.Flags().StringP("config", "c", "", "Path to YAML configuration file")

	return cmd
}
