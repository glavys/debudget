import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BOT_TOKEN = Deno.env.get("TG_BOT_TOKEN") ?? "";
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") ?? "";

const encoder = new TextEncoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildDataCheckString(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  params.delete("hash");
  const pairs: string[] = [];
  params.sort();
  for (const [key, value] of params) {
    pairs.push(`${key}=${value}`);
  }
  return { hash, dataCheckString: pairs.join("\n") };
}

async function verifyTelegram(initData: string) {
  const { hash, dataCheckString } = buildDataCheckString(initData);
  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const keyHash = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    encoder.encode(BOT_TOKEN)
  );
  const signingKey = await crypto.subtle.importKey(
    "raw",
    keyHash,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    encoder.encode(dataCheckString)
  );
  const hex = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return hex === hash;
}

function base64url(input: string) {
  return btoa(input).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signJwt(payload: Record<string, unknown>) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const toSign = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(toSign)
  );
  const sig = base64url(String.fromCharCode(...new Uint8Array(signature)));
  return `${toSign}.${sig}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const { initData } = await req.json();
  if (!initData || !BOT_TOKEN || !JWT_SECRET) {
    return new Response("Missing initData or secrets", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const ok = await verifyTelegram(initData);
  if (!ok) {
    return new Response("Invalid initData", { status: 401, headers: corsHeaders });
  }

  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");
  if (!userRaw) {
    return new Response("No user info", { status: 400, headers: corsHeaders });
  }

  const user = JSON.parse(userRaw);
  const userId = String(user.id);

  const token = await signJwt({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  });

  return new Response(JSON.stringify({ token }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
