#!/bin/sh
set -e

# Injecte l'adresse de l'API dans config.js au démarrage du conteneur.
# Permet de changer de backend sans reconstruire l'image.

cat > /usr/share/nginx/html/config.js <<CFG
window.__CONFIG__ = {
  API_BASE: "${API_BASE:-/api}"
};
CFG

echo "[joj] API_BASE    = ${API_BASE:-/api}"
echo "[joj] BACKEND_URL = ${BACKEND_URL}"
