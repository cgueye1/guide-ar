# ══════════════════════════════════════════════════════════
#  JOJ Dakar 2026 — Guide AR  ·  image statique nginx
# ══════════════════════════════════════════════════════════
FROM nginx:1.27-alpine

RUN apk add --no-cache gettext

# ── fichiers statiques ──
COPY index.html /usr/share/nginx/html/
COPY config.js  /usr/share/nginx/html/
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/

# ── configuration nginx ──
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/entrypoint.sh       /docker-entrypoint.d/40-joj-config.sh
RUN chmod +x /docker-entrypoint.d/40-joj-config.sh

# IMPORTANT : ne substituer QUE cette variable dans le template nginx.
# Sans ce filtre, $host, $remote_addr, $http_upgrade… seraient vidés.
ENV NGINX_ENVSUBST_FILTER="BACKEND_URL"

ENV BACKEND_URL=http://backend:8089
ENV API_BASE=/api

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
