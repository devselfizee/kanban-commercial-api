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
RUN npx esbuild prisma/seed.ts --bundle --platform=node --format=cjs \
      --packages=external --outfile=dist/seed.cjs

# La reprise initiale des clients du CRM, exécutable une fois en production.
RUN npx esbuild src/crm/reprise-cli.ts --bundle --platform=node --format=cjs \
      --packages=external --outfile=dist/reprise.cjs

# La synchronisation de l'équipe, pour la relancer à la main depuis le terminal.
RUN npx esbuild src/crm/equipe-cli.ts --bundle --platform=node --format=cjs \
      --packages=external --outfile=dist/equipe.cjs

# L'import des demandes CRM, pour le relancer à la main depuis le terminal.
RUN npx esbuild src/crm/demandes-cli.ts --bundle --platform=node --format=cjs \
      --packages=external --outfile=dist/demandes.cjs

# L'import des devis GRENKE en dossiers LLD, pour le relancer à la main.
RUN npx esbuild src/crm/financements-cli.ts --bundle --platform=node --format=cjs \
      --packages=external --outfile=dist/financements.cjs

# Retrait du jeu de démonstration, simulation par défaut.
RUN npx esbuild src/outils/nettoyer-demo.ts --bundle --platform=node --format=cjs \
      --packages=external --outfile=dist/nettoyer-demo.cjs

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
