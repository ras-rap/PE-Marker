import { Database } from "bun:sqlite";
import { serve } from "bun";
import { RateLimiterMemory } from "rate-limiter-flexible";
import type { ChannelData, VoteRequest, VerifyRequest } from "./types";
import { join } from "path";
import { stat, readFile } from "fs/promises";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import "dotenv/config";

const PORT = 3000;
const CACHE_TTL_MS = 10_000;
const RATE_LIMIT_POINTS = 50;
const RATE_LIMIT_DURATION = 10;

// Only this origin is allowed to call the admin verification endpoint
const ADMIN_ORIGIN = "https://pem.ras-rap.click";

const ICONS_DIR = join(import.meta.dir, "./icons");

const db = new Database("db.sqlite");
db.run(`
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT 'Unknown',
  votesYes INTEGER DEFAULT 0,
  votesNo INTEGER DEFAULT 0,
  verificationStatus INTEGER DEFAULT 0
)
`);

// Global limiter (already exists)
const rateLimiter = new RateLimiterMemory({
  points: RATE_LIMIT_POINTS,
  duration: RATE_LIMIT_DURATION,
});

// NEW: Per-channel vote limiter
const voteLimiter = new RateLimiterMemory({
  points: 1,          // 1 vote
  duration: 60,       // per 60 seconds
});

const cache = new Map<string, { data: ChannelData; expires: number }>();

// Helper function to determine allowed origin based on request and endpoint
function getAllowedOrigin(req: Request, endpoint: string = "default"): string {
  const origin = req.headers.get("Origin") || "";
  const isChromeExtension = origin.startsWith("chrome-extension://");
  const userAgent = req.headers.get("User-Agent") || "";
  const isLikelyExtension = isChromeExtension || userAgent.includes("Chrome/") || !origin;
  
  console.log(`[CORS] Origin: "${origin}", isChromeExtension: ${isChromeExtension}, isLikelyExtension: ${isLikelyExtension}, endpoint: ${endpoint}`);
  
  // For admin endpoint, only allow specific origin
  if (endpoint === "admin") {
    const isAllowed =
      origin === ADMIN_ORIGIN ||
      origin === "http://pem.ras-rap.click";
    console.log(`[CORS] Admin check: ${isAllowed}`);
    return isAllowed ? origin : "";
  }
  
  // For icons endpoint, be very permissive - allow Chrome extensions, empty origins, and all web origins
  if (endpoint === "icons") {
    if (isChromeExtension || !origin || isLikelyExtension) {
      console.log(`[CORS] Allowing permissive origin for icons: "${origin || 'chrome-extension://*'}"`);
      return origin || "*"; // If no origin, use wildcard
    } else {
      console.log(`[CORS] Allowing wildcard origin for icons: "*"`);
      return "*";
    }
  }
  
  // For all other endpoints, allow Chrome extensions and all origins
  if (isChromeExtension || isLikelyExtension) {
    console.log(`[CORS] Allowing extension origin for default endpoint: "${origin || 'chrome-extension://*'}"`);
    return origin || "*";
  }
  
  console.log(`[CORS] Allowing wildcard origin for default endpoint: "*"`);
  return "*";
}

// Helper function to create CORS headers
function getCORSHeaders(req: Request, endpoint: string = "default"): Record<string, string> {
  const allowedOrigin = getAllowedOrigin(req, endpoint);
  
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
  
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    console.log(`[CORS] Setting Access-Control-Allow-Origin: "${allowedOrigin}"`);
  } else {
    console.log(`[CORS] No allowed origin for this request`);
  }
  
  return headers;
}

// Updated withCORS function - now takes req as parameter
function withCORS(
  body: string,
  status = 200,
  req?: Request,
  endpoint: string = "default",
  additionalHeaders: Record<string, string> = {}
) {
  const headers = {
    "Content-Type": "application/json",
    ...getCORSHeaders(req || new Request("http://localhost"), endpoint),
    ...additionalHeaders,
  };

  console.log(`[CORS] Response headers for ${endpoint}:`, headers);

  return new Response(body, {
    status,
    headers,
  });
}

