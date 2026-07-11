import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";

const db = getDatabase();
const SESSION_COOKIE = "tw_session";
const SESSION_DAYS = 30;

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });

const clean = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  const [method, salt, expected] = String(stored).split("$");
  if (method !== "scrypt" || !salt || !expected) return false;
  return safeEqual(hashPassword(password, salt), stored);
}

function parseCookies(req) {
  const cookie = req.headers.get("cookie") || "";
  return Object.fromEntries(cookie.split(";").map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf("=");
    return [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))];
  }));
}

function sessionCookie(token, maxAge = SESSION_DAYS * 86400) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

async function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db.sql`
    SELECT u.id, u.username, u.display_name, u.role, s.id AS session_id
    FROM user_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] || null;
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  return user;
}

async function bootstrapUser(username, password) {
  const count = await db.sql`SELECT COUNT(*)::int AS count FROM app_users`;
  if (count[0].count > 0) return null;

  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_INITIAL_PASSWORD;
  if (!envUser || !envPass) {
    throw Object.assign(new Error("BOOTSTRAP_NOT_CONFIGURED"), { status: 503 });
  }
  if (username !== envUser || password !== envPass) return null;

  const created = await db.sql`
    INSERT INTO app_users (username, password_hash, display_name)
    VALUES (${username}, ${hashPassword(password)}, ${"Wit"})
    RETURNING id, username, display_name, role
  `;
  return created[0];
}

async function login(req) {
  const data = await body(req);
  const username = clean(data.username, 80);
  const password = String(data.password ?? "");
  if (!username || !password) return json({ error: "MISSING_CREDENTIALS" }, 400);

  let user = await bootstrapUser(username, password);
  if (!user) {
    const rows = await db.sql`
      SELECT id, username, password_hash, display_name, role
      FROM app_users WHERE username = ${username} LIMIT 1
    `;
    const candidate = rows[0];
    if (!candidate || !verifyPassword(password, candidate.password_hash)) {
      await new Promise(r => setTimeout(r, 450));
      return json({ error: "INVALID_LOGIN" }, 401);
    }
    user = candidate;
  }

  const token = crypto.randomBytes(32).toString("base64url");
  await db.sql`DELETE FROM user_sessions WHERE expires_at <= NOW()`;
  await db.sql`
    INSERT INTO user_sessions (user_id, token_hash, expires_at)
    VALUES (${user.id}, ${sha256(token)}, NOW() + INTERVAL '30 days')
  `;
  return json(
    { user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } },
    200,
    { "set-cookie": sessionCookie(token) }
  );
}

async function logout(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await db.sql`DELETE FROM user_sessions WHERE token_hash = ${sha256(token)}`;
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function changePassword(req) {
  const user = await requireUser(req);
  const data = await body(req);
  const current = String(data.currentPassword ?? "");
  const next = String(data.newPassword ?? "");
  if (next.length < 8) return json({ error: "PASSWORD_TOO_SHORT" }, 400);

  const rows = await db.sql`SELECT password_hash FROM app_users WHERE id = ${user.id}`;
  if (!rows[0] || !verifyPassword(current, rows[0].password_hash)) {
    return json({ error: "WRONG_CURRENT_PASSWORD" }, 400);
  }

  await db.sql`
    UPDATE app_users SET password_hash = ${hashPassword(next)}, updated_at = NOW()
    WHERE id = ${user.id}
  `;
  await db.sql`DELETE FROM user_sessions WHERE user_id = ${user.id} AND id <> ${user.session_id}`;
  return json({ ok: true });
}

function validateProject(data) {
  const projectName = clean(data.projectName, 200);
  const projectAddress = clean(data.projectAddress, 300);
  const clientName = clean(data.clientName, 200);
  const projectDate = clean(data.projectDate, 10);
  const paymentStatus = data.paymentStatus === "paid" ? "paid" : "unpaid";
  const workers = Array.isArray(data.workers) ? data.workers.slice(0, 100).map((w, i) => ({
    name: clean(w.name, 150),
    start: clean(w.start, 5),
    end: clean(w.end, 5),
    wage: Math.max(0, Number(w.wage ?? w.pay ?? 0) || 0),
    sortOrder: i
  })).filter(w => w.name) : [];

  if (!projectName || !/^\d{4}-\d{2}-\d{2}$/.test(projectDate)) {
    throw Object.assign(new Error("INVALID_PROJECT"), { status: 400 });
  }
  for (const w of workers) {
    if (!/^\d{2}:\d{2}$/.test(w.start) || !/^\d{2}:\d{2}$/.test(w.end)) {
      throw Object.assign(new Error("INVALID_WORKER_TIME"), { status: 400 });
    }
  }
  return { projectName, projectAddress, clientName, projectDate, paymentStatus, workers };
}

async function listProjects(req) {
  await requireUser(req);
  const rows = await db.sql`
    SELECT p.id, p.project_name, p.project_address, p.client_name, p.project_date,
           p.payment_status, p.created_at, p.updated_at,
           COUNT(w.id)::int AS worker_count,
           COALESCE(SUM(w.wage), 0)::numeric AS total_wage
    FROM projects p
    LEFT JOIN project_workers w ON w.project_id = p.id
    GROUP BY p.id
    ORDER BY p.project_date DESC, p.created_at DESC
    LIMIT 300
  `;
  return json({ projects: rows.map(r => ({
    id:r.id, projectName:r.project_name, projectAddress:r.project_address,
    clientName:r.client_name, projectDate:r.project_date, paymentStatus:r.payment_status,
    createdAt:r.created_at, updatedAt:r.updated_at, workerCount:r.worker_count,
    totalWage:Number(r.total_wage)
  }))});
}

async function getProject(req, id) {
  await requireUser(req);
  const rows = await db.sql`
    SELECT id, project_name, project_address, client_name, project_date, payment_status
    FROM projects WHERE id = ${id} LIMIT 1
  `;
  if (!rows[0]) return json({ error:"NOT_FOUND" }, 404);
  const workers = await db.sql`
    SELECT id, worker_name, start_time, end_time, wage
    FROM project_workers WHERE project_id = ${id}
    ORDER BY sort_order, created_at
  `;
  const p = rows[0];
  return json({ project: {
    id:p.id, projectName:p.project_name, projectAddress:p.project_address,
    clientName:p.client_name, projectDate:p.project_date, paymentStatus:p.payment_status,
    workers:workers.map(w => ({
      id:w.id, name:w.worker_name,
      start:String(w.start_time).slice(0,5), end:String(w.end_time).slice(0,5),
      wage:Number(w.wage)
    }))
  }});
}

async function createProject(req) {
  const user = await requireUser(req);
  const p = validateProject(await body(req));
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO projects (project_name, project_address, client_name, project_date, payment_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.projectName,p.projectAddress,p.clientName,p.projectDate,p.paymentStatus,user.id]
    );
    const id = result.rows[0].id;
    for (const w of p.workers) {
      await client.query(
        `INSERT INTO project_workers (project_id, worker_name, start_time, end_time, wage, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id,w.name,w.start,w.end,w.wage,w.sortOrder]
      );
    }
    await client.query("COMMIT");
    return json({ id }, 201);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

