const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => e.append(k)); return e;
};
let token = ""; try { token = sessionStorage.getItem("cc_token") || ""; } catch {}
let state = { settings: {}, members: [], applications: [], roles: [] };
let filter = "all";

function toast(t) { const x = $("#toast"); x.textContent = t; x.classList.remove("hidden"); clearTimeout(toast.t); toast.t = setTimeout(() => x.classList.add("hidden"), 2600); }

async function api(method, path, body) {
  const r = await fetch("/api/admin" + path, {
    method, headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/login") { logout(); throw new Error(d.error || "Sesi habis."); }
  if (!r.ok) throw new Error(d.error || "Gagal.");
  return d;
}

function logout() {
  token = ""; try { sessionStorage.removeItem("cc_token"); } catch {}
  $("#panel").classList.add("hidden"); $("#login").classList.remove("hidden");
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const m = $("#loginMsg"); m.classList.add("hidden");
  try {
    const d = await api("POST", "/login", { password: $("#pw").value });
    token = d.token; try { sessionStorage.setItem("cc_token", token); } catch {}
    $("#pw").value = ""; await boot();
  } catch (err) { m.textContent = err.message; m.classList.remove("hidden"); }
});
$("#logout").onclick = logout;

async function boot() {
  state = await api("GET", "/data");
  $("#login").classList.add("hidden"); $("#panel").classList.remove("hidden");
  const sel = $("#mRole"); if (!sel.options.length) state.roles.forEach((r) => sel.append(new Option(r, r)));
  render();
}

function render() {
  $("#nApps").textContent = state.applications.filter((a) => a.status === "pending").length;
  $("#nMem").textContent = state.members.length;
  renderFilters(); renderApps(); renderMembers();
  $("#open").checked = !!state.settings.open;
  if (document.activeElement !== $("#rulesTa")) $("#rulesTa").value = (state.settings.rules || []).join("\n");
  if (document.activeElement !== $("#reqsTa")) $("#reqsTa").value = (state.settings.requirements || []).join("\n");
}

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
  ["apps", "rules", "members"].forEach((t) => $("#t-" + t).classList.toggle("hidden", t !== b.dataset.t));
}));

/* ---- pendaftar ---- */
const LABEL = { all: "Semua", pending: "Menunggu", accepted: "Diterima", rejected: "Ditolak" };
function renderFilters() {
  const box = $("#filters"); box.replaceChildren();
  Object.entries(LABEL).forEach(([k, v]) => {
    const n = k === "all" ? state.applications.length : state.applications.filter((a) => a.status === k).length;
    const b = el("button", { className: "btn sm " + (filter === k ? "" : "sec"), textContent: `${v} (${n})` });
    b.onclick = () => { filter = k; render(); }; box.append(b);
  });
}
function waLink(p) { let n = p.replace(/[^\d]/g, ""); if (n.startsWith("0")) n = "62" + n.slice(1); return "https://wa.me/" + n; }
const fmt = (iso) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });

function appCard(a) {
  const kv = (k, v) => [el("dt", { textContent: k }), v instanceof Node ? el("dd", {}, v) : el("dd", { textContent: v })];
  const wa = el("a", { href: waLink(a.phone), target: "_blank", rel: "noopener", textContent: a.phone });
  const act = el("div", { className: "row" });
  const btn = (txt, cls, fn) => { const b = el("button", { className: "btn sm " + cls, textContent: txt }); b.onclick = fn; act.append(b); };
  if (a.status !== "accepted") btn("Terima & jadikan member", "ok", () => run(() => api("POST", `/applications/${a.id}/accept`, {}), "Diterima & ditambahkan ke member"));
  if (a.status !== "rejected") btn("Tolak", "bad", () => run(() => api("PATCH", `/applications/${a.id}`, { status: "rejected" }), "Ditolak"));
  if (a.status !== "pending") btn("Kembalikan ke menunggu", "sec", () => run(() => api("PATCH", `/applications/${a.id}`, { status: "pending" }), "Dikembalikan"));
  btn("Hapus", "sec", () => confirm("Hapus pendaftar ini permanen?") && run(() => api("DELETE", `/applications/${a.id}`), "Dihapus"));
  return el("div", { className: "app" },
    el("div", { className: "app-top" },
      el("div", {}, el("h4", { textContent: a.mcName }), el("small", { textContent: fmt(a.createdAt), style: "color:var(--muted)" })),
      el("div", { className: "row" },
        el("span", { className: "pill p-" + a.edition, textContent: a.edition }),
        el("span", { className: "pill p-" + a.status, textContent: LABEL[a.status] }))),
    el("dl", { className: "kv" }, kv("Nama asli", a.realName), kv("No. HP", wa), kv("Alasan", a.reason)),
    act);
}
function renderApps() {
  const list = state.applications.filter((a) => filter === "all" || a.status === filter);
  const box = $("#appList"); box.replaceChildren();
  if (!list.length) return box.append(el("div", { className: "empty", textContent: "Belum ada pendaftar." }));
  list.forEach((a) => box.append(appCard(a)));
}

/* ---- member ---- */
function renderMembers() {
  const box = $("#memList"); box.replaceChildren();
  if (!state.members.length) return box.append(el("div", { className: "empty", textContent: "Belum ada member." }));
  state.members.forEach((m) => {
    const sel = el("select");
    state.roles.forEach((r) => sel.append(new Option(r, r, false, r === m.role)));
    sel.onchange = () => run(() => api("PUT", `/members/${m.id}`, { role: sel.value }), "Role diubah");
    const rename = el("button", { className: "btn sm sec", textContent: "Ubah nama" });
    rename.onclick = () => { const n = prompt("Nama baru:", m.name); if (n && n.trim()) run(() => api("PUT", `/members/${m.id}`, { name: n }), "Nama diubah"); };
    const del = el("button", { className: "btn sm bad", textContent: "Hapus" });
    del.onclick = () => confirm(`Hapus ${m.name} dari tim?`) && run(() => api("DELETE", `/members/${m.id}`), "Member dihapus");
    box.append(el("div", { className: "mrow" }, el("div", { className: "nm", textContent: m.name }), sel, rename, del));
  });
}
$("#addMember").addEventListener("submit", async (e) => {
  e.preventDefault();
  await run(() => api("POST", "/members", { name: $("#mName").value, role: $("#mRole").value }), "Member ditambahkan");
  $("#mName").value = "";
});

/* ---- pengaturan ---- */
const lines = (v) => v.split("\n").map((x) => x.trim()).filter(Boolean);
$("#saveSettings").onclick = () => run(() => api("PUT", "/settings", {
  open: $("#open").checked, rules: lines($("#rulesTa").value), requirements: lines($("#reqsTa").value),
}), "Tersimpan — langsung tampil di website");

async function run(fn, okMsg) {
  try { await fn(); state = await api("GET", "/data"); render(); toast("✔ " + okMsg); }
  catch (err) { toast("⚠ " + err.message); }
}

if (token) boot().catch(() => logout());
                        
