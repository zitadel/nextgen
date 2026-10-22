const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** One decoded mapping: generated column → original line and column (all zero-based). */
export interface Segment {
  readonly column: number;
  readonly sourceLine: number;
  readonly sourceColumn: number;
}

/** Decodes a source map's `mappings` into segments per generated line (only segments with a source). */
export function decodeMappings(mappings: string): Segment[][] {
  let sourceLine = 0;
  let sourceColumn = 0;
  return mappings.split(";").map((line) => {
    let column = 0;
    const segments: Segment[] = [];
    for (const field of line.split(",").filter(Boolean)) {
      const values: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of field) {
        const digit = BASE64.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
          continue;
        }
        values.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
      column += values[0] ?? 0;
      if (values.length < 4) continue;
      sourceLine += values[2] ?? 0;
      sourceColumn += values[3] ?? 0;
      segments.push({ column, sourceLine, sourceColumn });
    }
    return segments;
  });
}
