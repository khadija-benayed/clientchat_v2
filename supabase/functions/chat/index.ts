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
  let isPdf = false;

  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`;
    type = "csv";
  } else if (file.mimeType === "application/vnd.google-apps.document") {
    exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
    type = "txt";
  } else if (file.mimeType === "application/pdf") {
    // PDF natif Drive (pas un Google Doc) → téléchargement direct binaire
    exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
    type = "pdf";
    isPdf = true;
  } else {
    return null; // images, vidéos, etc. → ignoré
  }

  try {
    const res = await fetch(exportUrl, { headers: authHeader });
    if (!res.ok) { console.error(`Export failed for ${file.name}: ${res.status}`); return null; }

    if (isPdf) {
      // PDF → retourner le contenu base64 pour que index_source puisse le traiter
      const arrayBuf = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      // Encoder en base64 (btoa sur Deno avec Uint8Array)
      let binary = "";
      bytes.forEach(b => { binary += String.fromCharCode(b); });
      const b64 = btoa(binary);
      // On retourne le base64 dans content avec un marqueur spécial
      // index_source détectera ce marqueur et appellera Claude pour extraire le texte
      return {
        filename: file.name,
        type: "pdf",
        content: `__PDF_BASE64__${b64}`,
        modifiedTime: file.modifiedTime,
      };
    }

    const content = await res.text();
    // Budget : 50 000 chars ≈ 12 500 tokens par fichier.
    return { filename: file.name, type, content: content.substring(0, 50_000), modifiedTime: file.modifiedTime };
  } catch (e) {
    console.error(`Export error for ${file.name}:`, e);
    return null;
  }
}

// ── Chunking ───────────────────────────────────────────────────────────────

/**
 * Découpe un texte brut en chunks avec overlap.
 * maxChars = 2000 chars ≈ 500 tokens — bon compromis précision / coût pour voyage-3.
 * overlap = 200 chars pour éviter de perdre le contexte aux jonctions.
 */
function chunkText(text: string, maxChars = 2000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += maxChars - overlap;
  }
  return chunks;
}

/**
 * Découpe un CSV/Sheet par blocs de lignes entières.
 * Le header est répété dans chaque chunk pour préserver le contexte colonnes.
 * Évite de couper une ligne de tableau en plein milieu (problème du chunkText naïf sur CSV).
 */
function chunkCSV(text: string, linesPerChunk = 50): string[] {
  const lines = text.split("\n");
  if (lines.length <= 1) return lines[0] ? [lines[0]] : [];
  const header = lines[0];
  const chunks: string[] = [];
  for (let i = 1; i < lines.length; i += linesPerChunk) {
    const block = lines.slice(i, i + linesPerChunk).filter(l => l.trim() !== "");
    if (block.length === 0) continue;
    chunks.push(header + "\n" + block.join("\n"));
  }
  return chunks;
}

// ── Embeddings Voyage AI ───────────────────────────────────────────────────

/**
 * Vectorise un tableau de chunks via Voyage AI (voyage-3, 1024 dims).
 * Batchée par 128 inputs max (limite API Voyage AI).
 * Retourne les embeddings dans le même ordre que les chunks en entrée.
 */
async function embedChunks(chunks: string[], voyageKey: string): Promise<number[][]> {
  const BATCH_SIZE = 128;
  const batches: string[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    batches.push(chunks.slice(i, i + BATCH_SIZE));
  }

  const allEmbeddings: number[][] = [];
  for (const batch of batches) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${voyageKey}`,
      },
      body: JSON.stringify({
        model: "voyage-3", // 1024 dims — validé CC-202b
        input: batch,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Voyage AI HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error(`Voyage AI réponse invalide: ${JSON.stringify(data)}`);
    }

    // L'API Voyage retourne les embeddings avec un champ `index` — trier pour garantir l'ordre
    const sorted = (data.data as { index: number; embedding: number[] }[])
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);

    allEmbeddings.push(...sorted);
  }

  return allEmbeddings;
}

// ── Recherche sémantique — CC-203 ─────────────────────────────────────────

/**
 * Vectorise un message utilisateur via Voyage AI.
 * Utilise voyage-3 (1024 dims) — MÊME modèle que l'indexation CC-202.
 * Important : mélanger les modèles (voyage-3 vs voyage-3-lite) invalide la similarité cosinus.
 */
