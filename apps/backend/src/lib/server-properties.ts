export type ServerPropertiesLine =
  | {
      type: 'comment';
      raw: string;
    }
  | {
      type: 'blank';
      raw: string;
    }
  | {
      type: 'property';
      raw: string;
      key: string;
      value: string;
      separator: '=' | ':';
    };

export interface ParsedServerProperties {
  lines: ServerPropertiesLine[];
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\f';
}

function endsWithUnescapedBackslash(input: string): boolean {
  let slashCount = 0;
  for (let index = input.length - 1; index >= 0 && input[index] === '\\'; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function unescapeSegment(input: string): string {
  let out = '';
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== '\\') {
      out += char;
      continue;
    }

    const next = input[index + 1];
    if (next === undefined) {
      out += '\\';
      continue;
    }

    if (next === 't') {
      out += '\t';
      index += 1;
      continue;
    }
    if (next === 'r') {
      out += '\r';
      index += 1;
      continue;
    }
    if (next === 'n') {
      out += '\n';
      index += 1;
      continue;
    }
    if (next === 'f') {
      out += '\f';
      index += 1;
      continue;
    }
    if (next === 'u') {
      const hex = input.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
        continue;
      }
    }

    out += next;
    index += 1;
  }

  return out;
}

function escapeSegment(input: string, isKey: boolean): string {
  let out = '';
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '\\') {
      out += '\\\\';
      continue;
    }
    if (char === '\t') {
      out += '\\t';
      continue;
    }
    if (char === '\n') {
      out += '\\n';
      continue;
    }
    if (char === '\r') {
      out += '\\r';
      continue;
    }
    if (char === '\f') {
      out += '\\f';
      continue;
    }
    if (char === ':') {
      out += '\\:';
      continue;
    }
    if (char === '=') {
      out += '\\=';
      continue;
    }
    if (char === '#' || char === '!') {
      if (index === 0) {
        out += `\\${char}`;
        continue;
      }
    }
    if (char === ' ' && (isKey || index === 0)) {
      out += '\\ ';
      continue;
    }
    out += char;
  }
  return out;
}

function parsePropertyLine(rawLine: string): ServerPropertiesLine {
  let index = 0;
  let escaped = false;
  while (index < rawLine.length) {
    const char = rawLine[index];
    if (char === undefined) break;
    if (!escaped && (char === '=' || char === ':')) break;
    if (!escaped && isWhitespace(char)) break;

    if (char === '\\') {
      escaped = !escaped;
    } else {
      escaped = false;
    }
    index += 1;
  }

  const rawKeyPart = rawLine.slice(0, index);
  let separator: '=' | ':' = '=';
  let cursor = index;

  while (cursor < rawLine.length) {
    const char = rawLine[cursor];
    if (char === undefined || !isWhitespace(char)) break;
    cursor += 1;
  }

  const separatorChar = rawLine[cursor];
  if (separatorChar === '=' || separatorChar === ':') {
    separator = separatorChar;
    cursor += 1;
  }

  while (cursor < rawLine.length) {
    const char = rawLine[cursor];
    if (char === undefined || !isWhitespace(char)) break;
    cursor += 1;
  }

  const rawValuePart = rawLine.slice(cursor);
  return {
    type: 'property',
    raw: rawLine,
    key: unescapeSegment(rawKeyPart),
    value: unescapeSegment(rawValuePart),
    separator,
  };
}

function splitLogicalLines(input: string): string[] {
  const normalized = input.replace(/\r\n?/g, '\n');
  const physicalLines = normalized.split('\n');
  const logicalLines: string[] = [];

  for (let index = 0; index < physicalLines.length; index += 1) {
    let line = physicalLines[index] ?? '';
    while (endsWithUnescapedBackslash(line) && index + 1 < physicalLines.length) {
      line = line.slice(0, -1) + (physicalLines[index + 1] ?? '');
      index += 1;
    }
    logicalLines.push(line);
  }

  if (logicalLines.length > 0 && logicalLines[logicalLines.length - 1] === '') {
    logicalLines.pop();
  }

  return logicalLines;
}

export function parseServerProperties(input: string): ParsedServerProperties {
  const lines = splitLogicalLines(input);

  return {
    lines: lines.map((line) => {
      const trimmedStart = line.trimStart();
      if (trimmedStart.length === 0) {
        return { type: 'blank', raw: line } satisfies ServerPropertiesLine;
      }
      if (trimmedStart.startsWith('#') || trimmedStart.startsWith('!')) {
        return { type: 'comment', raw: line } satisfies ServerPropertiesLine;
      }
      return parsePropertyLine(line);
    }),
  };
}

export function updateServerProperty(
  parsed: ParsedServerProperties,
  key: string,
  value: string,
): ParsedServerProperties {
  const nextLines = parsed.lines.slice();
  const propertyIndex = nextLines.findIndex((line) => line.type === 'property' && line.key === key);

  if (propertyIndex >= 0) {
    const current = nextLines[propertyIndex];
    if (current !== undefined && current.type === 'property') {
      nextLines[propertyIndex] = {
        ...current,
        value,
      };
    }
    return { lines: nextLines };
  }

  nextLines.push({
    type: 'property',
    raw: '',
    key,
    value,
    separator: '=',
  });
  return { lines: nextLines };
}

export function serializeServerProperties(parsed: ParsedServerProperties): string {
  return parsed.lines
    .map((line) => {
      if (line.type === 'comment' || line.type === 'blank') {
        return line.raw;
      }
      const key = escapeSegment(line.key, true);
      const value = escapeSegment(line.value, false);
      return `${key}${line.separator}${value}`;
    })
    .join('\n');
}
