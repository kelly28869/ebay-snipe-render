import { useState, useEffect, useRef, useCallback } from "react";

const BASE_SEARCH = "computer memory";
const ZIP_CODE = "08823";

const CONDITIONS = ["New", "Open Box", "Used", "Refurbished", "For Parts"];
const SORT_OPTIONS = [
  { label: "Newly Listed", value: "newly_listed" },
  { label: "Price: Low to High", value: "price_low" },
  { label: "Price: High to Low", value: "price_high" },
  { label: "Best Match", value: "best_match" },
];

const PRESET_CATEGORIES = [
  { label: "Type", keywords: ["DDR4", "PC4", "DDR5", "PC5"] },
  { label: "Size", keywords: ["4GB", "8GB", "16GB", "32GB"] },
  { label: "Brand", keywords: ["Samsung", "Hynix", "Micron", "Kingston", "Crucial", "Mixed Lot"] },
  { label: "Speed", keywords: ["3200", "2666", "2400", "2133"] },
];
const ALL_PRESETS = PRESET_CATEGORIES.flatMap(c => c.keywords);

const DEFAULT_PRICE_RULES = [
  { type: "DDR4", size: "4GB", speed: "All", maxPrice: 10 },
  { type: "DDR4", size: "8GB", speed: "2133", maxPrice: 25 },
  { type: "DDR4", size: "8GB", speed: "2400", maxPrice: 27 },
  { type: "DDR4", size: "8GB", speed: "2666", maxPrice: 30 },
  { type: "DDR4", size: "8GB", speed: "3200", maxPrice: 30 },
  { type: "DDR4", size: "16GB", speed: "2133", maxPrice: 48 },
  { type: "DDR4", size: "16GB", speed: "2400", maxPrice: 52 },
  { type: "DDR4", size: "16GB", speed: "2666", maxPrice: 60 },
  { type: "DDR4", size: "16GB", speed: "3200", maxPrice: 60 },
  { type: "DDR4", size: "32GB", speed: "2666", maxPrice: 110 },
  { type: "DDR4", size: "32GB", speed: "3200", maxPrice: 120 },
  { type: "DDR5", size: "8GB", speed: "All", maxPrice: 50 },
  { type: "DDR5", size: "16GB", speed: "All", maxPrice: 90 },
  { type: "DDR5", size: "32GB", speed: "All", maxPrice: 210 },
];

const EXCLUDED_BRANDS = ["GSKILL", "G.SKILL", "TIMETEC", "CORSAIR", "ELPIDA"];

const DEFAULT_CRITERIA = { keywords: [], minPrice: "", maxPrice: "", conditions: [], sortBy: "newly_listed", buyItNowOnly: true, freeShippingOnly: false };

function detectQuantityAndSize(title) {
  const t = title.toUpperCase();
  // Look for explicit NxM GB patterns first — this is the per-stick size
  const nxm = t.match(/(\d+)\s*[Xx]\s*(\d+)\s*GB/);
  if (nxm) {
    const qty = parseInt(nxm[1]);
    const perStick = parseInt(nxm[2]);
    if (qty >= 1 && qty <= 100 && perStick > 0) return { qty, perStickGB: perStick };
  }
  // Check for lot/kit/pack/quantity patterns
  const lotPatterns = [
    /\bLOT\s*(?:OF\s*)?(\d+)/i,
    /\bKIT\s*(?:OF\s*)?(\d+)/i,
    /\bSET\s*(?:OF\s*)?(\d+)/i,
    /\bBUNDLE\s*(?:OF\s*)?(\d+)/i,
    /\((\d+)\s*(?:PACK|PCS?|PIECES?|STICKS?|MODULES?|DIMMS?|COUNT|CT)\)/i,
    /\b(\d+)\s*(?:PACK|PCS?|PIECES?|STICKS?|MODULES?|DIMMS?|COUNT|CT)\b/i,
    /\bQTY\s*[:.]?\s*(\d+)/i,
    /\bQUANTITY\s*[:.]?\s*(\d+)/i,
    /\b(\d+)\s*(?:LOT|LOTS)\b/i,
    /\((\d+)\)/,  // bare number in parens like "(10)" if no other match
  ];
  for (const p of lotPatterns) {
    const m = t.match(p);
    if (m) {
      const n = parseInt(m[1]);
      // Skip if the number looks like a GB size or speed, not a quantity
      if (n >= 2 && n <= 200 && ![4, 8, 16, 32, 64, 128, 2133, 2400, 2666, 3200, 4800, 5600, 6000].includes(n)) {
        return { qty: n, perStickGB: null };
      }
    }
  }
  return { qty: 1, perStickGB: null };
}

