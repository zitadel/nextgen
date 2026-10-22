/** Whether the process has been up for a moment, available to every Nitro handler without an import. */
export function helloUptime(): boolean {
  return process.uptime() > 0;
}