async function updateProject(req, id) {
  await requireUser(req);
  const p = validateProject(await body(req));
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE projects SET project_name=$1, project_address=$2, client_name=$3,
       project_date=$4, payment_status=$5, updated_at=NOW() WHERE id=$6 RETURNING id`,
      [p.projectName,p.projectAddress,p.clientName,p.projectDate,p.paymentStatus,id]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return json({ error:"NOT_FOUND" }, 404);
    }
    await client.query("DELETE FROM project_workers WHERE project_id=$1", [id]);
    for (const w of p.workers) {
      await client.query(
        `INSERT INTO project_workers (project_id, worker_name, start_time, end_time, wage, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id,w.name,w.start,w.end,w.wage,w.sortOrder]
      );
    }
    await client.query("COMMIT");
    return json({ id });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

async function deleteProject(req, id) {
  await requireUser(req);
  await db.sql`DELETE FROM projects WHERE id = ${id}`;
  return json({ ok:true });
}

async function logShare(req, id) {
  const user = await requireUser(req);
  const data = await body(req);
  const workerId = data.workerId || null;
  const workerName = clean(data.workerName,150);
  if (!workerName) return json({error:"INVALID_WORKER"},400);
  await db.sql`
    INSERT INTO share_log (project_id, worker_id, worker_name, shared_by)
    VALUES (${id}, ${workerId}, ${workerName}, ${user.id})
  `;
  return json({ok:true});
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api/, "") || "/";
    const method = req.method.toUpperCase();

    if (method === "POST" && path === "/login") return await login(req);
    if (method === "POST" && path === "/logout") return await logout(req);
    if (method === "GET" && path === "/me") {
      const user = await currentUser(req);
      return user ? json({user:{id:user.id,username:user.username,displayName:user.display_name,role:user.role}}) : json({error:"UNAUTHORIZED"},401);
    }
    if (method === "POST" && path === "/change-password") return await changePassword(req);
    if (method === "GET" && path === "/projects") return await listProjects(req);
    if (method === "POST" && path === "/projects") return await createProject(req);

    const projectMatch = path.match(/^\/projects\/([0-9a-f-]+)$/i);
    if (projectMatch && method === "GET") return await getProject(req, projectMatch[1]);
    if (projectMatch && method === "PUT") return await updateProject(req, projectMatch[1]);
    if (projectMatch && method === "DELETE") return await deleteProject(req, projectMatch[1]);

    const shareMatch = path.match(/^\/projects\/([0-9a-f-]+)\/share$/i);
    if (shareMatch && method === "POST") return await logShare(req, shareMatch[1]);

    return json({ error:"NOT_FOUND" },404);
  } catch (e) {
    console.error(e);
    const status = e.status || 500;
    return json({ error: e.message || "SERVER_ERROR" }, status);
  }
};
