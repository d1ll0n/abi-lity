import chalk from "chalk";

export const err = chalk.bold.red;
export const warn = chalk.hex("#FFA500");
export const info = chalk.blue;
export const success = chalk.green;

export const diffPctString = (newValue: number, oldValue: number): string => {
  const diff = newValue - oldValue;
  if (diff === 0) return info(newValue);
  const pct = +((100 * diff) / oldValue).toFixed(2);
  const prefix = pct > 0 ? "+" : "";
  const color = diff > 0 ? warn : success;
  return `${newValue} (${color(`${prefix}${pct}%`)})`;
};

// eslint-disable-next-line no-control-regex
export const stripANSI = (str: string): string => str.replace(/\u001b\[.*?m/g, "");

// eslint-disable-next-line no-control-regex
export const getANSIRegex = (): RegExp => /\u001b\[.*?m/g;

export function getColumnSizesAndAlignments(
  rows: string[][],
  padding = 0
): Array<[number, boolean]> {
  const sizesAndAlignments: Array<[number, boolean]> = [];
  const numColumns = rows[0].length;
  for (let i = 0; i < numColumns; i++) {
    const entries = rows.map((row) => stripANSI(row[i]));
    const maxSize = Math.max(...entries.map((e) => e.length));
    const alignLeft = entries.slice(1).some((e) => !!e.match(/[a-zA-Z]/g));
    sizesAndAlignments.push([maxSize + padding, alignLeft]);
  }
  return sizesAndAlignments;
}

export const padColumn = (
  col: string,
  size: number,
  padWith: string,
  alignLeft: boolean
): string => {
  const padSize = Math.max(0, size - stripANSI(col).length);
  const padding = padWith.repeat(padSize);
  if (alignLeft) return `${col}${padding}`;
  return `${padding}${col}`;
};

export const toCommentTable = (rows: string[][]): string[] => {
  const sizesAndAlignments = getColumnSizesAndAlignments(rows);
  rows.forEach((row) => {
    row.forEach((col, c) => {
      const [size, alignLeft] = sizesAndAlignments[c];
      row[c] = padColumn(col, size, " ", alignLeft);
    });
  });

  const completeRows = rows.map((row) => `| ${row.join(" | ")} |`);
  const rowSeparator = `==${sizesAndAlignments.map(([size]) => "=".repeat(size)).join("===")}==`;
  completeRows.splice(1, 0, rowSeparator);
  completeRows.unshift(rowSeparator);
  completeRows.push(rowSeparator);
  return completeRows;
};
