import { lookupZip, DATA_VERSION } from "../shared/zones";
import { ZONE_CODES, ZONE_META, describeZone } from "../shared/zone-meta";
import { CATEGORIES, PLANTS, plantsForZone, getPlant, fitForZone, plantingCalendar, type Fit } from "../shared/plants";
import { state, subscribe, update, type State } from "./store";
import { addToPlan, removeFromPlan, updatePlanItem, setLocation, useMyLocation, clearPlan, exportPlan, AppError } from "./app";
import { TOOLS, type WebMcpStatus } from "./webmcp";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function fmtMMDD(mmdd: string): string {
  const [m, d] = mmdd.split("-").map(Number);
  return new Date(Date.UTC(2024, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function toast(msg: string, kind: "ok" | "err" = "ok") {
  const el = $("#toast");
  el.textContent = msg;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => (el.hidden = true), 3200);
}

function guard(fn: () => unknown) {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch((e) => toast(e instanceof Error ? e.message : String(e), "err"));
  } catch (e) {
    if (e instanceof AppError) toast(e.message, "err");
    else throw e;
  }
}

// ---------- renderers ----------

function renderZoneCard(s: State) {
  const el = $("#zone-card");
  const l = s.zip ? lookupZip(s.zip) : null;
  if (!l) {
    el.style.removeProperty("--zone-color");
    el.innerHTML = `
      <div class="zone-empty">
        <div class="zone-big muted">?</div>
        <p class="muted">Enter a ZIP code to see its zone, or ask your agent.</p>
        <p class="muted small">${PLANTS.length} plants · ${(40502).toLocaleString()} ZIP codes · USDA PHZM ${DATA_VERSION}</p>
      </div>`;
    return;
  }
  const m = l.meta;
  el.style.setProperty("--zone-color", m.color);
  el.innerHTML = `
    <div class="zone-head">
      <div>
        <div class="eyebrow">ZIP ${l.zip}</div>
        <div class="zone-big">Zone ${l.zone}</div>
      </div>
      <div class="zone-swatch" aria-hidden="true"></div>
    </div>
    <dl class="zone-facts">
      <div><dt>Avg. annual extreme min</dt><dd>${m.minF}° to ${m.maxF}°F <span class="muted">(${m.minC}° to ${m.maxC}°C)</span></dd></div>
      <div><dt>Typical last spring frost</dt><dd>${m.lastFrost ? `${fmtMMDD(m.lastFrost.from)} – ${fmtMMDD(m.lastFrost.to)}` : "Rare / none"}</dd></div>
      <div><dt>Typical first fall frost</dt><dd>${m.firstFrost ? `${fmtMMDD(m.firstFrost.from)} – ${fmtMMDD(m.firstFrost.to)}` : "Rare / none"}</dd></div>
      <div><dt>Frost-free season</dt><dd>≈ ${m.seasonDays} days</dd></div>
    </dl>
    <p class="small muted">${esc(describeZone(m))} Frost windows are estimates.</p>`;
}

function renderZoneStrip(s: State) {
  const el = $("#zone-strip");
  el.innerHTML = ZONE_CODES.map((z) => {
    const m = ZONE_META[z];
    const active = s.zone === z;
    return `<button type="button" class="zone-cell${active ? " active" : ""}" style="--c:${m.color}" data-zone="${z}" title="Zone ${z}: ${m.minF} to ${m.maxF} °F" aria-pressed="${active}"><span>${z}</span></button>`;
  }).join("");
}

function fitLabel(fit: Fit) {
  return fit === "great" ? "Great fit" : fit === "stretch" ? "Stretch" : "Not recommended";
}

function renderChips(s: State) {
  const el = $("#category-chips");
  const cats = ["all", ...CATEGORIES] as const;
  el.innerHTML = cats
    .map((c) => `<button type="button" class="chip${s.category === c ? " active" : ""}" data-cat="${c}" aria-pressed="${s.category === c}">${c === "all" ? "All" : c[0].toUpperCase() + c.slice(1) + "s"}</button>`)
    .join("");
  const search = $<HTMLInputElement>("#plant-search");
  if (search.value !== s.query) search.value = s.query;
}

function renderPlants(s: State) {
  const el = $("#plant-grid");
  const sub = $("#plants-sub");
  const inPlan = new Set(s.plan.map((i) => i.slug));
  const cat = s.category === "all" ? undefined : s.category;
  const q = s.query.trim().toLowerCase();
  if (!s.zone) {
    sub.textContent = "Pick a ZIP to rate these for your zone. Showing all plants.";
    const list = PLANTS.filter((p) => !cat || p.category === cat).filter((p) => !q || p.name.toLowerCase().includes(q) || p.notes.toLowerCase().includes(q));
    el.innerHTML = list.map((p) => plantCard(p.slug, p.name, p.category, p.lifecycle, null, `Grows in zones ${p.growZones[0]}–${p.growZones[1]}.`, inPlan.has(p.slug))).join("");
    return;
  }
  const rows = plantsForZone(s.zone, { category: cat, query: q || undefined, includeNotRecommended: true });
  const good = rows.filter((r) => r.fit !== "not-recommended").length;
  sub.textContent = `${good} of ${rows.length} shown plants fit zone ${s.zone}.`;
  el.innerHTML = rows.map((r) => plantCard(r.plant.slug, r.plant.name, r.plant.category, r.plant.lifecycle, r.fit, r.reason + (r.perennialHere ? " Perennial here." : ""), inPlan.has(r.plant.slug))).join("");
}

function plantCard(slug: string, name: string, category: string, lifecycle: string, fit: Fit | null, reason: string, inPlan: boolean) {
  const p = getPlant(slug)!;
  return `
  <article class="plant" data-fit="${fit ?? "none"}">
    <header>
      <h3>${esc(name)}</h3>
      ${fit ? `<span class="fit fit-${fit}">${fitLabel(fit)}</span>` : ""}
    </header>
    <p class="meta muted small">${esc(category)} · ${esc(lifecycle)} · ${p.daysToMaturity < 365 ? `${p.daysToMaturity} days` : "multi-year"} · ${p.sun} sun</p>
    <p class="small">${esc(reason)}</p>
    <p class="small muted">${esc(p.notes)}</p>
    <button type="button" class="btn btn-sm ${inPlan ? "" : "btn-primary"}" data-add="${slug}">${inPlan ? "+ Add another" : "Add to plan"}</button>
  </article>`;
}

function renderPlan(s: State) {
  const el = $("#plan-list");
  if (s.plan.length === 0) {
    el.innerHTML = `<li class="muted small empty">Nothing planned yet. Add plants below, or ask your agent: <em>"Plan a salsa garden for my zone."</em></li>`;
    return;
  }
  el.innerHTML = s.plan
    .map((i) => {
      const p = getPlant(i.slug)!;
      const fit = s.zone ? fitForZone(p, s.zone) : null;
      return `<li class="plan-item" data-slug="${i.slug}">
        <div class="plan-main">
          <strong>${esc(p.name)}</strong>
          ${fit ? `<span class="fit fit-${fit.fit}">${fitLabel(fit.fit)}</span>` : ""}
          <span class="tag">${i.addedBy === "agent" ? "🤖 agent" : "🧑 you"}</span>
        </div>
        ${i.notes ? `<div class="small muted">${esc(i.notes)}</div>` : ""}
        <div class="row">
          <label class="small">Qty <input type="number" min="1" max="999" value="${i.quantity}" data-qty="${i.slug}" class="qty" /></label>
          <button type="button" class="btn btn-sm" data-remove="${i.slug}" aria-label="Remove ${esc(p.name)}">Remove</button>
        </div>
      </li>`;
    })
    .join("");
}

function renderActivity(s: State) {
  const el = $("#activity-log");
  if (s.activity.length === 0) {
    el.innerHTML = `<li class="muted small empty">No tool calls yet.</li>`;
    return;
  }
  el.innerHTML = s.activity
    .map(
      (a) => `<li class="act ${a.ok ? "ok" : "err"}">
        <div class="row between"><code>${esc(a.tool)}</code><time class="small muted" datetime="${a.at}">${new Date(a.at).toLocaleTimeString()}</time></div>
        <div class="small muted mono">${esc(JSON.stringify(a.input ?? {}))}</div>
        <div class="small">${a.ok ? "→" : "✕"} ${esc(a.summary)}</div>
      </li>`,
    )
    .join("");
}

function renderTools() {
  const el = $("#tool-list");
  el.innerHTML = TOOLS.map((t) => {
    const ro = t.annotations?.readOnlyHint;
    const props = Object.entries(((t.inputSchema as { properties?: Record<string, { type?: string; description?: string }> })?.properties) ?? {});
    return `<details class="tool">
      <summary><code>${esc(t.name)}</code> <span class="tag ${ro ? "ro" : "rw"}">${ro ? "read" : "write"}</span></summary>
      <p class="small">${esc(t.description)}</p>
      ${props.length ? `<ul class="small params">${props.map(([k, v]) => `<li><code>${esc(k)}</code> <span class="muted">${esc(v.type ?? "")}</span> ${v.description ? "— " + esc(v.description) : ""}</li>`).join("")}</ul>` : `<p class="small muted">No parameters.</p>`}
    </details>`;
  }).join("");
}

function renderApiDocs() {
  const o = location.origin;
  $("#api-docs").textContent = [
    `# Zone for a ZIP`,
    `curl ${o}/api/v1/zone/97330`,
    ``,
    `# All zones with ZIP counts`,
    `curl ${o}/api/v1/zones`,
    ``,
    `# Zone details + sample ZIPs`,
    `curl ${o}/api/v1/zones/7b`,
    ``,
    `# Nearest ZIPs and zones to coordinates`,
    `curl "${o}/api/v1/nearest?lat=44.56&lon=-123.26"`,
    ``,
    `# Plants rated for a zone`,
    `curl "${o}/api/v1/plants?zone=7b&category=pepper"`,
    ``,
    `# Planting calendar`,
    `curl "${o}/api/v1/calendar?zone=7b&plants=tomato,jalapeno"`,
    ``,
    `# OpenAPI + llms.txt`,
    `curl ${o}/api/v1/openapi.json`,
    `curl ${o}/llms.txt`,
  ].join("\n");
}

export function renderWebMcpBanner(status: WebMcpStatus) {
  const el = $("#webmcp-banner");
  el.hidden = false;
  if (!status.supported) {
    el.dataset.kind = "warn";
    el.innerHTML = `<strong>WebMCP not detected in this browser.</strong> The page still works for humans. To let an agent use the ${TOOLS.length} tools, open it in the <a href="https://learn.chatgpt.com/docs/webmcp" rel="noopener">ChatGPT desktop app browser</a> or Chrome with <code>chrome://flags/#enable-webmcp-testing</code> enabled.`;
  } else if (status.error) {
    el.dataset.kind = "warn";
    el.innerHTML = `<strong>WebMCP detected</strong>, but ${status.registered}/${TOOLS.length} tools registered. Last error: <code>${esc(status.error)}</code>`;
  } else {
    el.dataset.kind = "ok";
    el.innerHTML = `<strong>WebMCP active:</strong> ${status.registered} tools registered on this page. Ask your agent to look up a zone or plan a garden and watch the Agent activity panel.`;
  }
}

// ---------- wiring ----------

export function mountUi() {
  renderTools();
  renderApiDocs();

  const rerender = (s: State) => {
    renderZoneCard(s);
    renderZoneStrip(s);
    renderChips(s);
    renderPlants(s);
    renderPlan(s);
    renderActivity(s);
  };
  subscribe((s) => {
    if (document.startViewTransition) {
      const t = document.startViewTransition(() => rerender(s));
      t.ready.catch(() => {});
      t.finished.catch(() => {});
    } else rerender(s);
  });
  rerender(state);

  $("#geo-btn").addEventListener("click", () => {
    const btn = $("#geo-btn") as HTMLButtonElement;
    btn.disabled = true;
    useMyLocation()
      .then((r) => toast(`Nearest ZIP ${r.zip}: zone ${r.zone}`))
      .catch((e) => toast(e.message, "err"))
      .finally(() => (btn.disabled = false));
  });

  $("#zone-strip").addEventListener("click", (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-zone]");
    if (!cell) return;
    const z = cell.dataset.zone!;
    const m = ZONE_META[z as keyof typeof ZONE_META];
    toast(`Zone ${z}: ${m.minF}° to ${m.maxF}°F. Enter a ZIP to select a location.`);
  });

  $("#category-chips").addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-cat]");
    if (chip) update({ category: chip.dataset.cat as State["category"] });
  });
  $<HTMLInputElement>("#plant-search").addEventListener("input", (e) => update({ query: (e.target as HTMLInputElement).value }));

  $("#plant-grid").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-add]");
    if (b) guard(() => addToPlan(b.dataset.add!, 1, "", "human"));
  });

  $("#plan-list").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-remove]");
    if (b) guard(() => removeFromPlan(b.dataset.remove!));
  });
  $("#plan-list").addEventListener("change", (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>("[data-qty]");
    if (input) guard(() => updatePlanItem(input.dataset.qty!, { quantity: Number(input.value) }));
  });

  $("#clear-btn").addEventListener("click", () => guard(() => clearPlan(true).then((r) => r.cleared && toast(`Cleared ${r.cleared} plants`))));
  $("#export-btn").addEventListener("click", () => {
    const md = exportPlan("markdown");
    navigator.clipboard?.writeText(md).then(() => toast("Plan copied as Markdown")).catch(() => toast("Clipboard blocked; see console", "err"));
    console.log(md);
  });
  $("#calendar-btn").addEventListener("click", () => {
    if (!state.zone) return toast("Pick a ZIP first.", "err");
    const list = state.plan.length ? state.plan.map((i) => getPlant(i.slug)!) : PLANTS.slice(0, 12);
    const cal = plantingCalendar(state.zone, list);
    $("#calendar-sub").textContent = cal.lastFrostEstimate
      ? `Zone ${cal.zone}, estimated last spring frost ${cal.lastFrostEstimate}. ${state.plan.length ? "Your plan." : "Sample plants (plan is empty)."}`
      : `Zone ${cal.zone} is essentially frost-free.`;
    $("#calendar-body").innerHTML = `<table class="cal"><thead><tr><th>Plant</th><th>Fit</th><th>Start indoors</th><th>Transplant</th><th>Direct sow</th><th>First harvest</th></tr></thead><tbody>${cal.entries
      .map(
        (e) =>
          `<tr><td>${esc(e.plant)}</td><td><span class="fit fit-${e.fit}">${fitLabel(e.fit)}</span></td><td>${e.startIndoors ?? "—"}</td><td>${e.transplantOutdoors ?? "—"}</td><td>${e.directSow ?? "—"}</td><td>${e.estimatedFirstHarvest ?? "—"}</td></tr>`,
      )
      .join("")}</tbody></table>`;
    $<HTMLDialogElement>("#calendar-dialog").showModal();
  });
}

export function handleZipSubmit(zip: string) {
  const err = $("#zip-error");
  try {
    const r = setLocation(zip, { by: "human" });
    err.hidden = true;
    return r;
  } catch (e) {
    if (e instanceof AppError) {
      err.textContent = e.message;
      err.hidden = false;
    }
    throw e;
  }
}
