export interface ParsedJavaVersion {
  /** Full version as printed by the JVM, e.g. `21.0.5` or `1.8.0_392`. */
  version: string;
  majorVersion: number;
  vendor: string | null;
}

const VERSION_PATTERN = /\b(?:openjdk|java)\s+version\s+"([^"]+)"/i;

/** Known vendor markers printed in the `java -version` banner. */
const VENDOR_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/temurin/i, 'Eclipse Temurin'],
  [/adoptopenjdk/i, 'AdoptOpenJDK'],
  [/graalvm/i, 'GraalVM'],
  [/corretto/i, 'Amazon Corretto'],
  [/zulu/i, 'Azul Zulu'],
  [/sapmachine/i, 'SapMachine'],
  [/microsoft/i, 'Microsoft OpenJDK'],
  [/liberica/i, 'BellSoft Liberica'],
  [/oracle/i, 'Oracle'],
  [/openjdk/i, 'OpenJDK'],
];

/**
 * Extracts the major version from a Java version string. Legacy versions are
 * reported as `1.8.0_392`, where the real major version is the second number;
 * modern versions start with the major version directly (e.g. `21.0.5`, and
 * the new `26.x` scheme).
 */
export function majorVersionFromString(version: string): number | null {
  const legacy = /^1\.(\d+)(?:[._+]|$)/.exec(version);
  if (legacy?.[1]) {
    const parsed = Number.parseInt(legacy[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const modern = /^(\d+)(?:[._+-]|$)/.exec(version);
  if (modern?.[1]) {
    const parsed = Number.parseInt(modern[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

/**
 * Parses `java -version` output. The JVM writes the banner to stderr, so the
 * caller should pass the combined output of stdout and stderr.
 */
export function parseJavaVersion(raw: string): ParsedJavaVersion | null {
  const match = VERSION_PATTERN.exec(raw);
  const version = match?.[1];
  if (!version) return null;

  const majorVersion = majorVersionFromString(version);
  if (majorVersion === null) return null;

  const vendor = VENDOR_MARKERS.find(([pattern]) => pattern.test(raw))?.[1] ?? null;

  return { version, majorVersion, vendor };
}
