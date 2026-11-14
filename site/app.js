const $ = (s) => document.querySelector(s);
const ROLES = ["Ketua", "Tangan Kanan", "Tangan Kiri", "Wakil", "Member"];

function fillList(el, items, emptyText) {
  el.replaceChildren();
  if (!items.length) { const li = document.createElement("li"); li.textContent = emptyText; el.append(li); return; }
  items.forEach((t) => { const li = document.createElement("li"); li.textContent = t; el.append(li); });
}

function memberCard(m) {
  const d = document.createElement("div"); d.className = "member";
  const ph = document.createElement("div"); ph.className = "ph"; ph.textContent = m.name[0].toUpperCase();
  const img = new Image(); img.alt = ""; img.loading = "lazy";
  img.src = "https://minotar.net/helm/" + encodeURIComponent(m.name) + "/64.png";
  img.onload = () => ph.replaceWith(img);
  const t = document.createElement("div");
  const b = document.createElement("b"); b.textContent = m.name;
  const r = document.createElement("span"); r.className = "role r-" + m.role.replace(/ /g, "-"); r.textContent = m.role;
  t.append(b, r); d.append(ph, t); return d;
}

function renderMembers(members) {
  const box = $("#members"); box.replaceChildren();
  if (!members.length) { box.innerHTML = '<div class="empty">Belum ada anggota yang ditampilkan.</div>'; return; }
  ROLES.forEach((role) => {
    const list = members.filter((m) => m.role === role);
    if (!list.length) return;
    const g = document.createElement("div"); g.className = "role-group";
    const h = document.createElement("div"); h.className = "role-head"; h.textContent = `${role} (${list.length})`;
    const grid = document.createElement("div"); grid.className = "members";
    list.forEach((m) => grid.append(memberCard(m)));
    g.append(h, grid); box.append(g);
  });
}

async function load() {
  try {
    const r = await fetch("/api/public"); if (!r.ok) throw 0;
    const d = await r.json();
    $("#count").textContent = d.count;
    renderMembers(d.members);
    fillList($("#rules"), d.rules, "Belum ada peraturan.");
    fillList($("#reqs"), d.requirements, "Belum ada syarat.");
    const st = $("#status");
    st.textContent = d.open ? "DIBUKA" : "DITUTUP";
    st.className = d.open ? "badge-open" : "badge-closed";
    if (!d.open) $("#formbox").innerHTML = '<div class="closed-note">Pendaftaran sedang ditutup. Pantau terus halaman ini ya!</div>';
  } catch {
    $("#members").innerHTML = '<div class="empty">Gagal memuat data. Coba refresh halaman.</div>';
    $("#status").textContent = "—";
  }
}

const form = $("#form");
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#formmsg"), btn = $("#submit");
  const data = Object.fromEntries(new FormData(form));
  const show = (t, ok) => { msg.textContent = t; msg.className = "msg " + (ok ? "good" : "err"); };
  if (!data.edition) return show("Pilih versi Minecraft (Java/Bedrock).");
  btn.disabled = true; btn.textContent = "Mengirim…";
  try {
    const r = await fetch("/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Gagal mengirim.");
    $("#formbox").innerHTML = '<div class="msg good">✔ Pendaftaran terkirim! Admin akan menghubungi kamu lewat nomor HP yang kamu isi.</div>';
  } catch (err) {
    show(err.message || "Gagal mengirim, coba lagi."); btn.disabled = false; btn.textContent = "Kirim Pendaftaran";
  }
});
load();
