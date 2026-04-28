import { runCli } from "../cli";

const exitCode = await runCli();
process.exitCode = exitCode;