// For non-JSON responses (like icons), create a separate helper
function withCORSFile(
  body: ArrayBuffer | Uint8Array | string,
  status = 200,
  req: Request,
  endpoint: string = "default",
  contentType: string = "application/octet-stream",
  additionalHeaders: Record<string, string> = {}
) {
  const headers = {
    "Content-Type": contentType,
    ...getCORSHeaders(req, endpoint),
    ...additionalHeaders,
  };

  console.log(`[CORS] File response headers for ${endpoint}:`, headers);

  return new Response(body, {
    status,
    headers,
  });
}

function getCachedChannel(id: string): ChannelData | null {
  const entry = cache.get(id);
  if (entry && entry.expires > Date.now()) return entry.data;
  return null;
}

function setCachedChannel(id: string, data: ChannelData) {
  cache.set(id, { data, expires: Date.now() + CACHE_TTL_MS });
}

function getChannel(id: string): ChannelData {
  const row = db
    .query(
      "SELECT id, name, votesYes, votesNo, verificationStatus FROM channels WHERE id = ?"
    )
    .get(id) as ChannelData | undefined;

  if (!row) {
    db.run(
      "INSERT INTO channels (id, votesYes, votesNo, verificationStatus) VALUES (?, 0, 0, 0)",
      [id]
    );
    return {
      id,
      name: "Unknown",
      votesYes: 0,
      votesNo: 0,
      verificationStatus: 0,
    };
  }
  return row;
}

function updateVote(id: string, vote: "yes" | "no") {
  if (vote === "yes") {
    db.run("UPDATE channels SET votesYes = votesYes + 1 WHERE id = ?", [id]);
  } else {
    db.run("UPDATE channels SET votesNo = votesNo + 1 WHERE id = ?", [id]);
  }
}

function setVerificationStatus(id: string, status: number) {
  db.run("UPDATE channels SET verificationStatus = ? WHERE id = ?", [
    status,
    id,
  ]);
  cache.delete(id);
}

function isAdmin(userId: string) {
  const admins = process.env.ADMIN_DISCORD_IDS?.split(",") || [];
  return admins.includes(userId);
}

async function handleDiscordOAuth(code: string) {
  
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI!,
    }),
  });

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  console.log("Discord token response:", tokenData);

  if (!tokenData.access_token) throw new Error("OAuth failed");
  

  const user = (await fetch(
    "https://discord.com/api/users/@me",
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }
  ).then((res) => res.json())) as { id: string; username: string };

  return user;
}