async function embedQuery(text: string, voyageKey: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${voyageKey}`,
    },
    body: JSON.stringify({
      model: "voyage-3", // même modèle que CC-202 — ne pas changer
      input: [text],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage AI embedQuery HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  if (!data.data?.[0]?.embedding) {
    throw new Error(`Voyage AI embedQuery réponse invalide: ${JSON.stringify(data)}`);
  }
  return data.data[0].embedding;
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

      // CC-208 — Indexer le résumé dans document_chunks pour la recherche sémantique
      // source_type = 'session' → badge 🕐 dans le front (CC-203 sourceIcon)
      // Le delete-before-insert dans index_source gère la déduplication automatiquement
      const VOYAGE_KEY_SUM = Deno.env.get("VOYAGE_API_KEY");
      if (VOYAGE_KEY_SUM) {
        try {
          const sbAdmin2 = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
          const sessionDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
          const sessionSourceName = `Session du ${sessionDate}`;

          // Supprimer un éventuel chunk existant pour cette date (idempotent)
          await sbAdmin2
            .from("document_chunks")
            .delete()
            .match({ client_id, source_name: sessionSourceName });

          // Vectoriser et insérer
          const embedding = await embedQuery(summaryText, VOYAGE_KEY_SUM);
          await sbAdmin2.from("document_chunks").insert({
            client_id,
            source_type: "session",
            source_name: sessionSourceName,
            chunk_text: summaryText,
            embedding,
          });
        } catch (idxErr) {
          // Non bloquant — le résumé est déjà sauvegardé dans session_summaries
          console.error("CC-208 index session error (non bloquant):", (idxErr as Error).message);
        }
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

      // Lister récursivement TOUS les fichiers avec pagination complète (nextPageToken).
      // Protection anti-boucle infinie : visiter chaque dossier une seule fois.
      // Limite globale : MAX_FILES pour éviter les dossiers géants (mémoire + timeout).
      const visitedFolders = new Set<string>();
      const MAX_FILES = 500; // au-delà de 500 fichiers, on tronque volontairement
      let totalFilesFound = 0;

      async function listFilesInFolder(fId: string): Promise<DriveFile[]> {
        if (visitedFolders.has(fId)) return [];
        if (totalFilesFound >= MAX_FILES) return [];
        visitedFolders.add(fId);

        const allItems: DriveFile[] = [];
        let pageToken: string | undefined = undefined;

        // Pagination : boucler jusqu'à ce qu'il n'y ait plus de nextPageToken
        do {
          const url = new URL("https://www.googleapis.com/drive/v3/files");
          url.searchParams.set("q", `'${fId}' in parents and trashed = false`);
          // nextPageToken inclus dans fields pour pouvoir paginer
          url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime)");
          url.searchParams.set("pageSize", "100"); // max autorisé par l'API Drive
          url.searchParams.set("supportsAllDrives", "true");
          url.searchParams.set("includeItemsFromAllDrives", "true");
          if (pageToken) url.searchParams.set("pageToken", pageToken);

          const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) break;
          const data = await res.json();

          allItems.push(...(data.files || []));
          pageToken = data.nextPageToken; // undefined si dernière page
        } while (pageToken);

        const files = allItems.filter(f => f.mimeType !== "application/vnd.google-apps.folder");
        const subFolders = allItems.filter(f => f.mimeType === "application/vnd.google-apps.folder");

        totalFilesFound += files.length;

        // Récursion sur les sous-dossiers (limit globale MAX_FILES respectée)
        const subFiles = await Promise.all(subFolders.map(sf => listFilesInFolder(sf.id)));
        return [...files, ...subFiles.flat()];
      }

      const allFiles = await listFilesInFolder(folderId);

      if (!allFiles.length) {
        return new Response(
          JSON.stringify({ files: [], message: `Aucun fichier trouvé. Vérifie que le dossier est partagé avec ${sa.client_email}.` }),
          { status: 200, headers }
        );
      }

      // Trier par date de modification décroissante, prendre les 20 plus récents
      allFiles.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());

      const results = await Promise.all(allFiles.slice(0, 50).map((f) => exportDriveFile(f, token)));
      const files: DriveFileResult[] = results.filter((r): r is DriveFileResult => r !== null);

      return new Response(JSON.stringify({ files, sa_email: sa.client_email }), { status: 200, headers });
    }

    // ── list_drive_metadata — CC-210 ───────────────────────────────────────
    // Retourne uniquement {id, name, mimeType, modifiedTime} pour tous les fichiers du dossier.
    // N'appelle PAS exportDriveFile — aucun téléchargement de contenu.
    // Utilisé par checkDriveUpdates() pour la vérification légère initiale (~100ms).
    // Entrée : { action: 'list_drive_metadata', folder_id: string }
    // Sortie : { files: [{id, name, mimeType, modifiedTime}], sa_email: string }
    if (action === "list_drive_metadata") {
      const folderId = body.folder_id;
      if (!folderId)
        return new Response(JSON.stringify({ error: "folder_id requis" }), { status: 400, headers });

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

      // Même récursion que read_drive_folder — sans exportDriveFile — avec pagination complète
      const visited = new Set<string>();
      let metaTotalFound = 0;
      const META_MAX = 500;

      async function listMetaInFolder(fId: string): Promise<DriveFile[]> {
        if (visited.has(fId)) return [];
        if (metaTotalFound >= META_MAX) return [];
        visited.add(fId);

        const allItems: DriveFile[] = [];
        let pageToken: string | undefined = undefined;

        do {
          const url = new URL("https://www.googleapis.com/drive/v3/files");
          url.searchParams.set("q", `'${fId}' in parents and trashed = false`);
          url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime)");
          url.searchParams.set("pageSize", "100");
          url.searchParams.set("supportsAllDrives", "true");
          url.searchParams.set("includeItemsFromAllDrives", "true");
          if (pageToken) url.searchParams.set("pageToken", pageToken);

          const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) break;
          const data = await res.json();

          allItems.push(...(data.files || []));
          pageToken = data.nextPageToken;
        } while (pageToken);

        const files = allItems.filter(f => f.mimeType !== "application/vnd.google-apps.folder");
        const subFolders = allItems.filter(f => f.mimeType === "application/vnd.google-apps.folder");
        metaTotalFound += files.length;
        const subFiles = await Promise.all(subFolders.map(sf => listMetaInFolder(sf.id)));
        return [...files, ...subFiles.flat()];
      }

      const allFiles = await listMetaInFolder(folderId);
      // Retourner uniquement les champs de métadonnées — pas de contenu
      const metaFiles = allFiles.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
      }));

      return new Response(JSON.stringify({ files: metaFiles, sa_email: sa.client_email }), { status: 200, headers });
    }

    // ── generate_brief ─────────────────────────────────────────────────────
    // Entrée : { action: 'generate_brief', client_id: string, docs_content: {filename, content}[] }
    // Sortie : { brief: { secteur, enjeux_principaux, kpis, equipe, historique, notes } }
    if (action === "generate_brief") {
      if (!client_id || !Array.isArray(body.docs_content) || body.docs_content.length === 0)
        return new Response(JSON.stringify({ error: "client_id et docs_content (array non vide) requis" }), { status: 400, headers });

      // Concaténer le contenu des docs en respectant un budget de ~8000 tokens (≈ 32 000 chars)
      const TOKEN_BUDGET = 96_000; // ~24k tokens — suffisant pour 15-20 docs, dans la fenêtre Sonnet 4.6 (200k)
      let totalChars = 0;
      const docBlocks: string[] = [];
      for (const doc of body.docs_content as { filename: string; content: string }[]) {
        const block = `### ${doc.filename}\n${doc.content}`;
        if (totalChars + block.length > TOKEN_BUDGET) break;
        docBlocks.push(block);
        totalChars += block.length;
      }
      const docsText = docBlocks.join("\n\n---\n\n");

      const briefPrompt =
        "À partir de ces documents, génère une fiche client JSON avec exactement ces champs :\n" +
        "- secteur (string)\n" +
        "- enjeux_principaux (array de strings, max 5)\n" +
        "- kpis (array de strings, max 5)\n" +
        "- equipe (array de strings)\n" +
        "- historique (string, 2-3 phrases)\n" +
        "- notes (string)\n\n" +
        "Réponds UNIQUEMENT avec le JSON valide, sans texte autour, sans markdown.\n\n" +
        "Documents :\n\n" + docsText;

      const briefRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          // Pas de system prompt : on veut UNIQUEMENT du JSON en sortie
          messages: [{ role: "user", content: briefPrompt }],
        }),
      });

      const briefData = await briefRes.json();
      if (briefData.error)
        return new Response(JSON.stringify({ error: briefData.error.message }), { status: 400, headers });

      const rawText = briefData.content
        ?.filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("") || "";

      // Parser avec nettoyage défensif des éventuelles balises markdown
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      let brief: unknown;
      try {
        brief = JSON.parse(cleaned);
      } catch (_) {
        console.error("generate_brief: JSON invalide reçu de Claude :", rawText.substring(0, 200));
        return new Response(
          JSON.stringify({ error: "Génération échouée — Claude n'a pas retourné un JSON valide. Réessaie." }),
          { status: 422, headers }
        );
      }

      // Valider les 6 champs attendus (présence, pas les valeurs)
      const expectedKeys = ["secteur", "enjeux_principaux", "kpis", "equipe", "historique", "notes"];
      const missingKeys = expectedKeys.filter(k => !(k in (brief as Record<string, unknown>)));
      if (missingKeys.length > 0) {
        console.error("generate_brief: champs manquants :", missingKeys);
        return new Response(
          JSON.stringify({ error: `Génération incomplète — champs manquants : ${missingKeys.join(", ")}. Réessaie.` }),
          { status: 422, headers }
        );
      }

      // Sauvegarder la fiche dans clients.context si Supabase dispo
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { error: updateError } = await sbAdmin
          .from("clients")
          .update({ context: JSON.stringify(brief) })
          .eq("id", client_id);
        if (updateError) {
          console.error("generate_brief: update clients.context error:", updateError.message);
          // On retourne quand même la fiche — le front peut faire son propre update
          return new Response(JSON.stringify({ brief, saved: false, error: updateError.message }), { status: 200, headers });
        }
      }

      return new Response(JSON.stringify({ brief, saved: true }), { status: 200, headers });
    }

    // ── index_source ───────────────────────────────────────────────────────
    // Entrée : { action: 'index_source', client_id, source_type, source_name, content }
    // Sortie : { chunks_created: number }
    if (action === "index_source") {
      // ── 0. Valider les secrets et les paramètres requis ──────────────────
      const VOYAGE_KEY = Deno.env.get("VOYAGE_API_KEY");
      if (!VOYAGE_KEY) {
        return new Response(
          JSON.stringify({ error: "VOYAGE_API_KEY non configurée dans les secrets Supabase." }),
          { status: 500, headers }
        );
      }
      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return new Response(
          JSON.stringify({ error: "Variables Supabase manquantes (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." }),
          { status: 500, headers }
        );
      }

      const { source_type, source_name, content } = body;
      if (!source_name || !source_type || !content) {
        return new Response(
          JSON.stringify({ error: "Paramètres requis : source_type, source_name, content." }),
          { status: 400, headers }
        );
      }
      if (typeof content !== "string" || content.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: "content est vide ou invalide." }),
          { status: 400, headers }
        );
      }

      const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

      // ── 1. Découper selon le type de source ─────────────────────────────
      // Si le contenu est un PDF base64 (marqueur __PDF_BASE64__), extraire le texte
      // via Claude avant de chunker — Claude supporte nativement les PDFs en base64.
      let textContent = content as string;

      if (textContent.startsWith("__PDF_BASE64__")) {
        const pdfB64 = textContent.slice("__PDF_BASE64__".length);
        try {
          const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": ANTHROPIC_KEY!,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 4000,
              messages: [{
                role: "user",
                content: [
                  {
                    type: "document",
                    source: { type: "base64", media_type: "application/pdf", data: pdfB64 },
                  },
                  {
                    type: "text",
                    text: "Extrais tout le texte de ce document de manière fidèle et complète. Inclus les titres, sous-titres, tableaux (format texte), listes et corps de texte. Ne résume pas — retranscris le contenu intégral.",
                  },
                ],
              }],
            }),
          });
          const claudeData = await claudeRes.json();
          if (claudeData.error) throw new Error(claudeData.error.message);
          textContent = claudeData.content
            ?.filter((c: { type: string }) => c.type === "text")
            .map((c: { text: string }) => c.text)
            .join("") || "";
          if (!textContent.trim()) throw new Error("Extraction PDF vide");
        } catch (pdfErr) {
          console.error("index_source: PDF extraction error:", (pdfErr as Error).message);
          return new Response(
            JSON.stringify({ error: `Extraction PDF échouée : ${(pdfErr as Error).message}` }),
            { status: 502, headers }
          );
        }
      }

      const isCSV = source_type === "sheet" || (source_name as string).endsWith(".csv");
      const chunks = isCSV ? chunkCSV(textContent) : chunkText(textContent);

      if (chunks.length === 0) {
        return new Response(
          JSON.stringify({ error: "Aucun chunk généré — contenu trop court ou vide." }),
          { status: 400, headers }
        );
      }

      // ── 2. Supprimer les anciens chunks de cette source ──────────────────
      const { error: deleteError } = await sbAdmin
        .from("document_chunks")
        .delete()
        .match({ client_id: client_id || null, source_name });

      if (deleteError) {
        console.error("index_source: delete anciens chunks error:", deleteError.message);
        // Non bloquant — on continue : l'insert va créer les nouveaux chunks
      }

      // ── 3. Vectoriser avec Voyage AI ─────────────────────────────────────
      let embeddings: number[][];
      try {
        embeddings = await embedChunks(chunks, VOYAGE_KEY);
      } catch (e) {
        console.error("index_source: embedChunks error:", (e as Error).message);
        return new Response(
          JSON.stringify({ error: `Voyage AI: ${(e as Error).message}` }),
          { status: 502, headers }
        );
      }

      if (embeddings.length !== chunks.length) {
        return new Response(
          JSON.stringify({ error: `Incohérence : ${chunks.length} chunks mais ${embeddings.length} embeddings reçus.` }),
          { status: 500, headers }
        );
      }

      // ── 4. Insérer dans document_chunks ──────────────────────────────────
      const now = new Date().toISOString();
      const rows = chunks.map((chunk, i) => ({
        client_id: client_id || null, // null possible pour fiches entreprise Phase 3
        source_type,
        source_name,
        chunk_text: chunk,
        embedding: embeddings[i],
        last_indexed_at: now, // CC-209 — horodatage pour détection de stale
      }));

      const { error: insertError } = await sbAdmin.from("document_chunks").insert(rows);
      if (insertError) {
        console.error("index_source: insert document_chunks error:", insertError.message);
        return new Response(
          JSON.stringify({ error: `Erreur insertion chunks : ${insertError.message}` }),
          { status: 500, headers }
        );
      }

      // ── 5. Logger dans embedding_logs (CC-207) ───────────────────────────
      const tokensEstimated = chunks.reduce((acc, c) => acc + Math.ceil(c.length / 4), 0);
      const { error: logError } = await sbAdmin.from("embedding_logs").insert({
        client_id: client_id || null,
        source_name,
        chunks_count: chunks.length,
        tokens_estimated: tokensEstimated,
      });
      if (logError) {
        // Non bloquant — le log est informatif, l'indexation est déjà faite
        console.error("index_source: insert embedding_logs error:", logError.message);
      }

      return new Response(
        JSON.stringify({ chunks_created: chunks.length }),
        { status: 200, headers }
      );
    }

    // ── check_updates — CC-209 ────────────────────────────────────────────
    // Compare modifiedTime Drive vs last_indexed_at en base.
    // Re-indexe en arrière-plan les fichiers modifiés depuis la dernière indexation.
    // Entrée : { action: 'check_updates', client_id, files: [{source_name, source_type, content, modifiedTime}] }
    // Sortie : { updated: [{source_name}], checked: number }
    if (action === "check_updates") {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return new Response(JSON.stringify({ error: "Variables Supabase manquantes." }), { status: 500, headers });
      }
      const VOYAGE_KEY_CU = Deno.env.get("VOYAGE_API_KEY");
      if (!VOYAGE_KEY_CU) {
        return new Response(JSON.stringify({ error: "VOYAGE_API_KEY manquante." }), { status: 500, headers });
      }

      const { files } = body as {
        files: { source_name: string; source_type: string; content: string; modifiedTime: string }[];
      };
      if (!files || !Array.isArray(files) || files.length === 0) {
        return new Response(JSON.stringify({ updated: [], checked: 0 }), { status: 200, headers });
      }

      const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const updated: string[] = [];

      for (const file of files) {
        // Récupérer le last_indexed_at le plus récent pour ce fichier/client
        const { data: existing } = await sbAdmin
          .from("document_chunks")
          .select("last_indexed_at")
          .match({ client_id: client_id || null, source_name: file.source_name })
          .order("last_indexed_at", { ascending: false })
          .limit(1)
          .single();

        const lastIndexed = existing?.last_indexed_at
          ? new Date(existing.last_indexed_at).getTime()
          : 0;
        const modifiedTs = new Date(file.modifiedTime).getTime();

        // Re-indexer seulement si le doc a été modifié après la dernière indexation
        if (modifiedTs <= lastIndexed) continue;

        try {
          const isCSV = file.source_type === "sheet" || file.source_name.endsWith(".csv");
          const chunks = isCSV ? chunkCSV(file.content) : chunkText(file.content);
          if (chunks.length === 0) continue;

          const embeddings = await embedChunks(chunks, VOYAGE_KEY_CU);
          if (embeddings.length !== chunks.length) continue;

          // Supprimer anciens chunks + insérer nouveaux
          await sbAdmin.from("document_chunks").delete()
            .match({ client_id: client_id || null, source_name: file.source_name });

          const indexedAt = new Date().toISOString();
          const rows = chunks.map((chunk, i) => ({
            client_id: client_id || null,
            source_type: file.source_type,
            source_name: file.source_name,
            chunk_text: chunk,
            embedding: embeddings[i],
            last_indexed_at: indexedAt,
          }));
          await sbAdmin.from("document_chunks").insert(rows);

          // Logger la re-indexation
          await sbAdmin.from("embedding_logs").insert({
            client_id: client_id || null,
            source_name: file.source_name,
            chunks_count: chunks.length,
            tokens_estimated: chunks.reduce((acc, c) => acc + Math.ceil(c.length / 4), 0),
          });

          updated.push(file.source_name);
        } catch (e) {
          console.error(`check_updates: re-indexation ${file.source_name} error:`, (e as Error).message);
          // Non bloquant — on continue avec les autres fichiers
        }
      }

      return new Response(
        JSON.stringify({ updated, checked: files.length }),
        { status: 200, headers }
      );
    }

    // ── delete_source_chunks — purge complète des embeddings d'une source ─
    // Entrée A (PDF) : { action: 'delete_source_chunks', client_id, source_name }
    // Entrée B (Drive) : { action: 'delete_source_chunks', client_id, source_type_filter: ['doc','sheet'] }
    // Sortie : { deleted: true }
    if (action === "delete_source_chunks") {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return new Response(JSON.stringify({ error: "Variables Supabase manquantes." }), { status: 500, headers });
      }

      const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { source_name: srcName, source_type_filter } = body;

      let delResult;

      if (source_type_filter && Array.isArray(source_type_filter)) {
        // Mode Drive : supprimer TOUS les chunks doc/sheet de ce client
        // Les fichiers Drive sont indexés par leur nom individuel (file.filename),
        // pas par le nom de la source Drive — on filtre donc par type.
        if (client_id) {
          delResult = await sbAdmin
            .from("document_chunks")
            .delete()
            .eq("client_id", client_id)
            .in("source_type", source_type_filter);
        } else {
          delResult = await sbAdmin
            .from("document_chunks")
            .delete()
            .in("source_type", source_type_filter);
        }
      } else if (srcName) {
        // Mode PDF : supprimer par source_name exact
        if (client_id) {
          delResult = await sbAdmin
            .from("document_chunks")
            .delete()
            .eq("source_name", srcName)
            .eq("client_id", client_id);
        } else {
          delResult = await sbAdmin
            .from("document_chunks")
            .delete()
            .eq("source_name", srcName);
        }
      } else {
        return new Response(JSON.stringify({ error: "source_name ou source_type_filter requis." }), { status: 400, headers });
      }

      if (delResult.error) {
        console.error("delete_source_chunks error:", delResult.error.message);
        return new Response(JSON.stringify({ error: delResult.error.message }), { status: 500, headers });
      }

      console.log(`delete_source_chunks: purge client ${client_id || "global"} — mode ${source_type_filter ? "type:" + source_type_filter.join(",") : "name:" + srcName}.`);
      return new Response(JSON.stringify({ deleted: true }), { status: 200, headers });
    }

    // ── RAG — CC-203 : recherche sémantique avant appel Claude ───────────
    // Vectorise le message utilisateur et injecte les chunks pertinents dans le system prompt.
    // Fiche client (CC-107) reste en haut — chunks RAG ajoutés en dessous.
    const VOYAGE_KEY = Deno.env.get("VOYAGE_API_KEY");
    let systemWithRAG = system || "";
    let sourcesUsed: { source_name: string; source_type: string; preview: string }[] = [];

    if (message && VOYAGE_KEY && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // 1. Vectoriser la question
        const queryEmbedding = await embedQuery(message, VOYAGE_KEY);

        // 2. Chercher les 5 chunks les plus proches via match_chunks()
        const { data: chunks, error: matchError } = await sbAdmin.rpc("match_chunks", {
          query_embedding: queryEmbedding,
          p_client_id: client_id || null,
          match_count: 5,
        });

        if (matchError) {
          console.error("RAG match_chunks error:", matchError.message);
        } else {
          // 3. Filtrer par seuil de pertinence
          // 0.65 au lieu de 0.75 : les docs analytiques (plans de marquage, specs techniques)
          // ont une sémantique plus distante des questions métier mais restent pertinents.
          const relevant = (chunks || []).filter((c: { similarity: number }) => c.similarity > 0.65);

          if (relevant.length > 0) {
            // Injecter les chunks sous la fiche client
            const ragBlock = relevant
              .map((c: { chunk_text: string; source_name: string }) =>
                `— ${c.source_name}\n${c.chunk_text}`
              )
              .join("\n\n");

            systemWithRAG = systemWithRAG
              + "\n\n[Extraits de documents pertinents]\n" + ragBlock;

            // Construire sources_used pour le front
            sourcesUsed = relevant.map((c: { source_name: string; source_type: string; chunk_text: string }) => ({
              source_name: c.source_name,
              source_type: c.source_type,
              preview: c.chunk_text.slice(0, 120),
            }));
          } else {
            // Fallback CC-206 : aucun chunk pertinent — instruction explicite anti-invention
            systemWithRAG = systemWithRAG
              + "\n\n[Disponibilité des documents]\nAucun extrait pertinent trouvé dans les documents indexés pour cette question. Si tu ne trouves pas l information dans la fiche client ou le contexte disponible, dis-le explicitement à l utilisateur plutôt que d estimer ou d inventer.";
          }
        }
      } catch (ragErr) {
        // RAG non bloquant — si Voyage AI est down, Claude répond quand même sans RAG
        console.error("RAG pipeline error (non bloquant):", (ragErr as Error).message);
      }
    }

    // ── Appel Claude normal (avec ou sans fichier joint) ──────────────────
    const { file } = body; // { data: base64, mediaType: string, name: string } | undefined

    // Construire le contenu du message utilisateur
    let userContent: unknown;
    let systemWithFile = systemWithRAG; // Utiliser le system enrichi par le RAG

    if (file && file.data && file.mediaType && file.name) {
      // Valider le type MIME accepté
      const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!allowedTypes.includes(file.mediaType)) {
        return new Response(JSON.stringify({ error: `Type de fichier non supporté : ${file.mediaType}` }), { status: 400, headers });
      }

      // Addendum système pour l'analyse du fichier
      // Partir de systemWithRAG (pas de `system` brut) pour conserver les chunks RAG injectés
      systemWithFile = systemWithRAG
        + "\n\nL'utilisateur t'a partagé un fichier. Extrais les informations clés : type de document, points importants, données chiffrées, actions suggérées.";

      // Construire le bloc fichier selon le type
      const fileBlock = file.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: file.mediaType, data: file.data } }
        : { type: "image", source: { type: "base64", media_type: file.mediaType, data: file.data } };

      // Contenu multimodal : fichier + texte utilisateur
      userContent = [
        fileBlock,
        { type: "text", text: message || "Analyse ce fichier." },
      ];
    } else {
      // Comportement identique à avant
      userContent = message;
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: systemWithFile,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await r.json();
    if (data.error) return new Response(JSON.stringify({ error: data.error.message }), { status: 400, headers });

    const text = data.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("") || "";
    return new Response(JSON.stringify({ text, sources_used: sourcesUsed }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers });
  }
});