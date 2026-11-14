import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const ROLES = ["Ketua", "Tangan Kanan", "Tangan Kiri", "Wakil", "Member"];

// Bedrock: nama in-game diawali titik (.Nama), Java: apa adanya
const gameName = (a) => (a.edition === "Bedrock" ? "." : "") + a.mcName.replace(/^\.+/, "");
const SESSION_MS = 1000 * 60 * 60 * 12; // login berlaku 12 jam

const DEFAULTS = {
  open: true,
  rules: [
    "Hormati semua anggota tim dan pemain lain.",
    "Dilarang cheat, hack, atau memakai mod yang curang.",
    "Dilarang griefing / merusak build milik anggota maupun pemain lain.",
    "Aktif di Discord/grup tim dan ikuti arahan admin.",
    "Tidak boleh menyebarkan koordinat atau info base tim ke orang luar.",
  ],
  requirements: [
    "Memiliki akun Minecraft (Java atau Bedrock).",
    "Mau bekerja sama dan aktif bermain bersama tim.",
    "Bisa dihubungi lewat nomor HP yang didaftarkan.",
    "Bersedia mengikuti peraturan tim.",
  ],
};

const store = () => getStore({ name: "cindercrest", consistency: "strong" });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (msg, status = 400) => json({ error: msg }, status);

/* ---------- auth ---------- */
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
const hmac = (v) => crypto.createHmac("sha256", secret()).update(v).digest("base64url");
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest();

