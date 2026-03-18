// ─── Multi-line Environment Variable Parser ─────────────────────────────────

export interface EnvParseResult {
  key: string;
  value: string;
}

export interface EnvParseError {
  line: number;
  message: string;
  raw: string;
}

export interface ParseResult {
  entries: EnvParseResult[];
  errors: EnvParseError[];
}

/**
 * Parse a .env-style string into key-value pairs.
 *
 * Supports:
 *   - KEY=value
 *   - KEY="value with spaces"
 *   - KEY='value with single quotes'
 *   - Multi-line values in double quotes
 *   - SSH keys, values containing =, empty values (KEY=)
 *   - Comments (lines starting with #) and blank lines
 *   - Unicode characters
 *   - Windows line endings (\r\n)
 *
 * Rejects:
 *   - Lines without = (non-comment, non-blank)
 *   - Keys starting with a digit
 *   - Keys containing spaces
 */
export function parseEnvString(input: string): ParseResult {
  const entries: EnvParseResult[] = [];
  const errors: EnvParseError[] = [];

  // Normalize Windows line endings
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  let i = 0;
  while (i < lines.length) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip blank lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    // Must contain =
    const eqIndex = rawLine.indexOf("=");
    if (eqIndex === -1) {
      errors.push({
        line: lineNum,
        message: "Missing = sign",
        raw: rawLine,
      });
      i++;
      continue;
    }

    const key = rawLine.substring(0, eqIndex).trim();

    // Validate key
    if (key.length === 0) {
      errors.push({
        line: lineNum,
        message: "Empty key",
        raw: rawLine,
      });
      i++;
      continue;
    }

    if (/^\d/.test(key)) {
      errors.push({
        line: lineNum,
        message: "Key cannot start with a number",
        raw: rawLine,
      });
      i++;
      continue;
    }

    if (/\s/.test(key)) {
      errors.push({
        line: lineNum,
        message: "Key cannot contain spaces",
        raw: rawLine,
      });
      i++;
      continue;
    }

    let valueRaw = rawLine.substring(eqIndex + 1);

    // Check for quoted multi-line values
    const valueTrimmed = valueRaw.trimStart();

    if (valueTrimmed.startsWith('"')) {
      // Double-quoted value — may span multiple lines
      const afterQuote = valueTrimmed.substring(1);
      const closingIdx = findClosingQuote(afterQuote, '"');

      if (closingIdx !== -1) {
        // Single-line quoted value — preserve trailing whitespace inside quotes
        const value = afterQuote.substring(0, closingIdx);
        entries.push({ key, value: unescapeQuoted(value) });
        i++;
        continue;
      }

      // Multi-line: accumulate until closing quote
      const parts: string[] = [afterQuote];
      let found = false;
      let j = i + 1;

      while (j < lines.length) {
        const nextLine = lines[j];
        const closeIdx = findClosingQuote(nextLine, '"');
        if (closeIdx !== -1) {
          parts.push(nextLine.substring(0, closeIdx));
          found = true;
          j++;
          break;
        }
        parts.push(nextLine);
        j++;
      }

      if (found) {
        const value = parts.join("\n");
        entries.push({ key, value: unescapeQuoted(value) });
        i = j;
        continue;
      } else {
        // Unterminated quote — treat rest of input as value
        const value = parts.join("\n");
        entries.push({ key, value: unescapeQuoted(value) });
        i = lines.length;
        continue;
      }
    }

    if (valueTrimmed.startsWith("'")) {
      // Single-quoted value — may span multiple lines
      const afterQuote = valueTrimmed.substring(1);
      const closingIdx = findClosingQuote(afterQuote, "'");

      if (closingIdx !== -1) {
        const value = afterQuote.substring(0, closingIdx);
        entries.push({ key, value });
        i++;
        continue;
      }

      // Multi-line single quote
      const parts: string[] = [afterQuote];
      let found = false;
      let j = i + 1;

      while (j < lines.length) {
        const nextLine = lines[j];
        const closeIdx = findClosingQuote(nextLine, "'");
        if (closeIdx !== -1) {
          parts.push(nextLine.substring(0, closeIdx));
          found = true;
          j++;
          break;
        }
        parts.push(nextLine);
        j++;
      }

      if (found) {
        const value = parts.join("\n");
        entries.push({ key, value });
        i = j;
        continue;
      } else {
        const value = parts.join("\n");
        entries.push({ key, value });
        i = lines.length;
        continue;
      }
    }

    // Unquoted value — strip leading/trailing whitespace
    const value = valueRaw.trim();

    // Strip inline comments from unquoted values
    const commentIdx = value.indexOf(" #");
    const finalValue = commentIdx !== -1 ? value.substring(0, commentIdx).trimEnd() : value;

    entries.push({ key, value: finalValue });
    i++;
  }

  return { entries, errors };
}

/**
 * Convert parsed entries to a Record<string, string>.
 * Later entries override earlier ones with the same key.
 */
export function envToRecord(input: string): Record<string, string> {
  const { entries } = parseEnvString(input);
  const result: Record<string, string> = {};
  for (const { key, value } of entries) {
    result[key] = value;
  }
  return result;
}

/**
 * Serialize a Record<string, string> back into .env format.
 * Multi-line values and values with spaces are double-quoted.
 */
export function recordToEnv(record: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value.includes("\n") || value.includes(" ") || value.includes('"') || value.includes("'") || value.includes("#")) {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      lines.push(`${key}="${escaped}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findClosingQuote(str: string, quote: '"' | "'"): number {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "\\" && quote === '"') {
      i++; // skip escaped character in double quotes
      continue;
    }
    if (str[i] === quote) {
      return i;
    }
  }
  return -1;
}

function unescapeQuoted(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}
