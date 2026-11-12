---
"@zitadel/cli": patch
---

A `zitadel` command that does not exist now fails like every other command: under `--json` it prints one `E_VALIDATION` error envelope on stdout, naming the command and suggesting the `--help` of the commands it was close to and of its topic, instead of printing nothing. It still exits 127. On a terminal it no longer asks "Did you mean …?" and offers to run a different, possibly destructive, command with your flags dropped; it prints the error and names the close matches to type.
