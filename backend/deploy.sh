#!/bin/bash
# Usage : bash backend/deploy.sh
# Prérequis : gcloud CLI authentifié, Docker actif, variables d'env exportées dans le shell.
#
# Export des variables avant de lancer :
#   export SUPABASE_URL=https://xxx.supabase.co
#   export SUPABASE_SERVICE_KEY=eyJ...
#   export ANTHROPIC_KEY=sk-ant-...
#   export GOOGLE_SA_KEY='{"type":"service_account",...}'

set -euo pipefail

PROJECT_ID="clientchat-backend"   # à adapter : gcloud projects list
SERVICE_NAME="clientchat-api"
REGION="europe-west1"
IMAGE="gcr.io/$PROJECT_ID/$SERVICE_NAME"

# Vérifier que les variables obligatoires sont définies
: "${SUPABASE_URL:?Variable SUPABASE_URL manquante}"
: "${SUPABASE_SERVICE_KEY:?Variable SUPABASE_SERVICE_KEY manquante}"
: "${ANTHROPIC_KEY:?Variable ANTHROPIC_KEY manquante}"
: "${GOOGLE_SA_KEY:?Variable GOOGLE_SA_KEY manquante}"

echo "▶ Build et push de l'image..."
gcloud builds submit --tag "$IMAGE" ./backend

echo "▶ Déploiement sur Cloud Run ($REGION)..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "SUPABASE_URL=${SUPABASE_URL},SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY},ANTHROPIC_KEY=${ANTHROPIC_KEY},GOOGLE_SA_KEY=${GOOGLE_SA_KEY}"

echo ""
echo "✓ Déployé. Récupère l'URL du service :"
gcloud run services describe "$SERVICE_NAME" \
  --platform managed \
  --region "$REGION" \
  --format "value(status.url)"

echo ""
echo "→ Mets à jour BACKEND_URL dans db.js avec l'URL ci-dessus."
