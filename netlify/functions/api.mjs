import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const SECRET = process.env.TOKEN_SECRET || "cindercrest-ganti-secret-ini";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ganti-password-admin";
const DEFAULT_PASS = "212121";
const ROLES = ["ketua", "tangan kanan", "wakil", "member"];

const sha = (s) => crypto.createHash("sha256").update("cc:" + s).digest("hex");
const sign = (p) => {
  const b = Buffer.from(JSON.stringify(p)).toString("base64url");
  return b + "." + crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
};
const verify = (t) => {
  try {
    const [b, s] = (t || "").split(".");
    const ok = crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
    if (s !== ok) return null;
    const p = JSON.parse(Buffer.from(b, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
};
const json = (d, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
const clean = (s, n = 300) => String(s ?? "").trim().slice(0, n);
const safeMember = (m) => ({ nick: m.nick, name: m.name, edition: m.edition, role: m.role, points: m.points });

export default async (req) => {
  const store = getStore("cindercrest");
  const db = (await store.get("db", { type: "json" })) || { members: [], pending: [], info: [], absen: [] };
  const save = () => store.setJSON("db", db);
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const auth = verify((req.headers.get("authorization") || "").replace("Bearer ", ""));
  const now = Date.now();
  const rank = (r) => ROLES.indexOf(r);

  // ---------- PUBLIC ----------
  if (path === "public") {
    return json({ members: db.members.map(safeMember).sort((a, b) => rank(a.role) - rank(b.role)) });
  }

  if (path === "register") {
    const nick = clean(body.nick, 20), name = clean(body.name, 60);
    const edition = body.edition === "Bedrock" ? "Bedrock" : "Java";
    const reason = clean(body.reason, 500), wa = clean(body.wa, 20).replace(/[^\d+]/g, "");
    if (!nick || !name || !reason || wa.length < 8) return json({ error: "Semua kolom wajib diisi dengan benar." }, 400);
    const low = nick.toLowerCase();
    if (db.members.some((m) => m.nick.toLowerCase() === low) || db.pending.some((m) => m.nick.toLowerCase() === low))
      return json({ error: "Nickname sudah terdaftar atau sedang menunggu persetujuan." }, 409);
    db.pending.push({ nick, name, edition, reason, wa, at: now });
    await save();
    return json({ ok: true });
  }

  if (path === "login") {
    const m = db.members.find((x) => x.nick.toLowerCase() === clean(body.nick, 20).toLowerCase());
    if (!m || m.pass !== sha(String(body.password || ""))) return json({ error: "Nickname atau password salah." }, 401);
    return json({ token: sign({ nick: m.nick, exp: now + 7 * 864e5 }) });
  }

  // ---------- MEMBER ----------
  if (path === "me") {
    const me = auth?.nick && db.members.find((m) => m.nick === auth.nick);
    if (!me) return json({ error: "Sesi berakhir." }, 401);
    return json({
      me: safeMember(me),
      members: db.members.map(safeMember).sort((a, b) => rank(a.role) - rank(b.role)),
      info: db.info.filter((i) => Date.parse(i.showAt) <= now && (!i.hideAt || Date.parse(i.hideAt) > now))
        .map(({ id, title, body, showAt }) => ({ id, title, body, showAt })).reverse(),
      absen: db.absen.filter((a) => Date.parse(a.openAt) <= now + 864e5 * 365).map((a) => ({
        id: a.id, title: a.title, openAt: a.openAt, closeAt: a.closeAt, points: a.points,
        status: now < Date.parse(a.openAt) ? "belum" : now > Date.parse(a.closeAt) ? "tutup" : "buka",
        done: a.attended.includes(me.nick), count: a.attended.length,
      })).reverse(),
    });
  }

  if (path === "attend") {
    const me = auth?.nick && db.members.find((m) => m.nick === auth.nick);
    if (!me) return json({ error: "Sesi berakhir." }, 401);
    const a = db.absen.find((x) => x.id === body.id);
    if (!a) return json({ error: "Absen tidak ditemukan." }, 404);
    if (now < Date.parse(a.openAt) || now > Date.parse(a.closeAt)) return json({ error: "Absen sedang tidak dibuka." }, 400);
    if (a.attended.includes(me.nick)) return json({ error: "Anda sudah absen." }, 400);
    a.attended.push(me.nick);
    me.points += a.points;
    await save();
    return json({ ok: true });
  }

  // ---------- ADMIN ----------
  if (path === "admin/login") {
    if (body.password !== ADMIN_PASSWORD) return json({ error: "Password admin salah." }, 401);
    return json({ token: sign({ admin: true, exp: now + 864e5 }) });
  }

  if (path.startsWith("admin/")) {
    if (!auth?.admin) return json({ error: "Tidak diizinkan." }, 401);
    if (path === "admin/data")
      return json({ members: db.members.map(({ pass, ...m }) => m), pending: db.pending, info: db.info, absen: db.absen });

    if (path === "admin/do") {
      const t = body.type;
      if (t === "accept") {
        const i = db.pending.findIndex((p) => p.nick === body.nick);
        if (i < 0) return json({ error: "Tidak ditemukan." }, 404);
        const [p] = db.pending.splice(i, 1);
        db.members.push({ ...p, role: "member", points: 0, pass: sha(DEFAULT_PASS) });
      } else if (t === "reject") {
        db.pending = db.pending.filter((p) => p.nick !== body.nick);
      } else if (t === "addMember") {
        const nick = clean(body.nick, 20);
        if (!nick || db.members.some((m) => m.nick.toLowerCase() === nick.toLowerCase())) return json({ error: "Nickname kosong/sudah ada." }, 400);
        db.members.push({
          nick, name: clean(body.name, 60) || nick, edition: body.edition === "Bedrock" ? "Bedrock" : "Java",
          wa: clean(body.wa, 20), reason: "Ditambahkan admin", role: ROLES.includes(body.role) ? body.role : "member",
          points: 0, pass: sha(DEFAULT_PASS), at: now,
        });
      } else if (t === "delMember") {
        db.members = db.members.filter((m) => m.nick !== body.nick);
        db.absen.forEach((a) => (a.attended = a.attended.filter((n) => n !== body.nick)));
      } else if (t === "setRole") {
        const m = db.members.find((x) => x.nick === body.nick);
        if (m && ROLES.includes(body.role)) m.role = body.role;
      } else if (t === "setPoints") {
        const m = db.members.find((x) => x.nick === body.nick);
        if (m) m.points = Math.max(0, parseInt(body.points) || 0);
      } else if (t === "resetPass") {
        const m = db.members.find((x) => x.nick === body.nick);
        if (m) m.pass = sha(DEFAULT_PASS);
      } else if (t === "addInfo") {
        if (!clean(body.title) || isNaN(Date.parse(body.showAt))) return json({ error: "Judul & waktu tampil wajib." }, 400);
        db.info.push({
          id: crypto.randomUUID(), title: clean(body.title, 100), body: clean(body.body, 2000),
          showAt: new Date(body.showAt).toISOString(), hideAt: body.hideAt ? new Date(body.hideAt).toISOString() : "",
        });
      } else if (t === "delInfo") {
        db.info = db.info.filter((i) => i.id !== body.id);
      } else if (t === "addAbsen") {
        if (!clean(body.title) || isNaN(Date.parse(body.openAt)) || isNaN(Date.parse(body.closeAt))) return json({ error: "Judul, buka & tutup wajib." }, 400);
        db.absen.push({
          id: crypto.randomUUID(), title: clean(body.title, 100), openAt: new Date(body.openAt).toISOString(),
          closeAt: new Date(body.closeAt).toISOString(), points: parseInt(body.points) || 0, attended: [],
        });
      } else if (t === "delAbsen") {
        db.absen = db.absen.filter((a) => a.id !== body.id);
      } else return json({ error: "Aksi tidak dikenal." }, 400);
      await save();
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
};

export const config = { path: "/api/*" };
             