async function resolveChannelId(rawId: string): Promise<{ id: string; name?: string }> {
  // Case 1: Already a UC channel ID
  if (rawId.startsWith("UC") && rawId.length >= 20) {
    return { id: rawId };
  }

  // Case 2: Handle like @SuperValidDesigns
  if (rawId.startsWith("@")) {
    const url = `https://www.youtube.com/${rawId}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();

    // Look for canonical link
    const match = html.match(/"channelId":"(UC[0-9A-Za-z_-]{21}[AQgw])"/);
    if (match) {
      return { id: match[1]!, name: rawId };
    }

    const linkMatch = html.match(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]+)"/
    );
    if (linkMatch) {
      return { id: linkMatch[1]!, name: rawId };
    }

    throw new Error("Could not resolve channel handle");
  }

  // Case 3: Full URL
  if (rawId.includes("youtube.com")) {
    const url = rawId;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();

    const match = html.match(/"channelId":"(UC[0-9A-Za-z_-]{21}[AQgw])"/);
    if (match) {
      return { id: match[1]! };
    }

    const linkMatch = html.match(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]+)"/
    );
    if (linkMatch) {
      return { id: linkMatch[1]! };
    }

    throw new Error("Could not resolve channel URL");
  }

  throw new Error("Invalid channel identifier");
}

// FIXED: Helper function to clean channel ID from URL paths
function cleanChannelId(rawId: string): string {
  // Case 1: If it's already a clean UC channel ID, return as-is
  if (rawId.startsWith("UC") && rawId.length >= 20 && !rawId.includes("/")) {
    return rawId;
  }
  
  // Case 2: If it's a valid channel handle (starts with @), return as-is
  if (rawId.startsWith("@")) {
    return rawId;
  }
  
  // Case 3: If it's a full URL or path, extract the relevant part
  if (rawId.includes("youtube.com") || rawId.includes("/")) {
    try {
      // Parse as URL if it looks like one
      let url: URL;
      if (rawId.includes("http")) {
        url = new URL(rawId);
      } else {
        // Try to construct a URL from the path
        const baseUrl = rawId.startsWith("/") ? `https://youtube.com${rawId}` : `https://youtube.com/${rawId}`;
        url = new URL(baseUrl);
      }
      
      let path = url.pathname;
      if (path.startsWith("/")) {
        path = path.substring(1);
      }
      
      // Split by slashes and check each segment
      const segments = path.split("/");
      for (const segment of segments) {
        // Check for UC ID
        if (segment.startsWith("UC") && segment.length >= 20) {
          return segment;
        }
        // Check for channel handle
        if (segment.startsWith("@")) {
          return segment;
        }
      }
      
      // If no valid segment found, return the first non-empty segment
      const firstSegment = segments.find(s => s.length > 0);
      if (firstSegment) {
        // If the first segment looks like a channel handle, return it as-is
        if (firstSegment.startsWith("@")) {
          return firstSegment;
        }
        // If it's a username-like identifier, try to resolve it
        return firstSegment;
      }
    } catch {
      // URL parsing failed, try regex fallback
    }
    
    // Regex fallback to extract UC ID or handle
    const ucMatch = rawId.match(/^UC[a-zA-Z0-9_-]{22}$|UC[a-zA-Z0-9_-]{22}\//);
    if (ucMatch) {
      return ucMatch[0].replace(/\//, '');
    }
    
    const handleMatch = rawId.match(/^@[^\/\s]+/);
    if (handleMatch) {
      return handleMatch[0];
    }
    
    // Fallback: extract any UC ID from the string
    const fallbackMatch = rawId.match(/UC[a-zA-Z0-9_-]{20,}/);
    if (fallbackMatch) {
      return fallbackMatch[0];
    }
  }
  
  // Return original if we can't clean it meaningfully
  return rawId;
}

serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      const origin = req.headers.get("Origin") || "";
      const pathname = url.pathname;
      const isChromeExtension = origin.startsWith("chrome-extension://");
      const userAgent = req.headers.get("User-Agent") || "";
      const isLikelyExtension = isChromeExtension || !origin;
      
      console.log(`[OPTIONS] ${pathname} from origin: "${origin}" (Chrome extension: ${isChromeExtension}, likely extension: ${isLikelyExtension})`);

      // Restrict preflight for /verify to ADMIN_ORIGIN only
      if (pathname === "/verify") {
        const isAllowed =
          origin === ADMIN_ORIGIN ||
          origin === "http://pem.ras-rap.click"; // allow http variant if needed

        if (!isAllowed) {
          console.log(`[OPTIONS] /verify blocked from origin: "${origin}"`);
          return new Response(null, { status: 403 });
        }

        console.log(`[OPTIONS] /verify allowed from origin: "${origin}"`);
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Vary": "Origin",
          },
        });
      }

      // For icons and all other endpoints, allow all origins including Chrome extensions
      const corsOrigin = getAllowedOrigin(req, pathname.startsWith("/icons/") ? "icons" : "default");
      console.log(`[OPTIONS] Allowing origin: "${corsOrigin}" for ${pathname}`);
      
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Vary": "Origin",
        },
      });
    }

    console.log(
      `[${new Date().toISOString()}] ${req.method} ${url.pathname} from ${
        req.headers.get("x-forwarded-for") || "local"
      }, Origin: "${req.headers.get("Origin") || "none"}", User-Agent: "${req.headers.get("User-Agent")?.substring(0, 50) || "none"}"`
    );

    try {
      await rateLimiter.consume(req.headers.get("x-forwarded-for") || "ip");
    } catch {
      return withCORS(JSON.stringify({ error: "Too Many Requests" }), 429, req);
    }

    // Discord OAuth login
    if (req.method === "GET" && url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code");
      if (!code) return withCORS(JSON.stringify({ error: "Missing code" }), 400, req);

      try {
        const user = await handleDiscordOAuth(code);
        const token = jwt.sign(
          { id: user.id, username: user.username },
          process.env.JWT_SECRET!,
          { expiresIn: "7d" }
        );
        return withCORS(JSON.stringify({ token, user }), 200, req);
      } catch (err) {
        return withCORS(JSON.stringify({ error: "Auth failed" }), 401, req);
      }
    }

    // ✅ NEW: /me endpoint
    if (req.method === "GET" && url.pathname === "/me") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return withCORS(JSON.stringify({ error: "Unauthorized" }), 401, req);
      }

      try {
        const token = authHeader.replace("Bearer ", "");
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
          id: string;
          username: string;
        };

        return withCORS(
          JSON.stringify({
            id: decoded.id,
            username: decoded.username,
            isAdmin: isAdmin(decoded.id),
          }),
          200,
          req
        );
      } catch {
        return withCORS(JSON.stringify({ error: "Unauthorized" }), 401, req);
      }
    }

    // Serve icons - FIXED to handle Chrome extension CORS properly
    if (req.method === "GET" && url.pathname.startsWith("/icons/")) {
      const filename = url.pathname.replace("/icons/", "");
      const filePath = join(ICONS_DIR, filename);
      
      console.log(`[ICONS] Serving ${filename} from ${filePath}, Origin: "${req.headers.get("Origin") || "none"}"`);

      try {
        await stat(filePath);
        const fileData = await readFile(filePath);
        const ext = filename.split(".").pop()?.toLowerCase();
        let contentType = "application/octet-stream";
        if (ext === "svg") contentType = "image/svg+xml";
        if (ext === "png") contentType = "image/png";

        // For icons, be very permissive - always allow Chrome extensions and requests without Origin
        const corsOrigin = getAllowedOrigin(req, "icons");
        console.log(`[ICONS] CORS origin for ${filename}: "${corsOrigin}"`);

        return withCORSFile(
          fileData,
          200,
          req,
          "icons",
          contentType,
          {
            "Cache-Control": "public, max-age=86400",
          }
        );
      } catch (error) {
        console.error(`[ICONS] Error serving ${filename}:`, error);
        return withCORS(JSON.stringify({ error: "Icon not found" }), 404, req, "icons");
      }
    }

    // Get channel - UPDATED with cleaning and resolution logic
    if (req.method === "GET" && url.pathname.startsWith("/channel/")) {
      const encodedId = url.pathname.split("/channel/")[1];
      if (!encodedId) return withCORS(JSON.stringify({ error: "Bad Request" }), 400, req);

      const rawId = decodeURIComponent(encodedId);
      if (!rawId) return withCORS(JSON.stringify({ error: "Bad Request" }), 400, req);

      // ✅ FIXED: Clean the channel ID first, then resolve it
      const cleanRawId = cleanChannelId(rawId);
      console.log(`[Channel] Raw ID: "${rawId}" -> Clean ID: "${cleanRawId}"`);

      try {
        const { id, name } = await resolveChannelId(cleanRawId);
        console.log(`[Channel] Resolved to UC ID: "${id}"`);

        const cached = getCachedChannel(id);
        if (cached) return withCORS(JSON.stringify(cached), 200, req);

        const channel = getChannel(id);
        if (name && channel.name === "Unknown") {
          db.run("UPDATE channels SET name = ? WHERE id = ?", [name, id]);
          channel.name = name;
        }

        setCachedChannel(id, channel);
        return withCORS(JSON.stringify(channel), 200, req);
      } catch (err) {
        console.error(`[Channel Error] Failed to resolve ${cleanRawId}:`, err);
        return withCORS(JSON.stringify({ error: "Failed to resolve channel" }), 400, req);
      }
    }

    if (req.method === "POST" && url.pathname === "/vote") {
      try {
        const body = (await req.json()) as VoteRequest;
        if (!body.channelId || !["yes", "no"].includes(body.vote)) {
          return withCORS(JSON.stringify({ error: "Invalid request" }), 400, req);
        }

        // ✅ FIXED: Clean the channel ID first, then resolve it
        const cleanRawId = cleanChannelId(body.channelId);
        console.log(`[Vote] Raw channel ID: "${body.channelId}" -> Clean: "${cleanRawId}"`);

        // Resolve the channel ID to get the actual UC ID
        let resolvedId: string;
        try {
          const { id } = await resolveChannelId(cleanRawId);
          resolvedId = id;
          console.log(`[Vote] Resolved to UC ID: "${resolvedId}"`);
        } catch (resolveErr) {
          console.error(`[Vote] Failed to resolve channel ID "${cleanRawId}":`, resolveErr);
          return withCORS(JSON.stringify({ error: "Failed to resolve channel ID" }), 400, req);
        }

        // ✅ FIXED: Validate the resolved UC ID, not the raw input
        if (!resolvedId.startsWith("UC") || resolvedId.length < 20) {
          return withCORS(JSON.stringify({ error: "Invalid channel ID" }), 400, req);
        }

        const ip = req.headers.get("x-forwarded-for") || "local";
        const voteKey = `${ip}:${resolvedId}`;

        try {
          await voteLimiter.consume(voteKey); // ⬅️ enforce 1 vote/minute per channel per IP
        } catch {
          return withCORS(
            JSON.stringify({ error: "You can only vote once per channel per minute" }),
            429,
            req
          );
        }

        getChannel(resolvedId);
        updateVote(resolvedId, body.vote as "yes" | "no");
        cache.delete(resolvedId);

        return withCORS(JSON.stringify({ success: true }), 200, req);
      } catch {
        return withCORS(JSON.stringify({ error: "Bad Request" }), 400, req);
      }
    }

    if (req.method === "POST" && url.pathname === "/verify") {
      const origin = req.headers.get("Origin") || "";
      const isAllowedOrigin =
        !origin || origin === ADMIN_ORIGIN || origin === "http://pem.ras-rap.click";
      
      if (!isAllowedOrigin) {
        console.log(`[VERIFY] CORS blocked from origin: "${origin}"`);
        return new Response(JSON.stringify({ error: "CORS Forbidden" }), {
          status: 403,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin || ADMIN_ORIGIN,
          },
        });
      }

      const allowedOriginHeader = origin || ADMIN_ORIGIN;

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return withCORS(JSON.stringify({ error: "Unauthorized" }), 401, req, "admin");

      try {
        const token = authHeader.replace("Bearer ", "");
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
          id: string;
        };
        if (!isAdmin(decoded.id)) {
          return withCORS(JSON.stringify({ error: "Forbidden" }), 403, req, "admin");
        }

        const body = (await req.json()) as VerifyRequest;
        if (!body.channelId || ![0, 1, 2].includes(body.status)) {
          return withCORS(JSON.stringify({ error: "Invalid request" }), 400, req, "admin");
        }

        // ✅ FIXED: Clean the channel ID first, then resolve it
        const cleanRawId = cleanChannelId(body.channelId);
        console.log(`[Verify] Raw channel ID: "${body.channelId}" -> Clean: "${cleanRawId}"`);

        // Resolve the channel ID to get the actual UC ID
        let resolvedId: string;
        try {
          const { id } = await resolveChannelId(cleanRawId);
          resolvedId = id;
          console.log(`[Verify] Resolved to UC ID: "${resolvedId}"`);
        } catch (resolveErr) {
          console.error(`[Verify] Failed to resolve channel ID "${cleanRawId}":`, resolveErr);
          return withCORS(JSON.stringify({ error: "Failed to resolve channel ID" }), 400, req, "admin");
        }

        // ✅ FIXED: Validate the resolved UC ID, not the raw input
        if (!resolvedId.startsWith("UC") || resolvedId.length < 20) {
          return withCORS(JSON.stringify({ error: "Invalid channel ID" }), 400, req, "admin");
        }

        getChannel(resolvedId);
        setVerificationStatus(resolvedId, body.status);
        return withCORS(JSON.stringify({ success: true }), 200, req, "admin");
      } catch {
        return withCORS(JSON.stringify({ error: "Unauthorized" }), 401, req, "admin");
      }
    }

    return withCORS(JSON.stringify({ error: "Not Found" }), 404, req);
  },
});

console.log(`🚀 Server running on http://localhost:${PORT}`);
console.log(`📦 Serving icons from ${ICONS_DIR}`);