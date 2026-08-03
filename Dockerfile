# ══════════════════════════════════════════════════════════
#  JOJ Dakar 2026 — Guide AR  ·  image statique nginx
# ══════════════════════════════════════════════════════════
FROM nginx:1.27-alpine

# envsubst (déjà présent dans l'image alpine officielle, on le garantit)
RUN apk add --no-cache gettext

# ── fichiers statiques ──
COPY index.html /usr/share/nginx/html/
COPY config.js  /usr/share/nginx/html/
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/

# ── configuration nginx ──
COPY docker/headers.conf        /etc/nginx/snippets/joj-headers.conf
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

# 05-…envsh est SOURCÉ par le docker-entrypoint (extension .envsh) :
# il normalise BACKEND_URL avant que 20-envsubst remplisse le template.
# 40-…sh est exécuté ensuite et réécrit config.js.
COPY docker/05-joj-env.envsh /docker-entrypoint.d/05-joj-env.envsh
COPY docker/entrypoint.sh    /docker-entrypoint.d/40-joj-config.sh
RUN chmod +x /docker-entrypoint.d/05-joj-env.envsh \
             /docker-entrypoint.d/40-joj-config.sh

# IMPORTANT : ne substituer QUE ces variables dans le template nginx.
# Sans ce filtre, $host, $remote_addr, $http_upgrade… seraient vidés.
# Le filtre est une expression régulière testée sur les NOMS des variables.
# Volontairement sans ancre finale : aucun « $ » à échapper ici.
ENV NGINX_ENVSUBST_FILTER="^(BACKEND_URL|JOJ_BACKEND_HOST|JOJ_RESOLVERS)"

# Adresse du backend Spring Boot, sans slash final.
# À surcharger dans Dokploy (ex. http://joj-backend:8089).
ENV BACKEND_URL=https://seddo.innovimpactdev.cloud
ENV API_BASE=/api

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
