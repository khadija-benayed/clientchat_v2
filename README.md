# Client Chat (Smart Bees)

Interface de gestion de projets clients avec chat IA (Claude), to-do intégrée, mémoire des sessions, et base de savoir agence (Agency KB).

---

## 🏗 Stack Technique & Architecture

| Couche | Techno | Hébergement |
| --- | --- | --- |
| **Frontend** | HTML/CSS/JS vanilla (SPA) | GitHub Pages |
| **Backend** | Supabase Edge Function (Deno) | Supabase |
| **Base de données** | Supabase Postgres + Realtime | Supabase |
| **IA Conversationnelle** | Claude 3.5 Sonnet (`claude-sonnet-4-6`) | API Anthropic |
| **IA Tâches (NLP)** | Claude 3.5 Haiku (`claude-haiku-4-5-20251001`) | API Anthropic |
| **Embeddings (Vectoriel)** | Voyage-3 (1024 dims) | API Voyage AI |

---

## ✨ Fonctionnalités Opérationnelles (NOW)

* **Chat + Tasks :** Routage intelligent. Sonnet gère les conversations complexes, Haiku est déclenché pour les actions rapides sur la to-do (création, modification, assignation).
* **Mémoire des sessions :** Résumés automatiques sauvegardés en base et réinjectés dans le contexte.
* **Connexion Drive :** Liste les métadonnées et exporte le contenu des fichiers Google Drive.
* **Brief Client Généré :** Fiche structurée (JSON) générée automatiquement à partir des sources Drive.
* **Usage Logs :** Suivi des coûts et de la consommation des tokens par modèle (`usage_logs`).
* **L2 Doc Cache (Fallback) :** Injection directe en contexte des 10 documents Drive les plus récents (permet de contourner temporairement les limitations du RAG).
* **Agency KB (Stub) :** Sauvegarde d'insights croisés entre clients dans une table dédiée (`agency_knowledge`).

---

## ⚠️ Contraintes Actuelles & Workaround (Le "Problème Voyage AI")

**Le constat :** L'indexation RAG complète est actuellement bloquée par la limite du *Free Tier* de Voyage AI (**3 requêtes par minute**, 10K tokens/min). Il est impossible d'indexer un Drive complet (ex: 98 fichiers) sans déclencher des erreurs 429 et 502, même avec une file d'attente.

**La solution temporaire (L2 Cache) :**
Pour garantir une démonstration fluide, le système s'appuie actuellement sur un **Cache L2** :

1. Le brief client auto-généré donne le contexte global.
2. Au chargement du client, les 10 fichiers Drive les plus récents sont exportés et injectés *en texte brut* directement dans le System Prompt.
3. **Résultat :** L'IA dispose des documents les plus chauds en mémoire immédiate, couvrant 80% des cas d'usage sans avoir besoin du RAG.

---

## 🚀 Roadmap

### NEXT — Optimisations (Free)

* **Fix Sync Reliability :** Maintien du délai de 22s et `MAX_PER_RUN=2` pour le check Drive en arrière-plan.
* **Sync Progress UX :** Amélioration du compteur dans l'UI ("X/98 indexés") qui persiste entre les sessions.
* **Notion Source (Stub) :** Préparation du pipeline d'exportation pour l'API Notion.

### LATER — Déblocage API Payantes

* **Migration OpenAI Embeddings :** Passage sur `text-embedding-3-small` ($0.02 / 1M tokens) pour lever la limite de rate-limit.
* **Full RAG :** Indexation instantanée (< 2 min) de l'intégralité des fichiers clients et recherche sémantique fonctionnelle.
* **Agency KB Populated :** Injection automatisée et anonymisée des insights de l'agence dans tous les *system prompts*.
* **Source Citations :** Affichage UI des documents précis ayant servi à formuler une réponse.
* **Cross-client Search :** Capacité d'interroger la base globale ("Comment a-t-on géré cette situation pour un autre client ?").

---

## 📦 Déploiement

### 1. Frontend (GitHub Pages)

Le déploiement Netlify a été remplacé par **GitHub Pages** pour corriger les erreurs 403.
Le workflow `.github/workflows/deploy.yml` publie automatiquement le dossier `/public` à chaque push sur la branche `main`.

### 2. Backend (Edge Function)

```bash
supabase functions deploy chat --project-ref [PROJECT_ID]

```

### 3. Secrets requis (Supabase)

* `ANTHROPIC_KEY`
* `VOYAGE_API_KEY`
* `GOOGLE_SA_KEY` (JSON complet)
* `SUPABASE_URL`
* `SUPABASE_SERVICE_ROLE_KEY`

---

## 🗄️ Schéma de Base de Données (Mises à jour)

Ajouts récents au schéma Postgres :

```sql
-- Suivi des coûts API (CC-211)
CREATE TABLE usage_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES clients(id) ON DELETE SET NULL,
  model            text NOT NULL,
  message_type     text NOT NULL,
  tokens_input     int,
  tokens_output    int,
  cost_usd         numeric(10,6),
  created_at       timestamptz DEFAULT now()
);

-- Base de savoir partagée de l'agence (CC-213)
CREATE TABLE agency_knowledge (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  content          text NOT NULL,
  source_client    text,
  tags             text[],
  saved_by         text,
  created_at       timestamptz DEFAULT now()
);
```