function matchPriceRule(listing, rules) {
  const { title, totalPrice } = listing;
  if (!title || totalPrice === null || totalPrice === undefined) return null;
  const t = title.toUpperCase();
  const { qty, perStickGB } = detectQuantityAndSize(title);
  let bestMatch = null;
  let bestSpec = -1;

  for (const rule of rules) {
    const typeOk = t.includes(rule.type) || (rule.type === "DDR4" && t.includes("PC4")) || (rule.type === "DDR5" && t.includes("PC5"));
    if (!typeOk) continue;

    const ruleSizeNum = parseInt(rule.size.replace("GB", ""));

    // If we detected per-stick size (e.g. 2x16GB → 16), match against that
    // Otherwise fall back to finding any size mention in the title
    let sizeMatch = false;
    if (perStickGB !== null) {
      sizeMatch = (perStickGB === ruleSizeNum);
    } else {
      sizeMatch = !!t.match(new RegExp(`\\b${ruleSizeNum}\\s*GB\\b`, "i"));
    }
    if (!sizeMatch) continue;

    let speedOk = rule.speed === "All";
    if (!speedOk) speedOk = t.includes(rule.speed);
    if (!speedOk) continue;
    const spec = (rule.speed === "All" ? 0 : 1) + 2;
    if (spec > bestSpec) {
      bestSpec = spec;
      const adj = rule.maxPrice * qty;
      bestMatch = { ...rule, qty, totalPrice, adjustedMax: adj, underBudget: listing.shippingKnown === false ? false : totalPrice <= adj, savings: adj - totalPrice, perUnit: qty > 1 ? totalPrice / qty : null, shipUnknown: listing.shippingKnown === false };
    }
  }
  return bestMatch;
}

const CAT_COLORS = {
  Type: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", activeBg: "#dbeafe" },
  Size: { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", activeBg: "#dcfce7" },
  Brand: { bg: "#fef3c7", border: "#fde68a", text: "#92400e", activeBg: "#fef9c3" },
  Speed: { bg: "#fce7f3", border: "#fbcfe8", text: "#9d174d", activeBg: "#fdf2f8" },
};

function StatusPulse({ active }) {
  return (<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "#16a34a" : "#ccc", boxShadow: active ? "0 0 8px #16a34a66" : "none", animation: active ? "pulse 2s infinite" : "none" }} /><span style={{ fontSize: 11, color: active ? "#16a34a" : "#999", fontFamily: "'IBM Plex Mono', monospace", textTransform: "uppercase", letterSpacing: 2 }}>{active ? "Scanning" : "Idle"}</span></span>);
}

