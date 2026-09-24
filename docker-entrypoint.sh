#!/bin/sh
# Applique les migrations avant de démarrer l'API.
#
# `migrate deploy` n'applique que des migrations déjà écrites et validées : il ne
# génère jamais de schéma à la volée et ne détruit aucune donnée existante.
set -e

echo "→ Application des migrations Prisma..."
npx prisma migrate deploy

echo "→ Démarrage de l'API."
exec "$@"
