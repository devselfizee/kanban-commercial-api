# API du kanban commercial.
#
# Build en deux étapes : les sources TypeScript et les dépendances de
# développement ne sont pas embarquées dans l'image finale.

# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Prisma a besoin d'OpenSSL pour ses moteurs.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Le client Prisma est généré au build : il dépend du schéma, pas de la base.
RUN npx prisma generate
RUN npm run build

# Le seed est transpilé pour pouvoir être exécuté en production sans `tsx`,
# qui reste une dépendance de développement.
RUN npx esbuild prisma/seed.ts --bundle --platform=node --format=esm \
      --packages=external --outfile=dist/seed.mjs

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=4000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 api

# Dépendances de production, installées proprement.
#
# Copier sélectivement node_modules depuis l'étape de build laisserait derrière
# elle des dépendances transitives — `effect`, `c12` et les autres, dont Prisma
# a besoin — et le conteneur échouerait au démarrage sur un module introuvable.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=api:nodejs /app/dist ./dist
COPY --from=builder --chown=api:nodejs /app/prisma ./prisma
COPY --from=builder --chown=api:nodejs /app/node_modules/.prisma ./node_modules/.prisma

COPY --chown=api:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && chown -R api:nodejs /app/node_modules/.prisma

USER api
EXPOSE 4000

# Les migrations sont appliquées avant le démarrage du serveur.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/serveur.js"]
