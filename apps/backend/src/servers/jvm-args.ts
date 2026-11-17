import type { JvmFlagsProfile } from '@locternos/shared';

/** Aikar's recommended flags for Minecraft servers (G1GC tuning). */
const AIKARS_FLAGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
  '-Dusing.aikars.flags=https://mcflags.emc.gs',
  '-Daikars.new.flags=true',
];

const ZGC_FLAGS = ['-XX:+UseZGC'];

const PROFILE_FLAGS: Record<JvmFlagsProfile, string[]> = {
  default: [],
  aikars: AIKARS_FLAGS,
  zgc: ZGC_FLAGS,
};

/**
 * Splits a custom argument string into tokens, honoring single/double quotes
 * and backslash escapes so paths with spaces survive.
 */
export function splitCustomArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let hasToken = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      hasToken = true;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      hasToken = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      hasToken = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (hasToken) args.push(current);
  return args;
}

export interface JvmArgsInput {
  minRamMb: number;
  maxRamMb: number;
  profile: JvmFlagsProfile;
  customJvmArgs: string;
  entrypointJar: string;
}

/**
 * Builds the Java argument list for a server process. RAM flags come first so
 * custom arguments can still override GC tuning when needed.
 */
export function buildJvmArgs(input: JvmArgsInput): string[] {
  const args = [
    `-Xms${input.minRamMb}M`,
    `-Xmx${input.maxRamMb}M`,
    ...PROFILE_FLAGS[input.profile],
    ...splitCustomArgs(input.customJvmArgs),
    '-jar',
    input.entrypointJar,
    'nogui',
  ];
  return args;
}
