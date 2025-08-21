// server.js
import express from "express";

const app = express();
app.use(express.json());

const API_KEY = process.env.ROBLOX_API_KEY; // never hardcode
const CLOUD_BASE = "https://apis.roblox.com/cloud/v2";

async function getRoleId(groupId, roleName) {
  const res = await fetch(`${CLOUD_BASE}/groups/${groupId}/roles?maxPageSize=100`, {
    method: "GET",
    headers: { "x-api-key": API_KEY }
  });
  if (!res.ok) throw new Error(`roles GET failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const roles = data.groupRoles || data; // API returns groupRoles array
  const match = roles.find(r => r.displayName.toLowerCase() === roleName.toLowerCase());
  if (!match) throw new Error(`Role "${roleName}" not found.`);
  return Number(match.id);
}

async function getMembershipId(groupId, userId) {
  // page through if needed
  let pageToken = "";
  while (true) {
    const url = new URL(`${CLOUD_BASE}/groups/${groupId}/memberships`);
    url.searchParams.set("maxPageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { "x-api-key": API_KEY } });
    if (!res.ok) throw new Error(`memberships GET failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    for (const m of data.groupMemberships || []) {
      const idStr = (m.user || "").split("/").pop();
      if (String(idStr) === String(userId)) {
        // membership resource path looks like groups/{gid}/memberships/{mid}
        const membershipId = (m.path || "").split("/")[3];
        return membershipId;
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  throw new Error(`User ${userId} is not a member of group ${groupId}.`);
}

async function setMembershipRole(groupId, membershipId, roleId) {
  const res = await fetch(`${CLOUD_BASE}/groups/${groupId}/memberships/${membershipId}`, {
    method: "PATCH",
    headers: {
      "x-api-key": API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({ role: `groups/${groupId}/roles/${roleId}` })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.errors?.map(e => `${e.code}: ${e.message}`).join(" | ");
    throw new Error(`PATCH failed: ${res.status} ${res.statusText}${msg ? " - " + msg : ""}`);
  }
  return body;
}

// POST /rank { groupId, userId, roleId? , roleName? , auth }
app.post("/rank", async (req, res) => {
  try {
    // Basic shared-secret check from Roblox
    if (req.headers["x-game-auth"] !== process.env.GAME_SHARED_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { groupId, userId, roleId, roleName } = req.body || {};
    if (!groupId || !userId || (!roleId && !roleName)) {
      return res.status(400).json({ error: "Missing groupId, userId, and roleId/roleName." });
    }

    const finalRoleId = roleId ?? await getRoleId(groupId, roleName);
    const membershipId = await getMembershipId(groupId, userId);
    const result = await setMembershipRole(groupId, membershipId, finalRoleId);

    res.json({ ok: true, membershipId, roleId: finalRoleId, result });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rank server running on ${PORT}`));
