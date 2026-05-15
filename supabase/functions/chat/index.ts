import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// ── Google Service Account JWT (sans lib externe) ──────────────────────────

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\n/g, "")
    .trim();
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function base64url(data: string | Uint8Array): string {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    bytes = new TextEncoder().encode(data);
  } else {
    bytes = data;
  }
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function makeGoogleJWT(sa: ServiceAccountKey, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = base64url(new Uint8Array(signature));
  return `${signingInput}.${sigB64}`;
}

async function getGoogleAccessToken(sa: ServiceAccountKey, scope: string): Promise<string> {
  const jwt = await makeGoogleJWT(sa, scope);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Google OAuth2 error: ${data.error_description || data.error || JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ── Types Drive ────────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

interface DriveFileResult {
  filename: string;
  type: string;
  content: string;
  modifiedTime: string;
}

async function exportDriveFile(file: DriveFile, token: string): Promise<DriveFileResult | null> {
  const authHeader = { Authorization: `Bearer ${token}` };
  let exportUrl: string;
  let type: string;

  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`;
    type = "csv";
  } else if (file.mimeType === "application/vnd.google-apps.document") {
    exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
    type = "txt";
  } else {
    return null; // PDF et autres → ticket suivant
  }

  try {
    const res = await fetch(exportUrl, { headers: authHeader });
    if (!res.ok) { console.error(`Export failed for ${file.name}: ${res.status}`); return null; }
    const content = await res.text();
    return { filename: file.name, type, content: content.substring(0, 4000), modifiedTime: file.modifiedTime };
  } catch (e) {
    console.error(`Export error for ${file.name}:`, e);
    return null;
  }
}

// ── Serve ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });

  try {
    const body = await req.json();
    const { system, message, action, client_id, history, folder_id } = body;
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const GOOGLE_SA_KEY_RAW = Deno.env.get("GOOGLE_SA_KEY");

    if (!ANTHROPIC_KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_KEY non configurée" }), { status: 500, headers });

    // ── summarize_session ──────────────────────────────────────────────────
    if (action === "summarize_session") {
      if (!client_id || !history || !Array.isArray(history) || history.length === 0)
        return new Response(JSON.stringify({ error: "client_id et history requis" }), { status: 400, headers });

      const historyText = history
        .map((m: { role: string; text: string }) => `${m.role === "u" ? "Utilisateur" : "Assistant"} : ${m.text}`)
        .join("\n");

      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 600,
          system: "Tu es un assistant qui résume des sessions de travail de manière factuelle et concise. Tu reçois un historique de conversation et tu produis un résumé structuré.",
          messages: [{ role: "user", content: "Résume cette session en 5 points max : décisions prises, infos importantes, actions à faire. Format : liste à tirets, sois factuel et concis. Ne mets pas de titre.\n\nSession :\n" + historyText }],
        }),
      });

      const claudeData = await claudeRes.json();
      if (claudeData.error) return new Response(JSON.stringify({ error: claudeData.error.message }), { status: 400, headers });

      const summaryText = claudeData.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("") || "";

      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { error: insertError } = await sbAdmin.from("session_summaries").insert({ client_id, summary_text: summaryText });
        if (insertError) {
          console.error("Insert session_summary error:", insertError.message);
          return new Response(JSON.stringify({ saved: false, summary: summaryText, error: insertError.message }), { status: 200, headers });
        }
      } else {
        return new Response(JSON.stringify({ saved: false, summary: summaryText, error: "Supabase vars manquantes" }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ saved: true, summary: summaryText }), { status: 200, headers });
    }

    // ── read_drive_folder ──────────────────────────────────────────────────
    if (action === "read_drive_folder") {
      const folderId = folder_id || message;

      if (!folderId) return new Response(JSON.stringify({ error: "folder_id requis" }), { status: 400, headers });

      if (!GOOGLE_SA_KEY_RAW)
        return new Response(JSON.stringify({ error: "GOOGLE_SA_KEY non configurée dans les secrets Supabase." }), { status: 500, headers });

      let sa: ServiceAccountKey;
      try {
        sa = JSON.parse(GOOGLE_SA_KEY_RAW);
        if (!sa.client_email || !sa.private_key) throw new Error("Champs client_email / private_key manquants");
      } catch (e) {
        return new Response(JSON.stringify({ error: `GOOGLE_SA_KEY invalide : ${(e as Error).message}` }), { status: 500, headers });
      }

      let token: string;
      try {
        token = await getGoogleAccessToken(sa, "https://www.googleapis.com/auth/drive.readonly");
      } catch (e) {
        return new Response(JSON.stringify({ error: `Auth Google échouée : ${(e as Error).message}` }), { status: 500, headers });
      }

      // Lister les fichiers du dossier
      const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
      listUrl.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
      listUrl.searchParams.set("fields", "files(id,name,mimeType,modifiedTime)");
      listUrl.searchParams.set("pageSize", "20");
      listUrl.searchParams.set("orderBy", "modifiedTime desc");

      const listRes = await fetch(listUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
      const listData = await listRes.json();

      if (!listRes.ok) {
        const msg = (listRes.status === 403 || listRes.status === 404)
          ? `Dossier inaccessible. Partage ce dossier Drive avec : ${sa.client_email} (accès Lecteur).`
          : `Drive API error ${listRes.status}: ${JSON.stringify(listData)}`;
        return new Response(JSON.stringify({ error: msg, files: [] }), { status: 200, headers });
      }

      const driveFiles: DriveFile[] = listData.files || [];

      if (driveFiles.length === 0) {
        return new Response(
          JSON.stringify({ files: [], message: `Dossier vide ou non partagé avec ${sa.client_email}.` }),
          { status: 200, headers }
        );
      }

      // Exporter le contenu de chaque fichier en parallèle
      const results = await Promise.all(driveFiles.slice(0, 20).map((f) => exportDriveFile(f, token)));
      const files: DriveFileResult[] = results.filter((r): r is DriveFileResult => r !== null);

      return new Response(JSON.stringify({ files, sa_email: sa.client_email }), { status: 200, headers });
    }

    // ── Appel Claude normal ────────────────────────────────────────────────
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system,
        messages: [{ role: "user", content: message }],
      }),
    });

    const data = await r.json();
    if (data.error) return new Response(JSON.stringify({ error: data.error.message }), { status: 400, headers });

    const text = data.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("") || "";
    return new Response(JSON.stringify({ text }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers });
  }
});
