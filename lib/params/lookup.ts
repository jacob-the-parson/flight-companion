// Looking a parameter up in PX4's reference, by name or by what it does. One
// implementation, used by the terminal tool, the MCP server and the tools the
// app runs in the browser. Every word that comes back is PX4's.
import { looksLikeArduPilot } from './analysis.ts';
import type { ParamMeta, ParamReference } from './model.ts';

export function describeParameter(name: string, m: ParamMeta): Record<string, unknown> {
  return {
    name,
    what_it_is: m.short,
    ...(m.long ? { more: m.long } : null),
    group: m.group,
    type: m.type,
    ...(m.unit ? { unit: m.unit } : null),
    ...(m.default !== undefined ? { firmware_default: m.default } : null),
    ...(m.default_means ? { firmware_default_means: m.default_means } : null),
    ...(m.min !== undefined ? { lowest: m.min } : null),
    ...(m.max !== undefined ? { highest: m.max } : null),
    ...(m.increment !== undefined ? { step: m.increment } : null),
    // PX4 writes the keys of a decimal parameter as "1.0"; they are given as numbers read
    ...(m.values ? { values: Object.fromEntries(Object.entries(m.values).map(([k, v]) => [String(Number(k)), v])) } : null),
    ...(m.bits ? { bits: m.bits } : null),
    takes_effect: m.reboot_required ? 'after the autopilot restarts' : 'at once',
  };
}

const about = (ref: ParamReference) => ({ firmware: ref.firmware, source: ref.source, licence: ref.licence });

export function explainParameters(names: string[], ref: ParamReference): Record<string, unknown> {
  return {
    schema: 'flight-companion/parameter-explained@1',
    reference: about(ref),
    parameters: names.map((raw) => {
      const name = raw.trim().toUpperCase();
      const m = ref.parameters[name] ?? ref.parameters[raw];
      if (m) return describeParameter(ref.parameters[name] ? name : raw, m);
      return {
        name: raw,
        in_the_reference: false,
        note: looksLikeArduPilot(name)
          ? `${ref.firmware} has no parameter by this name. It has the shape of an ArduPilot name. There is no table that turns one autopilot's names into the other's: look up in PX4's documentation which parameter does what this one was for.`
          : `${ref.firmware} has no parameter by this name. Use "search" to look for it by what it does.`,
      };
    }),
  };
}

export const SEARCH_LIMIT = 50;

export function searchParameters(text: string, ref: ParamReference): Record<string, unknown> {
  const q = text.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  const hits = Object.entries(ref.parameters).filter(([name, m]) => {
    const hay = `${name} ${m.short} ${m.long ?? ''} ${m.group}`.toLowerCase();
    return words.length > 0 && words.every((w) => hay.includes(w));
  });
  return {
    schema: 'flight-companion/parameter-search@1',
    reference: about(ref),
    looked_for: q,
    found: hits.length,
    shown: Math.min(hits.length, SEARCH_LIMIT),
    parameters: hits.slice(0, SEARCH_LIMIT).map(([name, m]) => describeParameter(name, m)),
  };
}
