/**
 * Génération des identifiants stables et lisibles (§1).
 *
 * Format : L-2026-00184, OPP-2026-00073, LLD-2026-00018, ORG-2026-00042.
 * L'identifiant doit apparaître dans les exports, devis, échanges internes et
 * pièces attachées : il est donc généré une fois et jamais recalculé.
 */

import type { Prisma } from "@prisma/client";

export type PrefixeReference = "L" | "OPP" | "LLD" | "ORG";

/**
 * Incrémente le compteur de l'année courante et renvoie la référence formatée.
 *
 * À appeler dans la même transaction que la création de l'enregistrement, afin
 * qu'un échec de création ne consomme pas de numéro. Le compteur repart à 1 au
 * changement d'année.
 */
export async function genererReference(
  tx: Prisma.TransactionClient,
  prefixe: PrefixeReference,
  annee: number = new Date().getFullYear(),
): Promise<string> {
  const existant = await tx.compteurReference.findUnique({ where: { prefixe } });

  let numero: number;

  if (!existant) {
    numero = 1;
    await tx.compteurReference.create({ data: { prefixe, annee, valeur: 1 } });
  } else if (existant.annee !== annee) {
    numero = 1;
    await tx.compteurReference.update({
      where: { prefixe },
      data: { annee, valeur: 1 },
    });
  } else {
    const maj = await tx.compteurReference.update({
      where: { prefixe },
      data: { valeur: { increment: 1 } },
    });
    numero = maj.valeur;
  }

  return formaterReference(prefixe, annee, numero);
}

export function formaterReference(
  prefixe: PrefixeReference,
  annee: number,
  numero: number,
): string {
  return `${prefixe}-${annee}-${String(numero).padStart(5, "0")}`;
}
