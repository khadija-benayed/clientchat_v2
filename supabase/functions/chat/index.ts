import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  try {
    const { system, message, action, client_id, history } = await req.json();
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ANTHROPIC_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_KEY non configurée" }),
        { status: 500, headers }
      );
    }

    // ── Action : résumé de session ──────────────────────────────────────────
    if (action === "summarize_session") {
      if (!client_id || !history || !Array.isArray(history) || history.length === 0) {
        return new Response(
          JSON.stringify({ error: "client_id et history requis" }),
          { status: 400, headers }
        );
      }

      // Formater l'historique en texte lisible pour Claude
      const historyText = history
        .map((m: { role: string; text: string }) =>
          `${m.role === "u" ? "Utilisateur" : "Assistant"} : ${m.text}`
        )
        .join("\n");

      // Appel Claude pour générer le résumé
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          system:
            "Tu es un assistant qui résume des sessions de travail de manière factuelle et concise. " +
            "Tu reçois un historique de conversation et tu produis un résumé structuré.",
          messages: [
            {
              role: "user",
              content:
                "Résume cette session en 5 points max : décisions prises, infos importantes, actions à faire. " +
                "Format : liste à tirets, sois factuel et concis. Ne mets pas de titre.\n\n" +
                "Session :\n" + historyText,
            },
          ],
        }),
      });

      const claudeData = await claudeRes.json();
      if (claudeData.error) {
        return new Response(
          JSON.stringify({ error: claudeData.error.message }),
          { status: 400, headers }
        );
      }

      const summaryText =
        claudeData.content
          ?.filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text)
          .join("") || "";

      // Persister dans Supabase via service_role (bypass RLS)
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { error: insertError } = await sbAdmin
          .from("session_summaries")
          .insert({ client_id, summary_text: summaryText });

        if (insertError) {
          console.error("Insert session_summary error:", insertError.message);
          // On retourne quand même le résumé même si la persistence échoue
          return new Response(
            JSON.stringify({
              saved: false,
              summary: summaryText,
              error: insertError.message,
            }),
            { status: 200, headers }
          );
        }
      } else {
        // Variables Supabase non configurées — résumé généré mais non persisté
        return new Response(
          JSON.stringify({
            saved: false,
            summary: summaryText,
            error: "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante",
          }),
          { status: 200, headers }
        );
      }

      return new Response(
        JSON.stringify({ saved: true, summary: summaryText }),
        { status: 200, headers }
      );
    }

    // ── Action : lecture Google Drive ──────────────────────────────────────
    if (action === "read_drive") {
      const url = message;

      // Stratégie 1 : Google Sheet export CSV direct
      const sheetMatch = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (sheetMatch) {
        const id = sheetMatch[1];
        const urls = [
          `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&id=${id}`,
          `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`,
          `https://docs.google.com/spreadsheets/d/${id}/pub?output=csv`,
        ];
        for (const u of urls) {
          try {
            const r = await fetch(u, {
              redirect: "follow",
              headers: { "User-Agent": "Mozilla/5.0" },
            });
            if (r.ok) {
              const text = await r.text();
              if (
                text.length > 50 &&
                !text.includes("<!DOCTYPE") &&
                !text.includes("<html")
              ) {
                return new Response(
                  JSON.stringify({ text: text.substring(0, 5000), type: "csv" }),
                  { status: 200, headers }
                );
              }
            }
          } catch (_e) {
            // essai suivant
          }
        }
        return new Response(
          JSON.stringify({
            text: "",
            error:
              "Impossible de lire ce Sheet. Va dans Fichier → Partager → Publier sur le web → CSV, et colle ce lien.",
          }),
          { status: 200, headers }
        );
      }

      // Stratégie 2 : Google Doc export texte
      const docMatch = url.match(/document\/d\/([a-zA-Z0-9_-]+)/);
      if (docMatch) {
        const id = docMatch[1];
        try {
          const r = await fetch(
            `https://docs.google.com/document/d/${id}/export?format=txt`,
            { redirect: "follow" }
          );
          if (r.ok) {
            const text = await r.text();
            if (!text.includes("<!DOCTYPE")) {
              return new Response(
                JSON.stringify({ text: text.substring(0, 5000), type: "txt" }),
                { status: 200, headers }
              );
            }
          }
        } catch (_e) {
          // fall through
        }
        return new Response(
          JSON.stringify({
            text: "",
            error:
              'Impossible de lire ce Doc. Vérifie que le partage est "Tout le monde avec le lien".',
          }),
          { status: 200, headers }
        );
      }

      return new Response(
        JSON.stringify({
          text: "",
          error: "Lien non reconnu. Supporte les Google Sheets et Google Docs.",
        }),
        { status: 200, headers }
      );
    }

    // ── Appel Claude normal ────────────────────────────────────────────────
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        system,
        messages: [{ role: "user", content: message }],
      }),
    });

    const data = await r.json();

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), {
        status: 400,
        headers,
      });
    }

    const text =
      data.content
        ?.filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("") || "";

    return new Response(JSON.stringify({ text }), { status: 200, headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers }
    );
  }
});