const LIST_MARKER = /^([•·●○▪◦‣*–—-][ \t]+|\(?\d{1,3}[.)][ \t]+|\(?[a-z][.)][ \t]+)/;
const HEADING_WORD =
  /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;

export function shapeIsHeading(line: string): boolean {
  if (LIST_MARKER.test(line)) return false;
  if (line.length < 3 || line.length > 80) return false;
  if (/[.,;:]$/.test(line)) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  if (HEADING_WORD.test(line)) return true;
  return line === line.toUpperCase() && line.split(/\s+/).length <= 12;
}

export function headingLevel(raw: string, levels: Record<string, number>): number {
  const line = raw.trim();
  if (!line) return 0;

  const measured = levels[line];
  if (measured) return Math.min(3, Math.max(1, measured));

  return shapeIsHeading(line) ? 2 : 0;
}
