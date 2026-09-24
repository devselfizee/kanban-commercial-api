/**
 * Journal métier (§10, §12).
 *
 * Trace durable des décisions et des événements, au-delà des historiques techniques
 * d'automatisation. Les changements de statut LLD, les transmissions, les
 * réattributions et les accès aux documents y sont consignés.
 */

import type { Prisma, TypeObjet } from "@prisma/client";

export type ActionJournal =
  | "CREATION"
  | "PRISE_EN_CHARGE"
  | "REATTRIBUTION"
  | "CHANGEMENT_ETAPE"
  | "CONVERSION_LEAD"
  | "CREATION_LLD"
  | "TRANSMISSION_LLD"
  | "RETOUR_PARTENAIRE"
  | "SIGNATURE"
  | "LIVRAISON"
  | "CLOTURE"
  | "FUSION_DOUBLON"
  | "ACCES_DOCUMENT"
  | "MODIFICATION";

export async function journaliser(
  tx: Prisma.TransactionClient,
  entree: {
    typeObjet: TypeObjet;
    objetId: string;
    action: ActionJournal;
    detail?: string;
    ancienneValeur?: string | null;
    nouvelleValeur?: string | null;
    motif?: string | null;
    auteurId?: string | null;
  },
) {
  return tx.journalEntree.create({
    data: {
      typeObjet: entree.typeObjet,
      objetId: entree.objetId,
      action: entree.action,
      detail: entree.detail ?? null,
      ancienneValeur: entree.ancienneValeur ?? null,
      nouvelleValeur: entree.nouvelleValeur ?? null,
      motif: entree.motif ?? null,
      auteurId: entree.auteurId ?? null,
    },
  });
}

export const LIBELLE_ACTION: Record<ActionJournal, string> = {
  CREATION: "Création",
  PRISE_EN_CHARGE: "Prise en charge",
  REATTRIBUTION: "Réattribution",
  CHANGEMENT_ETAPE: "Changement d'étape",
  CONVERSION_LEAD: "Conversion en opportunité",
  CREATION_LLD: "Création du dossier LLD",
  TRANSMISSION_LLD: "Transmission du dossier",
  RETOUR_PARTENAIRE: "Retour communiqué par le partenaire",
  SIGNATURE: "Signature",
  LIVRAISON: "Livraison",
  CLOTURE: "Clôture",
  FUSION_DOUBLON: "Fusion de doublon",
  ACCES_DOCUMENT: "Accès à un document",
  MODIFICATION: "Modification",
};