function makeToken() {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${hmac(exp)}`;
}
function tokenOk(req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [exp, sig] = t.split(".");
  if (!exp || !sig || !secret()) return false;
  const a = Buffer.from(sig), b = Buffer.from(hmac(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(exp) > Date.now();
}

/* ---------- helpers ---------- */
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const cleanLines = (arr, max = 200, limit = 60) =>
  (Array.isArray(arr) ? arr : []).map((x) => clean(x, max)).filter(Boolean).slice(0, limit);
const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString("hex");

async function getSettings(s) {
  const saved = (await s.get("settings", { type: "json" })) || {};
  return { ...DEFAULTS, ...saved };
}
async function getMembers(s) {
  return (await s.get("members", { type: "json" })) || [];
}
const sortMembers = (m) =>
  [...m].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name, "id"));

async function listApps(s) {
  const { blobs } = await s.list({ prefix: "app/" });
  const apps = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return apps.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ---------- handler ---------- */
export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const method = req.method;
  const s = store();
  let body = {};
  if (["POST", "PUT", "PATCH"].includes(method)) {
    try { body = await req.json(); } catch { return fail("Data tidak valid."); }
  }

  try {
    /* ===== publik ===== */
    if (method === "GET" && path === "/public") {
      const [settings, members] = await Promise.all([getSettings(s), getMembers(s)]);
      return json({
        open: settings.open,
        rules: settings.rules,
        requirements: settings.requirements,
        members: sortMembers(members).map(({ id, name, role }) => ({ id, name, role })),
        count: members.length,
      });
    }

    if (method === "POST" && path === "/apply") {
      if (body.website) return json({ ok: true }); // honeypot (bot)
      const settings = await getSettings(s);
      if (!settings.open) return fail("Pendaftaran sedang ditutup.", 403);

      const app = {
        realName: clean(body.realName, 80),
        mcName: clean(body.mcName, 32),
        edition: body.edition === "Bedrock" ? "Bedrock" : body.edition === "Java" ? "Java" : "",
        phone: clean(body.phone, 20).replace(/[^\d+]/g, ""),
        reason: clean(body.reason, 1000),
      };
      if (app.realName.length < 2) return fail("Nama asli wajib diisi.");
      if (app.mcName.length < 3) return fail("Nama Minecraft wajib diisi.");
      if (!app.edition) return fail("Pilih versi Minecraft (Java/Bedrock).");
      if (!/^\+?\d{8,15}$/.test(app.phone)) return fail("Nomor HP tidak valid (8-15 angka).");
      if (app.reason.length < 10) return fail("Alasan minimal 10 karakter.");

      const apps = await listApps(s);
      if (apps.some((a) => a.status === "pending" && a.mcName.toLowerCase() === app.mcName.toLowerCase()))
        return fail("Pendaftaran dengan nama Minecraft ini sudah masuk dan sedang diproses.");

      const id = uid();
      await s.setJSON(`app/${id}`, { id, ...app, status: "pending", createdAt: new Date().toISOString() });
      return json({ ok: true });
    }

    /* ===== login ===== */
    if (method === "POST" && path === "/admin/login") {
      if (!process.env.ADMIN_PASSWORD) return fail("ADMIN_PASSWORD belum diatur di Netlify.", 500);
      const ok = crypto.timingSafeEqual(sha(body.password ?? ""), sha(process.env.ADMIN_PASSWORD));
      if (!ok) {
        await new Promise((r) => setTimeout(r, 900)); // perlambat tebak-tebakan password
        return fail("Password salah.", 401);
      }
      return json({ token: makeToken() });
    }

    /* ===== admin (wajib login) ===== */
    if (!path.startsWith("/admin/")) return fail("Tidak ditemukan.", 404);
    if (!tokenOk(req)) return fail("Sesi habis, silakan login lagi.", 401);

    if (method === "GET" && path === "/admin/data") {
      const [settings, members, applications] = await Promise.all([getSettings(s), getMembers(s), listApps(s)]);
      return json({ settings, members: sortMembers(members), applications, roles: ROLES });
    }

    if (method === "PUT" && path === "/admin/settings") {
      const cur = await getSettings(s);
      const next = {
        open: typeof body.open === "boolean" ? body.open : cur.open,
        rules: body.rules !== undefined ? cleanLines(body.rules) : cur.rules,
        requirements: body.requirements !== undefined ? cleanLines(body.requirements) : cur.requirements,
      };
      await s.setJSON("settings", next);
      return json({ ok: true, settings: next });
    }

    let m;
    if ((m = path.match(/^\/admin\/applications\/([\w-]+)(\/accept)?$/))) {
      const key = `app/${m[1]}`;
      const app = await s.get(key, { type: "json" });
      if (!app) return fail("Pendaftar tidak ditemukan.", 404);

      if (method === "DELETE") { await s.delete(key); return json({ ok: true }); }

      if (method === "PATCH") {
        if (!["pending", "accepted", "rejected"].includes(body.status)) return fail("Status tidak valid.");
        await s.setJSON(key, { ...app, status: body.status });
        return json({ ok: true });
      }

      if (method === "POST" && m[2]) {
        const role = ROLES.includes(body.role) ? body.role : "Member";
        const members = await getMembers(s);
        const name = gameName(app);
        if (!members.some((x) => x.name.toLowerCase() === name.toLowerCase()))
          members.push({ id: uid(), name, role });
        await s.setJSON("members", members);
        await s.setJSON(key, { ...app, status: "accepted" });
        return json({ ok: true });
      }
    }

    if (method === "POST" && path === "/admin/members") {
      const name = clean(body.name, 32);
      const role = ROLES.includes(body.role) ? body.role : "Member";
      if (name.length < 2) return fail("Nama member wajib diisi.");
      const members = await getMembers(s);
      if (members.some((x) => x.name.toLowerCase() === name.toLowerCase())) return fail("Member itu sudah ada.");
      members.push({ id: uid(), name, role });
      await s.setJSON("members", members);
      return json({ ok: true });
    }

    if ((m = path.match(/^\/admin\/members\/([\w-]+)$/))) {
      const members = await getMembers(s);
      const i = members.findIndex((x) => x.id === m[1]);
      if (i < 0) return fail("Member tidak ditemukan.", 404);
      if (method === "DELETE") members.splice(i, 1);
      else if (method === "PUT") {
        if (body.name !== undefined) {
          const name = clean(body.name, 32);
          if (name.length < 2) return fail("Nama member wajib diisi.");
          members[i].name = name;
        }
        if (body.role !== undefined) {
          if (!ROLES.includes(body.role)) return fail("Role tidak valid.");
          members[i].role = body.role;
        }
      } else return fail("Metode tidak didukung.", 405);
      await s.setJSON("members", members);
      return json({ ok: true });
    }

    return fail("Tidak ditemukan.", 404);
  } catch (e) {
    console.error(e);
    return fail("Terjadi kesalahan di server.", 500);
  }
};
