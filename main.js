import express from "express";

const app = express();
app.use(express.json());

// ===== env / config =====
const API_KEY = process.env.ROBLOX_API_KEY;         // set in Linux (e.g., ~/.bashrc)
const GAME_SECRET = process.env.GAME_SHARED_SECRET; // set in Linux
const CLOUD_BASE = "https://apis.roblox.com/cloud/v2";

if (!API_KEY)  { console.error("[FATAL] ROBLOX_API_KEY missing");  process.exit(1); }
if (!GAME_SECRET) { console.error("[FATAL] GAME_SHARED_SECRET missing"); process.exit(1); }

// ===== helpers =====
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = data?.errors?.map(e => `${e.code}: ${e.message}`).join(" | ") || res.statusText;
    const err = new Error(`HTTP ${res.status} ${msg}`);
    err.status = res.status; err.payload = data;
    throw err;
  }
  return data ?? {};
}

async function getRoleIdByName(groupId, roleName) {
  const url = `${CLOUD_BASE}/groups/${groupId}/roles?maxPageSize=100`;
  const data = await fetchJson(url, { headers: { "x-api-key": API_KEY } });
  const roles = data.groupRoles || data.roles || data;
  if (!Array.isArray(roles)) throw new Error("Unexpected roles response.");
  const match = roles.find(r => (r.displayName || r.name || "").toLowerCase() === roleName.toLowerCase());
  if (!match) throw new Error(`Role "${roleName}" not found in group ${groupId}.`);
  return Number(match.id);
}

function idFromPath(pathStr) {
  if (!pathStr) return null;
  const parts = String(pathStr).split("/");
  return parts[parts.length - 1];
}

async function getMembershipId(groupId, userId) {
  let pageToken = "";
  while (true) {
    const url = new URL(`${CLOUD_BASE}/groups/${groupId}/memberships`);
    url.searchParams.set("maxPageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await fetchJson(url, { headers: { "x-api-key": API_KEY } });
    const memberships = data.groupMemberships || [];
    for (const m of memberships) {
      const uid = idFromPath(m.user);
      if (String(uid) === String(userId)) {
        const mid = (m.path || "").split("/").pop(); // groups/{gid}/memberships/{mid}
        return mid;
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  throw new Error(`User ${userId} is not a member of group ${groupId}.`);
}

async function setMembershipRole(groupId, membershipId, roleId) {
  const url = `${CLOUD_BASE}/groups/${groupId}/memberships/${membershipId}`;
  const body = { role: `groups/${groupId}/roles/${roleId}` };
  return fetchJson(url, {
    method: "PATCH",
    headers: {
      "x-api-key": API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

// ===== routes =====

// Health
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "roblox-ranker", apiKeyLoaded: true, secretLoaded: true });
});

// List roles: GET /roles?groupId=123
app.get("/roles", async (req, res) => {
  try {
    const groupId = req.query.groupId;
    if (!groupId) return res.status(400).json({ ok: false, error: "Missing groupId." });
    const data = await fetchJson(`${CLOUD_BASE}/groups/${groupId}/roles?maxPageSize=100`, {
      headers: { "x-api-key": API_KEY }
    });
    res.json({ ok: true, roles: data.groupRoles || data.roles || data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: String(err.message || err), details: err.payload });
  }
});

// Rank: POST /rank { groupId, userId, roleId? , roleName? } + header x-game-auth: <secret>
app.post("/rank", async (req, res) => {
  try {
    if (req.headers["x-game-auth"] !== GAME_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    const { groupId, userId, roleId, roleName } = req.body || {};
    if (!groupId || !userId || (!roleId && !roleName)) {
      return res.status(400).json({ ok: false, error: "Missing groupId, userId, and roleId/roleName." });
    }

    const finalRoleId = roleId ?? await getRoleIdByName(groupId, roleName);
    const membershipId = await getMembershipId(groupId, userId);
    const result = await setMembershipRole(groupId, membershipId, finalRoleId);

    res.json({ ok: true, groupId, userId, roleId: finalRoleId, membershipId, result });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: String(err.message || err), details: err.payload });
  }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rank server running on port ${PORT}`));
