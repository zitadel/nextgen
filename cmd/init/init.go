package init

import (
	"log"

	"github.com/spf13/cobra"
)

func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "init",
		Short: "Initialize the database schema",
		RunE: func(_ *cobra.Command, _ []string) error {
			log.Println("init: nothing to do yet")
			return nil
		},
	}

	cmd.Flags().StringP("config", "c", "", "Path to YAML configuration file")

	return cmd
}
