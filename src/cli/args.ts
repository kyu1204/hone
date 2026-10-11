// A small argv parser: --flag, --no-flag, --key value, --key=value, repeats, numbers, positionals, --help.

export interface ArgSpec {
  flags?: readonly string[];
  strings?: readonly string[];
  numbers?: readonly string[];
  repeatable?: readonly string[];
  /** String options that may appear without a value (recorded as ""). */
  optionalValue?: readonly string[];
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, boolean | undefined>;
  values: Record<string, string[] | undefined>;
  numbers: Record<string, number | undefined>;
  help: boolean;
}

export class ArgError extends Error {
  name = "ArgError";
}

export function parseArgs(argv: string[], spec: ArgSpec): ParsedArgs {
  const out: ParsedArgs = { positionals: [], flags: {}, values: {}, numbers: {}, help: false };
  const flags = new Set(spec.flags ?? []);
  const strings = new Set(spec.strings ?? []);
  const numbers = new Set(spec.numbers ?? []);
  const repeatable = new Set(spec.repeatable ?? []);
  const optional = new Set(spec.optionalValue ?? []);
  const push = (key: string, value: string): void => {
    if (repeatable.has(key)) (out.values[key] ??= []).push(value);
    else out.values[key] = [value];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      out.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    if (key.startsWith("no-") && flags.has(key.slice(3))) {
      out.flags[key.slice(3)] = false;
      continue;
    }
    if (flags.has(key)) {
      out.flags[key] = inline === undefined ? true : inline !== "false";
      continue;
    }
    if (numbers.has(key)) {
      const raw = inline ?? argv[++i];
      const n = Number(raw);
      if (raw === undefined || raw === "" || !Number.isFinite(n)) throw new ArgError(`--${key} expects a number`);
      out.numbers[key] = n;
      continue;
    }
    if (strings.has(key)) {
      let value = inline;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value = next;
          i++;
        } else if (optional.has(key)) value = "";
        else throw new ArgError(`--${key} expects a value`);
      }
      push(key, value);
      continue;
    }
    throw new ArgError(`unknown option --${key}`);
  }
  return out;
}

export function usageLine(spec: ArgSpec, descriptions: Record<string, string>): string {
  const names = [...(spec.flags ?? []), ...(spec.strings ?? []), ...(spec.numbers ?? [])];
  const width = Math.max(...names.map((n) => n.length), 4) + 2;
  return names.map((n) => `  --${n.padEnd(width)}${descriptions[n] ?? ""}`).join("\n");
}
