export const BUDGETS: { standalone: number; defaultPath: number };
export function sizeOf(path: string): { raw: number; gzip: number };
export function staticGraph(entry: string): { files: string[]; packages: string[] };
export function bundleReport(distDir: string): {
  standalone: { raw: number; gzip: number };
  defaultPath: {
    raw: number;
    gzip: number;
    files: Array<{ file: string; raw: number; gzip: number }>;
    packages: string[];
  };
};
export function formatReport(report: ReturnType<typeof bundleReport>): string;