function TagInput({ tags, setTags }) {
  const [input, setInput] = useState(""); const inputRef = useRef(null);
  const tagCat = (tag) => { for (const c of PRESET_CATEGORIES) { if (c.keywords.map(k => k.toUpperCase()).includes(tag.toUpperCase())) return c.label; } return null; };
  const addTag = (tag) => { const c = tag.trim(); if (c && !tags.map(t => t.toUpperCase()).includes(c.toUpperCase())) setTags([...tags, c]); };
  const removeTag = (tag) => setTags(tags.filter(t => t.toUpperCase() !== tag.toUpperCase()));
  const addAllCat = (cat) => { const n = [...tags]; cat.keywords.forEach(k => { if (!n.map(t => t.toUpperCase()).includes(k.toUpperCase())) n.push(k); }); setTags(n); };
  const addAll = () => { const n = [...tags]; ALL_PRESETS.forEach(k => { if (!n.map(t => t.toUpperCase()).includes(k.toUpperCase())) n.push(k); }); setTags(n); };
  const isActive = (k) => tags.map(t => t.toUpperCase()).includes(k.toUpperCase());

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 10px", minHeight: 42, background: "#fff", cursor: "text" }} onClick={() => inputRef.current?.focus()}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#f3f4f6", border: "1px solid #d1d5db", color: "#374151", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>📍 {BASE_SEARCH} · {ZIP_CODE} 🇺🇸</span>
        {tags.map(tag => {
          const cat = tagCat(tag); const colors = cat ? CAT_COLORS[cat] : { bg: "#f3f4f6", border: "#d1d5db", text: "#374151" };
          return (<span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>{tag}<span onClick={() => removeTag(tag)} style={{ cursor: "pointer", opacity: 0.5, fontSize: 14, marginLeft: 2 }}>×</span></span>);
        })}
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); setInput(""); } else if (e.key === "Backspace" && !input && tags.length) setTags(tags.slice(0, -1)); }} placeholder={tags.length ? "" : "Add filters..."} style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: "#333", flex: 1, minWidth: 80, padding: "2px 0" }} />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button onClick={addAll} style={{ background: "#166534", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>+ Add All</button>
        {tags.length > 0 && <button onClick={() => setTags([])} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>Clear All</button>}
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {PRESET_CATEGORIES.map(cat => {
          const colors = CAT_COLORS[cat.label]; const allActive = cat.keywords.every(k => isActive(k));
          return (<div key={cat.label}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}><span style={{ fontSize: 9, color: "#bbb", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>{cat.label}</span><button onClick={() => addAllCat(cat)} style={{ background: allActive ? "#f3f4f6" : colors.bg, border: `1px solid ${allActive ? "#e5e7eb" : colors.border}`, color: allActive ? "#aaa" : colors.text, padding: "1px 7px", borderRadius: 10, cursor: "pointer", fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{allActive ? "✓ All" : "+ All"}</button></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{cat.keywords.map(k => { const a = isActive(k); return <button key={k} onClick={() => a ? removeTag(k) : addTag(k)} style={{ background: a ? colors.activeBg : "#f9fafb", border: `1px solid ${a ? colors.border : "#e5e7eb"}`, color: a ? colors.text : "#999", padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", fontWeight: a ? 600 : 400 }}>{a ? "✓ " : ""}{k}</button>; })}</div>
          </div>);
        })}
      </div>
    </div>
  );
}

function PriceRulesTable({ rules, setRules }) {
  const [show, setShow] = useState(false); const [editIdx, setEditIdx] = useState(null); const [editVal, setEditVal] = useState("");
  const grouped = {}; rules.forEach((r, i) => { if (!grouped[r.type]) grouped[r.type] = []; grouped[r.type].push({ ...r, idx: i }); });
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <label style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>Price Rules (per stick, incl. shipping)</label>
        <button onClick={() => setShow(!show)} style={{ background: "none", border: "none", color: "#16a34a", cursor: "pointer", fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{show ? "Hide" : "Show"} ({rules.length})</button>
      </div>
      {show && (
        <div style={{ background: "#f9fafb", borderRadius: 10, border: "1px solid #f3f4f6", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
            <thead><tr style={{ background: "#f3f4f6" }}><th style={thS}>Type</th><th style={thS}>Size</th><th style={thS}>Speed</th><th style={{ ...thS, textAlign: "right" }}>Max $/ea</th></tr></thead>
            <tbody>{Object.entries(grouped).map(([type, items]) => items.map((r, j) => (
              <tr key={r.idx} style={{ borderTop: j === 0 && type !== "DDR4" ? "2px solid #e5e7eb" : "1px solid #f0f0f0" }}>
                {j === 0 && <td style={{ ...tdS, fontWeight: 700, color: type === "DDR5" ? "#7c3aed" : "#1e40af" }} rowSpan={items.length}>{type}</td>}
                <td style={tdS}>{r.size}</td><td style={{ ...tdS, color: r.speed === "All" ? "#999" : "#555" }}>{r.speed === "All" ? "Any" : r.speed}</td>
                <td style={{ ...tdS, textAlign: "right" }}>{editIdx === r.idx ? <input type="number" value={editVal} autoFocus onChange={e => setEditVal(e.target.value)} onBlur={() => { const v = parseFloat(editVal); if (!isNaN(v) && v > 0) { const nr = [...rules]; nr[r.idx] = { ...nr[r.idx], maxPrice: v }; setRules(nr); } setEditIdx(null); }} onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }} style={{ width: 50, border: "1px solid #16a34a", borderRadius: 4, padding: "2px 4px", fontSize: 11, textAlign: "right", fontFamily: "inherit", outline: "none" }} /> : <span onClick={() => { setEditIdx(r.idx); setEditVal(String(r.maxPrice)); }} style={{ cursor: "pointer", color: "#16a34a", fontWeight: 700, borderBottom: "1px dashed #16a34a44" }}>${r.maxPrice}</span>}</td>
              </tr>)))}</tbody>
          </table>
          <div style={{ padding: "8px 10px", fontSize: 9, color: "#888", textAlign: "center", borderTop: "1px solid #f0f0f0" }}>Click price to edit · Qty auto-multiplies max · Total = price + shipping to {ZIP_CODE}</div>
        </div>
      )}
    </div>
  );
}
const thS = { padding: "6px 10px", textAlign: "left", fontSize: 9, color: "#999", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 };
const tdS = { padding: "5px 10px", color: "#555" };

export default function App() {
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [priceRules, setPriceRules] = useState(DEFAULT_PRICE_RULES);
  const [listings, setListings] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanInterval, setScanInterval] = useState(10);
  const [lastScan, setLastScan] = useState(null);
  const [error, setError] = useState(null);
  const [scanCount, setScanCount] = useState(0);
  const [newIds, setNewIds] = useState(new Set());
  const [tab, setTab] = useState("monitor");
  const [history, setHistory] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [filterMode, setFilterMode] = useState("all");
  const [apiStats, setApiStats] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const onResize = () => { const m = window.innerWidth <= 768; setIsMobile(m); if (!m && !sidebarOpen) setSidebarOpen(true); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sidebarOpen]);
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);
  const audioCtxRef = useRef(null);

  // Unlock audio on user gesture (needed for iOS/iPad)
  const unlockAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    // Play a silent buffer to fully unlock on iOS
    const buf = audioCtxRef.current.createBuffer(1, 1, 22050);
    const src = audioCtxRef.current.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtxRef.current.destination);
    src.start(0);
  }, []);

  const playNotification = useCallback(() => {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.setValueAtTime(1320, ctx.currentTime + 0.15);
      g.gain.setValueAtTime(0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      o.start(); o.stop(ctx.currentTime + 0.4);
    } catch (e) {}
  }, []);

  // Client-side keyword filter: listing title must contain ANY selected keyword
  const matchesKeywords = useCallback((title) => {
    if (!criteria.keywords.length) return true;
    const t = title.toUpperCase();
    return criteria.keywords.some(k => t.includes(k.toUpperCase()));
  }, [criteria.keywords]);

  const runScan = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Always search broadly — keywords filter client-side
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: BASE_SEARCH,
          minPrice: criteria.minPrice || undefined,
          maxPrice: criteria.maxPrice || undefined,
          conditions: criteria.conditions,
          sortBy: criteria.sortBy,
          buyItNowOnly: criteria.buyItNowOnly,
          freeShippingOnly: criteria.freeShippingOnly,
          zipCode: ZIP_CODE,
          limit: 50,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Server error ${res.status}`); }
      const data = await res.json();
      if (data.apiStats) setApiStats(data.apiStats);

      if (data.listings?.length > 0) {
        // Filter by keywords client-side (ANY match)
        const matched = data.listings.filter(l => matchesKeywords(l.title));
        const prevIds = new Set(listings.map(l => l.id));
        const freshNew = new Set();
        matched.forEach(l => { if (!prevIds.has(l.id)) freshNew.add(l.id); });
        if (freshNew.size > 0 && scanCount > 0) {
          playNotification();
          setNewIds(freshNew);
          setTimeout(() => setNewIds(new Set()), 8000);
          if (Notification.permission === "granted") {
            new Notification(`eBaySnipe: ${freshNew.size} new listing(s)!`, { body: matched.find(l => freshNew.has(l.id))?.title || "" });
          }
        }
        setListings(matched);
        setHistory(prev => [{ time: new Date(), count: matched.length, keywords: criteria.keywords.length ? criteria.keywords.join(", ") : "all" }, ...prev.slice(0, 49)]);
      } else { setListings([]); }
      setLastScan(new Date()); setScanCount(c => {
        const next = c + 1;
        // Update from real eBay rate limit every 10 scans
        if (next % 10 === 0) {
          fetch("/api/rate-limit").then(r => r.json()).then(d => {
            if (d.ebay) setApiStats({ callsToday: d.ebay.count, limit: d.ebay.limit, remaining: d.ebay.remaining });
          }).catch(() => {});
        } else if (data.apiStats) {
          // Use local server count between eBay refreshes
          setApiStats(prev => prev?.limit > 5000 ? prev : { callsToday: data.apiStats.callsToday, limit: data.apiStats.limit, remaining: data.apiStats.remaining });
        }
        return next;
      }); setCountdown(scanInterval);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [criteria, listings, scanCount, scanInterval, playNotification, matchesKeywords]);

  const toggleScanning = useCallback(() => {
    if (scanning) { clearInterval(intervalRef.current); clearInterval(countdownRef.current); setScanning(false); setCountdown(null); }
    else {
      unlockAudio(); // Unlock AudioContext on user tap (required for iOS/iPad)
      setScanning(true); runScan();
      intervalRef.current = setInterval(runScan, scanInterval * 1000);
      countdownRef.current = setInterval(() => setCountdown(c => c > 0 ? c - 1 : scanInterval), 1000);
      if (Notification.permission === "default") Notification.requestPermission();
    }
  }, [scanning, scanInterval, runScan, unlockAudio]);

  useEffect(() => () => { clearInterval(intervalRef.current); clearInterval(countdownRef.current); }, []);
  useEffect(() => { if (scanning) { clearInterval(intervalRef.current); intervalRef.current = setInterval(runScan, scanInterval * 1000); setCountdown(scanInterval); } }, [scanInterval]);
  useEffect(() => {
    fetch("/api/rate-limit").then(r => r.json()).then(d => {
      if (d.ebay) setApiStats({ callsToday: d.ebay.count, limit: d.ebay.limit, remaining: d.ebay.remaining });
      else if (d.local) setApiStats({ callsToday: d.local.callsToday, limit: d.local.limit, remaining: d.local.remaining });
    }).catch(() => {});
  }, []);

  const updateCriteria = (k, v) => setCriteria(prev => ({ ...prev, [k]: v }));
  const toggleCondition = (c) => setCriteria(prev => ({ ...prev, conditions: prev.conditions.includes(c) ? prev.conditions.filter(x => x !== c) : [...prev.conditions, c] }));

  const enriched = listings.map(l => ({ ...l, rule: matchPriceRule(l, priceRules) }));
  const filtered = enriched.filter(l => { if (filterMode === "picks") return l.rule?.underBudget || (l.rule?.shipUnknown && l.rule.savings > 0); if (filterMode === "deals") return l.rule?.underBudget; if (filterMode === "maybe") return l.rule?.shipUnknown && l.rule.savings > 0; if (filterMode === "over") return l.rule && !l.rule.underBudget && !(l.rule.shipUnknown && l.rule.savings > 0); return true; });
  const dealCount = enriched.filter(l => l.rule?.underBudget).length;
  const maybeCount = enriched.filter(l => l.rule?.shipUnknown && l.rule.savings > 0).length;
  const picksCount = dealCount + maybeCount;
  const overCount = enriched.filter(l => l.rule && !l.rule.underBudget && !(l.rule.shipUnknown && l.rule.savings > 0)).length;

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", color: "#1a1a1a", fontFamily: "'IBM Plex Mono', 'SF Mono', monospace" }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dealPulse { 0% { box-shadow: 0 0 0 0 #16a34a33; } 50% { box-shadow: 0 0 0 6px #16a34a11; } 100% { box-shadow: 0 0 0 0 #16a34a33; } }
        ::selection { background: #bbf7d0; color: #14532d; }
        * { box-sizing: border-box; }
        input:focus, select:focus { outline: none; border-color: #16a34a !important; box-shadow: 0 0 0 3px #16a34a1a; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #e5e7eb", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg></div>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 18, color: "#111" }}>eBay<span style={{ color: "#16a34a" }}>Snipe</span></span>
          </div>
          <StatusPulse active={scanning} />
          <span style={{ fontSize: 10, background: "#eff6ff", color: "#1e40af", padding: "3px 8px", borderRadius: 20, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", border: "1px solid #bfdbfe" }}>🇺🇸 {ZIP_CODE}</span>
          {countdown !== null && scanning && <span style={{ fontSize: 11, color: "#999", fontFamily: "'IBM Plex Mono', monospace" }}>Next in <span style={{ color: "#16a34a", fontWeight: 600 }}>{countdown}s</span></span>}
        </div>
        <div style={{ display: "flex", gap: 4, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
          {["monitor", "history"].map(t => <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "#fff" : "transparent", border: "none", boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.08)" : "none", color: tab === t ? "#111" : "#999", padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textTransform: "capitalize", fontSize: 12, fontWeight: 500 }}>{t}</button>)}
        </div>
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 57px)", position: "relative" }}>
        {/* Sidebar Toggle */}
        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ position: "fixed", bottom: 20, left: sidebarOpen && !isMobile ? 370 : 10, zIndex: 100, background: sidebarOpen ? "#dc2626" : "#16a34a", color: "#fff", border: "none", width: 44, height: 44, borderRadius: 22, cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,0.25)", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", transition: "left 0.3s, background 0.3s" }}>{sidebarOpen ? "✕" : "☰"}</button>

        {/* Sidebar Overlay (mobile) */}
        {sidebarOpen && isMobile && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 49 }} />}

        {/* Sidebar */}
        <div style={{ width: sidebarOpen ? 360 : 0, minWidth: sidebarOpen ? 360 : 0, maxWidth: sidebarOpen ? "90vw" : 0, borderRight: sidebarOpen ? "1px solid #e5e7eb" : "none", padding: sidebarOpen ? 20 : 0, background: "#fff", flexShrink: 0, overflowY: "auto", overflowX: "hidden", transition: "all 0.3s", opacity: sidebarOpen ? 1 : 0, position: isMobile ? "fixed" : "relative", top: isMobile ? 57 : "auto", left: 0, bottom: 0, zIndex: isMobile ? 50 : "auto" }}>
          {apiStats && (
            <div style={{ marginBottom: 16, padding: 14, background: apiStats.remaining < 500 ? "#fef2f2" : apiStats.remaining < 1500 ? "#fefce8" : "#f0fdf4", borderRadius: 10, border: `1px solid ${apiStats.remaining < 500 ? "#fecaca" : apiStats.remaining < 1500 ? "#fde68a" : "#bbf7d0"}` }}>
              <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8, fontWeight: 600 }}>eBay API Usage</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: apiStats.remaining < 500 ? "#dc2626" : apiStats.remaining < 1500 ? "#b45309" : "#16a34a" }}>{apiStats.callsToday.toLocaleString()}</span>
                <span style={{ fontSize: 11, color: "#999", fontFamily: "'IBM Plex Mono', monospace" }}>/ 5,000</span>
              </div>
              <div style={{ width: "100%", height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(apiStats.callsToday / 5000) * 100}%`, height: "100%", borderRadius: 3, background: apiStats.remaining < 500 ? "#dc2626" : apiStats.remaining < 1500 ? "#eab308" : "#16a34a", transition: "width 0.3s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontSize: 9, color: "#999", fontFamily: "'IBM Plex Mono', monospace" }}>{apiStats.remaining.toLocaleString()} left</span>
                <span style={{ fontSize: 9, color: "#999", fontFamily: "'IBM Plex Mono', monospace" }}>~{Math.floor(apiStats.remaining * scanInterval / 3600)}h at {scanInterval}s</span>
              </div>
            </div>
          )}
          <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, fontWeight: 600 }}>Search Criteria</div>
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg><span style={{ fontSize: 10, color: "#16a34a", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5 }}>Locked</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span style={{ fontSize: 10, background: "#dcfce7", color: "#166534", padding: "3px 8px", borderRadius: 6, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>🔍 "{BASE_SEARCH}"</span>
              <span style={{ fontSize: 10, background: "#dbeafe", color: "#1e40af", padding: "3px 8px", borderRadius: 6, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>🇺🇸 US Only</span>
              <span style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", padding: "3px 8px", borderRadius: 6, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>📍 {ZIP_CODE}</span>
            </div>
          </div>

          <label style={lbl}>Filter Keywords</label>
          <TagInput tags={criteria.keywords} setTags={tags => updateCriteria("keywords", tags)} />

          <label style={{ ...lbl, marginTop: 20 }}>Price Range (Global)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}><span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 12 }}>$</span><input value={criteria.minPrice} onChange={e => updateCriteria("minPrice", e.target.value)} placeholder="Min" type="number" style={{ ...inp, paddingLeft: 22 }} /></div>
            <span style={{ color: "#ccc" }}>–</span>
            <div style={{ position: "relative", flex: 1 }}><span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 12 }}>$</span><input value={criteria.maxPrice} onChange={e => updateCriteria("maxPrice", e.target.value)} placeholder="Max" type="number" style={{ ...inp, paddingLeft: 22 }} /></div>
          </div>

          <PriceRulesTable rules={priceRules} setRules={setPriceRules} />

          <label style={{ ...lbl, marginTop: 20 }}>Condition</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{CONDITIONS.map(c => <button key={c} onClick={() => toggleCondition(c)} style={{ background: criteria.conditions.includes(c) ? "#f0fdf4" : "#f9fafb", border: `1px solid ${criteria.conditions.includes(c) ? "#86efac" : "#e5e7eb"}`, color: criteria.conditions.includes(c) ? "#166534" : "#888", padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{c}</button>)}</div>

          <label style={{ ...lbl, marginTop: 20 }}>Sort By</label>
          <select value={criteria.sortBy} onChange={e => updateCriteria("sortBy", e.target.value)} style={{ ...inp, cursor: "pointer", appearance: "auto" }}>{SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>

          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {[{ key: "buyItNowOnly", label: "Buy It Now Only" }, { key: "freeShippingOnly", label: "Free Shipping Only" }].map(({ key, label }) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <div onClick={() => updateCriteria(key, !criteria[key])} style={{ width: 40, height: 22, borderRadius: 11, background: criteria[key] ? "#16a34a" : "#e5e7eb", position: "relative", transition: "all 0.2s", cursor: "pointer" }}><div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.15)", position: "absolute", top: 3, left: criteria[key] ? 21 : 3, transition: "all 0.2s" }} /></div>
                <span style={{ fontSize: 12, color: "#555", fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
              </label>
            ))}
          </div>

          <label style={{ ...lbl, marginTop: 24 }}>Scan Interval (seconds)</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min="3" max="3600" value={scanInterval} onChange={e => setScanInterval(Math.max(3, Math.min(3600, parseInt(e.target.value) || 3)))} style={{ ...inp, width: 90, textAlign: "center", fontWeight: 600 }} />
            <span style={{ fontSize: 11, color: "#999" }}>{scanInterval < 60 ? `${scanInterval}s` : `${(scanInterval / 60).toFixed(1)}m`}</span>
            <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>{[3, 4, 5, 6].map(v => <button key={v} onClick={() => setScanInterval(v)} style={{ background: scanInterval === v ? "#f0fdf4" : "#f9fafb", border: `1px solid ${scanInterval === v ? "#86efac" : "#e5e7eb"}`, color: scanInterval === v ? "#166534" : "#aaa", padding: "3px 6px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>{v}s</button>)}</div>
          </div>

          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={toggleScanning} style={{ background: scanning ? "#fef2f2" : "#16a34a", border: scanning ? "1px solid #fecaca" : "none", color: scanning ? "#dc2626" : "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, boxShadow: scanning ? "none" : "0 2px 8px #16a34a33" }}>{scanning ? "■  Stop Monitor" : "▶  Start Monitor"}</button>
            <button onClick={runScan} disabled={loading} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", color: loading ? "#ccc" : "#555", padding: "10px", borderRadius: 10, cursor: loading ? "wait" : "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500 }}>{loading ? "Scanning..." : "Single Scan"}</button>
          </div>

          {lastScan && (
            <div style={{ marginTop: 20, padding: 14, background: "#f9fafb", borderRadius: 10 }}>
              <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10, fontWeight: 600 }}>Session</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[{ l: "Scans", v: scanCount }, { l: "Results", v: listings.length }, { l: "Picks", v: picksCount, c: "#7c3aed" }, { l: "Deals", v: dealCount, c: "#16a34a" }, { l: "Maybe", v: maybeCount, c: "#3b82f6" }, { l: "Over", v: overCount, c: "#dc2626" }].map(s => <div key={s.l}><div style={{ fontSize: 9, color: "#bbb", textTransform: "uppercase", letterSpacing: 1 }}>{s.l}</div><div style={{ fontSize: 14, fontWeight: 600, color: s.c || "#333", fontFamily: "'DM Sans', sans-serif" }}>{s.v}</div></div>)}
              </div>
            </div>
          )}
        </div>

        {/* Main */}
        <div style={{ flex: 1, padding: sidebarOpen ? 24 : 16, overflowY: "auto", background: "#fafafa" }}>
          {tab === "monitor" ? (<>
            {error && <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#dc2626", fontSize: 12, marginBottom: 16, fontFamily: "'DM Sans', sans-serif" }}>{error}</div>}
            {loading && !listings.length && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 16 }}><div style={{ width: 36, height: 36, border: "3px solid #e5e7eb", borderTop: "3px solid #16a34a", borderRadius: "50%", animation: "pulse 1s linear infinite" }} /><div style={{ fontSize: 12, color: "#aaa", fontFamily: "'DM Sans', sans-serif" }}>Searching eBay near {ZIP_CODE}...</div></div>}
            {!loading && !listings.length && !error && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 16 }}><div style={{ width: 64, height: 64, borderRadius: 20, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg></div><div style={{ fontSize: 14, color: "#999", textAlign: "center", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}>Hit <span style={{ color: "#16a34a", fontWeight: 600 }}>Start Monitor</span> to begin.</div></div>}

            {listings.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 4, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
                  {[{ k: "all", l: `All (${enriched.length})` }, { k: "picks", l: `Picks (${picksCount})`, c: "#7c3aed" }, { k: "deals", l: `Deals (${dealCount})`, c: "#16a34a" }, { k: "maybe", l: `Maybe (${maybeCount})`, c: "#3b82f6" }, { k: "over", l: `Over (${overCount})`, c: "#dc2626" }].map(f => <button key={f.k} onClick={() => setFilterMode(f.k)} style={{ background: filterMode === f.k ? "#fff" : "transparent", border: "none", boxShadow: filterMode === f.k ? "0 1px 3px rgba(0,0,0,0.08)" : "none", color: filterMode === f.k ? (f.c || "#111") : "#999", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600 }}>{f.l}</button>)}
                </div>
                {loading && <span style={{ fontSize: 11, color: "#16a34a", animation: "pulse 1s infinite" }}>● Updating...</span>}
              </div>

              {filtered.map((li, i) => {
                const r = li.rule; const isDeal = r?.underBudget; const isMaybe = r?.shipUnknown && r.savings > 0; const isOver = r && !r.underBudget && !isMaybe;
                return (<div key={li.id} style={{ background: isDeal ? "#f0fdf4" : isMaybe ? "#eff6ff" : isOver ? "#fefce8" : "#fff", border: `1px solid ${isDeal ? "#86efac" : isMaybe ? "#bfdbfe" : isOver ? "#fde68a" : "#f3f4f6"}`, borderLeft: isDeal ? "4px solid #16a34a" : isMaybe ? "4px solid #3b82f6" : isOver ? "4px solid #eab308" : "4px solid transparent", borderRadius: 12, padding: 16, animation: `slideIn 0.3s ease ${i * 0.04}s both${isDeal ? ", dealPulse 2s ease 1" : ""}`, boxShadow: isDeal ? "0 2px 12px #16a34a11" : isMaybe ? "0 2px 12px #3b82f611" : "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    {li.image && <img src={li.image} alt="" style={{ width: 72, height: 72, borderRadius: 8, objectFit: "cover", background: "#f3f4f6", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500, color: "#222", lineHeight: 1.5, marginBottom: 8 }}>
                        {isDeal && <span style={{ background: "#16a34a", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginRight: 8, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>✓ Deal</span>}
                        {isMaybe && <span style={{ background: "#3b82f6", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginRight: 8, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" }}>? Maybe</span>}
                        {isOver && <span style={{ background: "#fbbf24", color: "#78350f", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginRight: 8, textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace" }}>Over</span>}
                        {r?.shipUnknown && <span style={{ background: "#eff6ff", color: "#2563eb", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginRight: 8, textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace", border: "1px solid #bfdbfe" }}>⚠ Ship TBD</span>}
                        {newIds.has(li.id) && <span style={{ background: "#eff6ff", color: "#1e40af", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginRight: 8, textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace", border: "1px solid #bfdbfe" }}>New</span>}
                        {li.title}
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ color: isDeal ? "#16a34a" : isMaybe ? "#2563eb" : isOver ? "#b45309" : "#16a34a", fontSize: 20, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>${li.totalPrice.toFixed(2)}</span>
                          <span style={{ fontSize: 10, color: li.shippingKnown === false ? "#2563eb" : "#999", fontFamily: "'IBM Plex Mono', monospace" }}>
                            {li.shippingKnown === false ? `($${li.itemPrice.toFixed(2)} + ship TBD)` : `($${li.itemPrice.toFixed(2)} + $${li.shipCost.toFixed(2)} ship)`}
                          </span>
                        </div>
                        {r && <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: r.shipUnknown && r.savings > 0 ? "#2563eb" : r.savings > 0 ? "#16a34a" : "#dc2626", background: r.shipUnknown && r.savings > 0 ? "#eff6ff" : r.savings > 0 ? "#dcfce7" : "#fef2f2", padding: "3px 8px", borderRadius: 20 }}>{r.savings >= 0 ? `$${r.savings.toFixed(0)} under` : `$${Math.abs(r.savings).toFixed(0)} over`}{r.shipUnknown ? " + ship?" : ""}{r.qty > 1 ? ` (${r.qty}× ≤$${r.adjustedMax})` : ` (≤$${r.adjustedMax})`}</span>}
                        {r?.qty > 1 && <span style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", background: "#f5f3ff", padding: "3px 8px", borderRadius: 20, border: "1px solid #ddd6fe", fontFamily: "'IBM Plex Mono', monospace" }}>{r.qty}× · ${r.perUnit?.toFixed(2)}/ea</span>}
                        {li.condition && <span style={{ fontSize: 10, color: "#777", background: "#f3f4f6", padding: "3px 8px", borderRadius: 20, fontFamily: "'DM Sans', sans-serif" }}>{li.condition}</span>}
                        {li.seller && <span style={{ fontSize: 10, color: "#999", fontFamily: "'IBM Plex Mono', monospace" }}>@{li.seller}</span>}
                      </div>
                    </div>
                    {li.url && <a href={li.url} target="_blank" rel="noopener noreferrer" style={{ background: isDeal ? "#16a34a" : isMaybe ? "#3b82f6" : "#555", border: "none", color: "#fff", padding: "10px 20px", borderRadius: 10, textDecoration: "none", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 6, boxShadow: isDeal ? "0 2px 8px #16a34a33" : isMaybe ? "0 2px 8px #3b82f633" : "0 2px 8px rgba(0,0,0,0.1)", flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>BUY</a>}
                  </div>
                </div>);
              })}
            </div>}
          </>) : (<div>
            <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, fontWeight: 600 }}>Scan History</div>
            {!history.length ? <div style={{ color: "#ccc", padding: 40, textAlign: "center", fontFamily: "'DM Sans', sans-serif" }}>No scans yet</div> :
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{history.map((h, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: "#fff", border: "1px solid #f3f4f6", borderRadius: 10, fontSize: 12, animation: `slideIn 0.2s ease ${i * 0.02}s both`, fontFamily: "'DM Sans', sans-serif" }}><span style={{ color: "#aaa" }}>{h.time.toLocaleTimeString()}</span><span style={{ color: "#555", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.keywords}</span><span style={{ color: "#16a34a", fontWeight: 600 }}>{h.count}</span></div>)}</div>}
          </div>)}
        </div>
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6, fontWeight: 600 };
const inp = { width: "100%", background: "#fff", border: "1px solid #e5e7eb", color: "#333", padding: "10px 12px", borderRadius: 8, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", transition: "all 0.2s" };
