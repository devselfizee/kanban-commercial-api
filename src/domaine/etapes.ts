/**
 * Ordre des étapes, côté serveur.
 *
 * Le back n'a pas à connaître les libellés affichés : il renvoie des codes, et
 * le front les traduit. Ce fichier ne contient donc que ce dont le serveur a
 * réellement besoin — l'ordre des colonnes, pour présenter les tableaux de bord
 * dans le sens où une carte progresse.
 *
 * Réf. : §4, §6, §7 du document. La liste des libellés vit côté front, dans
 * `src/lib/pipelines.ts`.
 */

import type { EtapeCommerciale, StatutLld } from "@prisma/client";

/** Pipeline n°2, dans l'ordre de progression. */
export const ETAPES_OPPORTUNITE: EtapeCommerciale[] = [
  "QUALIFICATION_VALIDEE",
  "DECOUVERTE_SOLUTION",
  "OFFRE_A_CONSTRUIRE",
  "OFFRE_ENVOYEE",
  "NEGOCIATION_VALIDATION_CLIENT",
  "DOSSIER_LLD_EN_COURS",
  "CONTRATS_A_SIGNER",
  "LIVRAISON_MISE_EN_SERVICE",
  "GAGNE_ACTIF",
  "PERDU_ABANDONNE",
];

/** Pipeline n°3, dans l'ordre de progression. */
export const STATUTS_LLD: StatutLld[] = [
  "LLD_A_ETUDIER",
  "DOSSIER_A_PREPARER",
  "EN_ATTENTE_ELEMENTS_CLIENT",
  "PRET_A_TRANSMETTRE",
  "TRANSMIS_A_GRENKE",
  "RETOUR_ANALYSE_EN_ATTENTE",
  "REPONSE_COMMUNIQUEE_PAR_GRENKE",
  "CONTRAT_A_SIGNER",
  "SIGNE_LIVRAISON_A_CONFIRMER",
  "LIVRAISON_CONFIRMEE_CONTRAT_ACTIF",
  "CLOTURE_NON_POURSUIVI",
];
