/**
 * Règles métier et garde-fous.
 *
 * Réf. : §2.3 (priorité), §4 (seuil de conversion), §7 (compatibilité partenaire),
 * §8 (champs obligatoires), §9 (suite d'activité), §10 (garde-fous d'automatisation).
 *
 * Ces règles sont volontairement explicites et lisibles : elles doivent pouvoir être
 * relues et ajustées par la direction après quatre semaines de données réelles.
 */

import type {
  EtapeCommerciale,
  ModeAcquisition,
  Priorite,
  StatutLead,
  StatutLld,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// §2.3 — Priorité commerciale
// ---------------------------------------------------------------------------

export type CriteresPriorite = {
  /** Demande entrante spontanée. */
  estEntrant: boolean;
  /** Jours avant l'évènement ou l'échéance client, si connue. */
  joursAvantEcheance?: number | null;
  devisDemande?: boolean;
  clientExistant?: boolean;
  /** Valeur indicative en euros, si connue. */
  valeurIndicative?: number | null;
  /** Échange ou engagement du client dans les derniers jours. */
  engagementRecent?: boolean;
  /** Projet explicitement lointain : le lead relève du nurturing. */
  projetLointain?: boolean;
};

/**
 * Calcule une priorité à partir de critères commerciaux visibles.
 *
 * Garde-fou : cette fonction n'accepte aucune donnée de solvabilité et n'en produit
 * aucune. La priorité organise la journée du commercial, elle ne juge pas le client.
 */
export function calculerPriorite(c: CriteresPriorite): {
  priorite: Priorite;
  motifs: string[];
} {
  const motifs: string[] = [];

  if (c.projetLointain) {
    return {
      priorite: "P4_NURTURING",
      motifs: ["Projet annoncé comme lointain"],
    };
  }

  let score = 0;

  if (c.estEntrant) {
    score += 3;
    motifs.push("Demande entrante");
  }
  if (c.joursAvantEcheance != null && c.joursAvantEcheance <= 30) {
    score += 3;
    motifs.push(`Échéance dans ${c.joursAvantEcheance} j`);
  } else if (c.joursAvantEcheance != null && c.joursAvantEcheance <= 90) {
    score += 1;
    motifs.push("Échéance à moins de 3 mois");
  }
  if (c.devisDemande) {
    score += 2;
    motifs.push("Devis déjà demandé");
  }
  if (c.clientExistant) {
    score += 2;
    motifs.push("Client existant");
  }
  if (c.engagementRecent) {
    score += 1;
    motifs.push("Engagement récent");
  }
  if (c.valeurIndicative != null && c.valeurIndicative >= 10000) {
    score += 1;
    motifs.push("Valeur indicative élevée");
  }

  const priorite: Priorite =
    score >= 6
      ? "P1_REPONSE_IMMEDIATE"
      : score >= 4
        ? "P2_A_TRAITER_AUJOURDHUI"
        : score >= 1
          ? "P3_SUIVI_PLANIFIE"
          : "P4_NURTURING";

  if (motifs.length === 0) motifs.push("Aucun critère de priorisation renseigné");

  return { priorite, motifs };
}

// ---------------------------------------------------------------------------
// §4 — Délai de première prise en charge
// ---------------------------------------------------------------------------

/**
 * Délai interne de première prise en charge, en heures ouvrées.
 * Valeur initiale à ajuster par la direction après observation du volume réel.
 * Le délai est plus exigeant pour les entrants que pour la prospection.
 */
export const DELAI_PRISE_EN_CHARGE_HEURES: Record<ModeAcquisition, number> = {
  ENTRANT: 8, // prise en charge le jour même
  PROSPECTION: 72,
  REACTIVATION: 48,
};

export function priseEnChargeEnRetard(
  mode: ModeAcquisition,
  creeLe: Date,
  premierContactLe: Date | null,
  maintenant: Date = new Date(),
): boolean {
  if (premierContactLe) return false;
  const heures = (maintenant.getTime() - creeLe.getTime()) / 3_600_000;
  return heures > DELAI_PRISE_EN_CHARGE_HEURES[mode];
}

// ---------------------------------------------------------------------------
// §4 — Seuil de qualification : ce qu'il faut connaître pour convertir
// ---------------------------------------------------------------------------

export type ElementsQualification = {
  organisation: boolean;
  interlocuteurPrincipal: boolean;
  besoinOuCasDUsage: boolean;
  solutionEnvisagee: boolean;
  horizonDecisionOuEvenement: boolean;
  prochaineEtape: boolean;
};

/**
 * Un lead devient une opportunité lorsque ces éléments sont connus.
 * Le budget peut rester une fourchette : exiger un montant exact bloquerait
 * inutilement la qualification.
 */
export function peutConvertir(e: ElementsQualification): {
  ok: boolean;
  manquants: string[];
} {
  const manquants: string[] = [];
  if (!e.organisation) manquants.push("le client ou l'organisation");
  if (!e.interlocuteurPrincipal) manquants.push("l'interlocuteur principal");
  if (!e.besoinOuCasDUsage) manquants.push("le besoin ou le cas d'usage");
  if (!e.solutionEnvisagee) manquants.push("la solution envisagée");
  if (!e.horizonDecisionOuEvenement)
    manquants.push("un horizon de décision ou d'évènement");
  if (!e.prochaineEtape) manquants.push("une prochaine étape convenable");
  return { ok: manquants.length === 0, manquants };
}

// ---------------------------------------------------------------------------
// §7 — Compatibilité partenaire : alerte, jamais un refus automatique
// ---------------------------------------------------------------------------

/** Selfizee propose des durées de 1 à 36 mois. */
export const DUREE_LLD_MIN_SELFIZEE = 1;
export const DUREE_LLD_MAX_SELFIZEE = 36;

/**
 * Plage indiquée par les informations publiques de GRENKE pour la location
 * financière générale (12 à 60 mois, à partir de 500 € d'investissement net).
 * Ce n'est ni une décision sur un dossier, ni une règle universelle : à confirmer
 * directement avec le partenaire avant toute automatisation.
 */
export const DUREE_GRENKE_PUBLIEE_MIN = 12;
export const DUREE_GRENKE_PUBLIEE_MAX = 60;
export const MONTANT_GRENKE_PUBLIE_MIN = 500;

export type AlerteCompatibilite = {
  /** Vrai quand une confirmation partenaire est nécessaire. */
  aConfirmer: boolean;
  message: string | null;
};

/**
 * Produit une alerte interne « compatibilité partenaire à confirmer ».
 *
 * Garde-fou : cette fonction n'écarte jamais un dossier et ne préjuge d'aucune
 * décision de financement. Elle signale seulement qu'une information doit être
 * vérifiée auprès du partenaire.
 */
export function verifierCompatibilitePartenaire(
  dureeMois: number,
  montantFinance?: number | null,
): AlerteCompatibilite {
  const points: string[] = [];

  if (dureeMois < DUREE_GRENKE_PUBLIEE_MIN) {
    points.push(
      `durée de ${dureeMois} mois inférieure à la plage publiée (${DUREE_GRENKE_PUBLIEE_MIN}–${DUREE_GRENKE_PUBLIEE_MAX} mois)`,
    );
  }
  if (dureeMois > DUREE_GRENKE_PUBLIEE_MAX) {
    points.push(
      `durée de ${dureeMois} mois supérieure à la plage publiée (${DUREE_GRENKE_PUBLIEE_MIN}–${DUREE_GRENKE_PUBLIEE_MAX} mois)`,
    );
  }
  if (montantFinance != null && montantFinance < MONTANT_GRENKE_PUBLIE_MIN) {
    points.push(
      `montant de ${montantFinance} € inférieur au seuil publié (${MONTANT_GRENKE_PUBLIE_MIN} €)`,
    );
  }

  if (points.length === 0) return { aConfirmer: false, message: null };

  return {
    aConfirmer: true,
    message: `Compatibilité partenaire à confirmer : ${points.join(" ; ")}. À vérifier directement avec GRENKE — ne préjuge d'aucune décision.`,
  };
}

// ---------------------------------------------------------------------------
// §8 — Champs obligatoires, au moment où l'information devient nécessaire
// ---------------------------------------------------------------------------

export type MomentCle =
  | "CREATION_LEAD"
  | "CONTACT_ETABLI"
  | "CONVERSION_OPPORTUNITE"
  | "OFFRE_ENVOYEE"
  | "CREATION_LLD"
  | "TRANSMISSION_LLD"
  | "CLOTURE";

export const CHAMPS_OBLIGATOIRES: Record<
  MomentCle,
  { champs: string[]; pourquoi: string }
> = {
  CREATION_LEAD: {
    champs: [
      "modeAcquisition",
      "canalDetaille",
      "identite", // nom ou organisation
      "moyenDeContact", // au moins un
      "responsableOuPool",
      "prochaineAction",
    ],
    pourquoi: "Garantir que chaque lead est identifiable et traitable.",
  },
  CONTACT_ETABLI: {
    champs: [
      "segment",
      "projetRecherche",
      "besoinResume",
      "horizonIndicatif",
      "contactPrincipal",
    ],
    pourquoi: "Préparer une qualification comparable entre commerciaux.",
  },
  CONVERSION_OPPORTUNITE: {
    champs: [
      "solutionEnvisagee",
      "quantiteOuPerimetre",
      "dateCible",
      "etapeSuivante",
      "commercial",
    ],
    pourquoi: "Éviter les opportunités sans projet concret.",
  },
  OFFRE_ENVOYEE: {
    champs: [
      "typeOffre",
      "montantOuFourchette",
      "dateOffreEnvoyee",
      "dateRelancePrevue",
      "devisOuLien",
    ],
    pourquoi:
      "Mesurer l'efficacité des propositions et sécuriser les relances.",
  },
  CREATION_LLD: {
    champs: [
      "dureeDemandeeMois",
      "montantOuOffreLiee",
      "locataire",
      "commercial",
      "collaboratrice",
      "statutInitial",
    ],
    pourquoi: "Éviter un dossier LLD sans opportunité ni responsable.",
  },
  TRANSMISSION_LLD: {
    champs: [
      "dateTransmission",
      "canalTransmission",
      "auteurTransmission",
      "preuveTransmission",
      "prochaineRelanceLe",
    ],
    pourquoi: "Rendre le suivi externe auditable.",
  },
  CLOTURE: {
    champs: ["motifCloture", "dateCloture", "montantRetenu"],
    pourquoi: "Produire des données de pilotage fiables.",
  },
};

// ---------------------------------------------------------------------------
// §3 et §9 — Cartes sans suivi planifié
// ---------------------------------------------------------------------------

/** Étapes terminales : la carte n'attend plus de prochaine action. */
const ETAPES_TERMINALES_LEAD: StatutLead[] = ["NON_QUALIFIE_CLOTURE"];
const ETAPES_TERMINALES_OPPORTUNITE: EtapeCommerciale[] = [
  "GAGNE_ACTIF",
  "PERDU_ABANDONNE",
];
const ETAPES_TERMINALES_LLD: StatutLld[] = [
  "LIVRAISON_CONFIRMEE_CONTRAT_ACTIF",
  "CLOTURE_NON_POURSUIVI",
];

export const estTerminaleLead = (s: StatutLead) =>
  ETAPES_TERMINALES_LEAD.includes(s);
export const estTerminaleOpportunite = (e: EtapeCommerciale) =>
  ETAPES_TERMINALES_OPPORTUNITE.includes(e);
export const estTerminaleLld = (s: StatutLld) =>
  ETAPES_TERMINALES_LLD.includes(s);

/**
 * Une carte est « sans suivi planifié » quand elle n'a ni prochaine action datée
 * ni attente explicitement datée, hors étapes terminales. Ces cartes sont signalées,
 * jamais laissées sans alerte.
 */
export function sansSuiviPlanifie(carte: {
  prochaineActionLe: Date | null;
  dateReactivation?: Date | null;
  prochaineRelanceLe?: Date | null;
  terminale: boolean;
}): boolean {
  if (carte.terminale) return false;
  return (
    !carte.prochaineActionLe &&
    !carte.dateReactivation &&
    !carte.prochaineRelanceLe
  );
}

/** Nombre de jours pleins écoulés depuis une date. */
export function joursDepuis(date: Date, maintenant: Date = new Date()): number {
  return Math.floor((maintenant.getTime() - date.getTime()) / 86_400_000);
}

/** Une action datée dans le passé est en retard. */
export function estEnRetard(
  date: Date | null,
  maintenant: Date = new Date(),
): boolean {
  return date != null && date.getTime() < maintenant.getTime();
}

// ---------------------------------------------------------------------------
// §10 — Détection de doublons
// ---------------------------------------------------------------------------

/** Normalise un téléphone français en E.164 pour la comparaison. */
export function normaliserTelephone(brut: string | null): string | null {
  if (!brut) return null;
  const chiffres = brut.replace(/[^\d+]/g, "");
  if (chiffres.startsWith("+")) return chiffres;
  if (chiffres.startsWith("00")) return `+${chiffres.slice(2)}`;
  if (chiffres.length === 10 && chiffres.startsWith("0"))
    return `+33${chiffres.slice(1)}`;
  return chiffres || null;
}

export function normaliserEmail(brut: string | null): string | null {
  return brut ? brut.trim().toLowerCase() || null : null;
}

/** Comparaison de noms d'organisation, insensible à la casse et aux accents. */
export function normaliserNom(brut: string | null): string | null {
  if (!brut) return null;
  return (
    brut
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim() || null
  );
}
