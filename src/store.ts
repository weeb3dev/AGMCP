import type { ZoneCode } from "../shared/zone-meta";
import type { PlantCategory } from "../shared/plants";

export interface PlanItem {
  slug: string;
  quantity: number;
  notes: string;
  addedBy: "human" | "agent";
}

export interface ActivityEntry {
  id: number;
  at: string;
  tool: string;
  input: unknown;
  ok: boolean;
  summary: string;
}

export interface State {
  zip: string | null;
  zone: ZoneCode | null;
  category: PlantCategory | "all";
  query: string;
  plan: PlanItem[];
  activity: ActivityEntry[];
}

type Listener = (s: State) => void;

const KEY = "agmcp:v1";

function load(): Pick<State, "zip" | "zone" | "plan"> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { zip: null, zone: null, plan: [] };
}

const saved = load();
export const state: State = {
  zip: saved.zip ?? null,
  zone: saved.zone ?? null,
  category: "all",
  query: "",
  plan: saved.plan ?? [],
  activity: [],
};

const listeners = new Set<Listener>();
export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(patch: Partial<State>) {
  Object.assign(state, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify({ zip: state.zip, zone: state.zone, plan: state.plan }));
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(state);
}

let activityId = 0;
export function logActivity(entry: Omit<ActivityEntry, "id" | "at">) {
  const e: ActivityEntry = { id: ++activityId, at: new Date().toISOString(), ...entry };
  update({ activity: [e, ...state.activity].slice(0, 50) });
}
