/**
 * Grounding extension
 *
 * Provides an on-demand `grounding` tool that returns:
 *   - Local time, date, IANA timezone, UTC offset
 *   - Approximate IP-based location (city/region/country, no lat/lon)
 *   - Network: { type, ssid, signalDbm, trust }
 *       - type "wifi" with ssid in trusted list → trust: "trusted"
 *       - type "wifi" with other ssid          → trust: "public" (hostile)
 *       - type "wifi" with hidden/null ssid    → trust: "unknown"
 *       - type "cellular" (no wifi)            → trust: "unknown", unstable
 *
 * Storage:
 *   ~/.pi/agent/cache/grounding.json — { location (24h TTL), network (5min TTL) }
 *   ~/.pi/agent/grounding.json       — { trusted_ssids: [...] }, user-edited
 *
 * Call once per task that depends on "when" or "where" — do not call every
 * turn. Defaults return 30-min-rounded time (cache-friendly); pass
 * `precision: "precise"` for seconds, `refreshLocation: true` to bypass
 * the 24h location cache. Network trust is re-classified on every call from
 * the current config, so edits to trusted_ssids take effect immediately.
 *
 * Failure policy: every external call is best-effort and timeout-bounded.
 * Returns `null` fields and a `warnings` array; never throws.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------- constants ----------

const CACHE_PATH = join(homedir(), ".pi", "agent", "cache", "grounding.json");
const CONFIG_PATH = join(homedir(), ".pi", "agent", "grounding.json");

const LOCATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NETWORK_TTL_MS = 5 * 60 * 1000; // 5 minutes (was WIFI_TTL_MS)
const TIME_PRECISION_MS = 30 * 60 * 1000; // 30 min rounding bucket
const FETCH_TIMEOUT_MS = 5000;
const WIFI_TIMEOUT_MS = 2000;

// ---------- types ----------

type CachedLocation = { city: string; region: string; country: string; fetchedAt: string };
type CachedNetwork = {
	type: "wifi" | "cellular";
	ssid: string | null;
	signalDbm: number | null;
	trust: "trusted" | "public" | "unknown";
	fetchedAt: string;
};
type CacheFile = { location?: CachedLocation | null; network?: CachedNetwork | null };

type GroundingConfig = {
	trusted_ssids: string[];
};

type TimeInfo = {
	iso: string; // YYYY-MM-DDTHH:MM[:SS] (no seconds when rounded)
	date: string; // YYYY-MM-DD
	weekday: string; // "Sunday"
	timezone: string; // IANA
	utcOffset: string; // ±HH:MM
	rounded: boolean;
};

type GroundingResult = {
	time: TimeInfo;
	location: CachedLocation | null;
	network: CachedNetwork | null;
	warnings: string[];
};

// ---------- cache ----------

function readCache(): CacheFile {
	try {
		if (!existsSync(CACHE_PATH)) return {};
		return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as CacheFile;
	} catch {
		return {};
	}
}

function writeCache(cache: CacheFile): void {
	try {
		mkdirSync(join(homedir(), ".pi", "agent", "cache"), { recursive: true });
		writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
	} catch {
		// best-effort
	}
}

function isFresh(iso: string | undefined, ttlMs: number): boolean {
	if (!iso) return false;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return false;
	return Date.now() - t < ttlMs;
}

// ---------- config ----------

function readConfig(): GroundingConfig {
	try {
		if (!existsSync(CONFIG_PATH)) return { trusted_ssids: [] };
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<GroundingConfig>;
		return {
			trusted_ssids: Array.isArray(raw.trusted_ssids) ? raw.trusted_ssids.filter((s): s is string => typeof s === "string") : [],
		};
	} catch {
		// Malformed config should never break a tool call — fail closed to "all public"
		return { trusted_ssids: [] };
	}
}

function classifySsid(ssid: string | null, trusted: string[]): "trusted" | "public" | "unknown" {
	if (!ssid) return "unknown";
	return trusted.includes(ssid) ? "trusted" : "public";
}

// ---------- time ----------

function getTimeInfo(precision: "approx" | "precise"): TimeInfo {
	const now = new Date();
	const rounded =
		precision === "approx"
			? new Date(Math.floor(now.getTime() / TIME_PRECISION_MS) * TIME_PRECISION_MS)
			: now;

	const iana = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const weekday = rounded.toLocaleDateString("en-US", { weekday: "long", timeZone: iana });
	const date = rounded.toLocaleDateString("en-CA", { timeZone: iana }); // YYYY-MM-DD
	const hh = String(rounded.getHours()).padStart(2, "0");
	const mm = String(rounded.getMinutes()).padStart(2, "0");
	const ss = String(rounded.getSeconds()).padStart(2, "0");
	const local = `${date}T${hh}:${mm}${precision === "approx" ? "" : `:${ss}`}`;

	// Compute UTC offset of the *device* (not the rounded value, which is just a
	// 30-min bucket and would give the same offset as `now` anyway).
	const offsetMin = -now.getTimezoneOffset();
	const sign = offsetMin >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMin);
	const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;

	return { iso: local, date, weekday, timezone: iana, utcOffset: offset, rounded: precision === "approx" };
}

// ---------- location ----------

async function fetchLocation(): Promise<Omit<CachedLocation, "fetchedAt"> | null> {
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(
			"http://ip-api.com/json/?fields=status,country,regionName,city",
			{ signal: ctrl.signal },
		);
		clearTimeout(timer);
		if (!res.ok) return null;
		const j = (await res.json()) as { status?: string; country?: string; regionName?: string; city?: string };
		if (j.status !== "success") return null;
		if (!j.city || !j.country) return null;
		return { city: j.city, region: j.regionName ?? "", country: j.country };
	} catch {
		return null;
	}
}

// ---------- network (wifi or cellular fallback) ----------

// Returns just the raw observed facts; trust is classified at read time so
// config edits take effect without a cache reset.
type RawNetwork = { type: "wifi" | "cellular"; ssid: string | null; signalDbm: number | null };

function fetchRawNetwork(): RawNetwork | null {
	try {
		const out = execFileSync("termux-wifi-connectioninfo", {
			timeout: WIFI_TIMEOUT_MS,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const j = JSON.parse(out) as { ssid?: string; ssid_hidden?: boolean; rssi?: number };
		if (j.ssid && !j.ssid_hidden) {
			return { type: "wifi", ssid: j.ssid, signalDbm: typeof j.rssi === "number" ? j.rssi : null };
		}
		// Connected to a wifi with no broadcasted SSID (hidden) — treat as unknown wifi
		// rather than cellular, since the link layer IS wifi. Trust will be "unknown".
		if (!j.ssid_hidden) {
			// Termux returned a payload but no ssid and not hidden — likely not associated
			return null;
		}
		return { type: "wifi", ssid: null, signalDbm: typeof j.rssi === "number" ? j.rssi : null };
	} catch {
		// termux-wifi-connectioninfo unavailable or failed → no wifi.
		// Per the user's mental model: "if no wifi and we're talking, it's cellular."
		return { type: "cellular", ssid: null, signalDbm: null };
	}
}

// ---------- assemble ----------

async function getGrounding(opts: {
	precision: "approx" | "precise";
	refreshLocation: boolean;
}): Promise<GroundingResult> {
	const time = getTimeInfo(opts.precision);
	const cache = readCache();
	const warnings: string[] = [];

	// Location
	let location: CachedLocation | null = cache.location ?? null;
	if (opts.refreshLocation || !isFresh(location?.fetchedAt, LOCATION_TTL_MS)) {
		const fresh = await fetchLocation();
		if (fresh) {
			location = { ...fresh, fetchedAt: new Date().toISOString() };
			cache.location = location;
			writeCache(cache);
		} else if (!location) {
			warnings.push("location unavailable");
		} else {
			warnings.push("location cache stale and refresh failed");
		}
	}

	// Network (no refresh knob exposed; the 5-min TTL is the design contract)
	const cfg = readConfig();
	let network: CachedNetwork | null = cache.network ?? null;
	if (!isFresh(network?.fetchedAt, NETWORK_TTL_MS)) {
		const fresh = fetchRawNetwork();
		if (fresh) {
			network = {
				type: fresh.type,
				ssid: fresh.ssid,
				signalDbm: fresh.signalDbm,
				trust: fresh.type === "wifi" ? classifySsid(fresh.ssid, cfg.trusted_ssids) : "unknown",
				fetchedAt: new Date().toISOString(),
			};
			cache.network = network;
			writeCache(cache);
		} else if (!network) {
			// silent — network absence is not a warning, just no data
		}
		// else: keep stale value
	} else {
		// Cache is fresh — but trust depends on the current config (user may have
		// edited ~/.pi/agent/grounding.json since the cache was written). Re-classify
		// without touching the cache file.
		if (network && network.type === "wifi") {
			network = { ...network, trust: classifySsid(network.ssid, cfg.trusted_ssids) };
		}
	}

	return { time, location, network, warnings };
}

// ---------- extension ----------

export default function grounding(pi: ExtensionAPI) {
	// Tool: on-demand grounding. Auto-inject was tried and removed — it bloated
	// the system prompt on every turn for context the soul can fetch on demand.
	pi.registerTool({
		name: "grounding",
		label: "Grounding",
		description:
			"Get current local time/date, IANA timezone + UTC offset, approximate IP-based location (city/region/country, no lat/lon), and network state (wifi or cellular with trust classification). " +
			"Use this when the answer depends on 'when' or 'where' (judging staleness, timezone-aware math, location-conditional behavior, network-trust decisions). " +
			"By default returns 30-min-rounded time (cache-friendly). Pass precision:\"precise\" for seconds, or refreshLocation:true to bypass the 24h location cache. " +
			"Network trust is derived from ~/.pi/agent/grounding.json#trusted_ssids — wifi in that list is 'trusted', any other ssid is 'public' (hostile), no-wifi is treated as 'cellular' (unstable).",
		parameters: Type.Object({
			precision: Type.Optional(Type.Union([Type.Literal("approx"), Type.Literal("precise")])),
			refreshLocation: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params) {
			const precision = (params.precision as "approx" | "precise" | undefined) ?? "approx";
			const refreshLocation = params.refreshLocation === true;
			const g = await getGrounding({ precision, refreshLocation });
			const result = {
				time: g.time,
				location: g.location,
				network: g.network,
				warnings: g.warnings,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});
}
