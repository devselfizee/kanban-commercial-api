/**
 * Import des devis CRM facturés à GRENKE en dossiers LLD.
 *
 * Le tableau LLD ne se remplissait que lorsqu'un dossier était ouvert à la
 * main dans le kanban — il restait vide, alors que le CRM porte une centaine
 * d'affaires financées par an. Chaque devis facturé à GRENKE devient donc un
 * dossier LLD, relié à une opportunité — le document exige qu'un dossier ne
 * vive jamais seul (§1) — et suit l'évolution du statut du devis.
 *
 * Garde-fous :
 *   - un dossier déplacé à la main n'est plus jamais repositionné par l'import :
 *     le kanban devient alors la référence pour ce dossier ;
 *   - le passage à « contrat actif » repose sur un fait — la facture émise à
 *     GRENKE, qui paie après la confirmation de livraison — et le journal le
 *     dit ; rien n'est déduit d'un silence du partenaire ;
 *   - la durée, que le devis ne porte pas, reste « à renseigner » plutôt que
 *     d'être inventée.
 */

import type {
  EtapeCommerciale,
  Prisma,
  StatutLld,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { genererReference } from "../lib/references";
import { journaliser } from "../lib/journal";
import { CHECKLIST_INTERNE } from "../domaine/checklist";
import { idClientGrenke } from "./partenaire";
import { reprendreClient, type LigneClientCrm } from "./recherche";
import { texteDepuisHtml } from "./demandes";

const DELAI_MS = 15_000;

// ---------------------------------------------------------------------------
// Correspondances
// ---------------------------------------------------------------------------

/** Statut d'un devis CRM → colonne du tableau LLD. */
export function statutLldDepuisDevis(status: string | null | undefined): StatutLld {
  switch (status) {
    case "accepted":
    case "acompte":
      return "CONTRAT_A_SIGNER";
    case "billing": // à facturer : signé, la livraison reste à confirmer
      return "SIGNE_LIVRAISON_A_CONFIRMER";
    case "billed":
    case "partially_billed":
    case "paid":
    case "partially_paid":
      // Facturé à GRENKE : le partenaire ne règle qu'après la confirmation de
      // livraison. C'est l'évènement de confirmation que le document exige.
      return "LIVRAISON_CONFIRMEE_CONTRAT_ACTIF";
    case "refused":
    case "canceled":
    case "expired":
      return "CLOTURE_NON_POURSUIVI";
    default:
      // brouillon, envoyé, lu, relancé… : le dossier se prépare.
      return "DOSSIER_A_PREPARER";
  }
}

/** Colonne LLD → étape de l'opportunité commerciale associée (§6). */
export function etapeDepuisStatutLld(statut: StatutLld): EtapeCommerciale {
  switch (statut) {
    case "CONTRAT_A_SIGNER":
      return "CONTRATS_A_SIGNER";
    case "SIGNE_LIVRAISON_A_CONFIRMER":
      return "LIVRAISON_MISE_EN_SERVICE";
    case "LIVRAISON_CONFIRMEE_CONTRAT_ACTIF":
      return "GAGNE_ACTIF";
    case "CLOTURE_NON_POURSUIVI":
      return "PERDU_ABANDONNE";
    default:
      return "DOSSIER_LLD_EN_COURS";
  }
}

const LIBELLE_STATUT_DEVIS: Record<string, string> = {
  draft: "brouillon", sent: "envoyé", lu: "lu", open: "ouvert", clicked: "cliqué",
  relance: "relancé", accepted: "accepté", acompte: "acompte versé",
  billing: "à facturer", billed: "facturé", partially_billed: "partiellement facturé",
  paid: "payé", partially_paid: "règlement partiel", refused: "refusé",
  canceled: "annulé", expired: "expiré",
};

function libelleStatut(s: string | null | undefined): string {
  return (s && LIBELLE_STATUT_DEVIS[s]) || s || "inconnu";
}

// ---------------------------------------------------------------------------
// L'import
// ---------------------------------------------------------------------------

type DevisFinance = {
  id: number;
  indent?: string | null;
  objet?: string | null;
  status?: string | null;
  date_crea?: string | null;
  montant_ht?: number | null;
  opportunite_id?: number | null;
  ref_commercial_id?: number | null;
  client?: (LigneClientCrm & { ville?: string | null }) | null;
};

export type BilanFinancements = {
  etat: "ok" | "non_configure" | "indisponible";
  detail?: string;
  crees: number;
  avances: number;
  inchanges: number;
  gardes: number; // déplacés à la main : laissés tels quels
  erreurs: { idCrm: number; detail: string }[];
};

let enCours = false;

export async function importerFinancements(): Promise<BilanFinancements> {
  const bilan: BilanFinancements = {
    etat: "ok", crees: 0, avances: 0, inchanges: 0, gardes: 0, erreurs: [],
  };

  const urlCrm = process.env.CRM_URL;
  if (!urlCrm) return { ...bilan, etat: "non_configure" };
  if (enCours) {
    return { ...bilan, etat: "indisponible", detail: "Un import est déjà en cours." };
  }
  enCours = true;

  try {
    const jours = Number(process.env.CRM_FINANCEMENTS_JOURS ?? 365);
    const depuis = new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10);
    const url =
      `${urlCrm.replace(/\/$/, "")}/api-v1/devis/financements` +
      `?financeur=${idClientGrenke()}&depuis=${depuis}`;

    let devis: DevisFinance[];
    try {
      const reponse = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(DELAI_MS),
      });
      if (!reponse.ok) {
        return {
          ...bilan,
          etat: "indisponible",
          detail:
            reponse.status === 404
              ? "Le CRM n'expose pas encore /api-v1/devis/financements."
              : `Le CRM a répondu ${reponse.status}.`,
        };
      }
      const corps = (await reponse.json()) as { data?: DevisFinance[] };
      devis = Array.isArray(corps.data) ? corps.data : [];
    } catch (e) {
      return {
        ...bilan,
        etat: "indisponible",
        detail: e instanceof Error ? e.message : "CRM injoignable.",
      };
    }

    for (const d of devis) {
      try {
        const issue = await traiterUn(d);
        bilan[issue]++;
      } catch (e) {
        bilan.erreurs.push({
          idCrm: d.id,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return bilan;
  } finally {
    enCours = false;
  }
}

async function traiterUn(
  d: DevisFinance,
): Promise<"crees" | "avances" | "inchanges" | "gardes"> {
  const existant = await prisma.dossierLld.findUnique({
    where: { idCrmDevis: d.id },
    include: { opportunite: { select: { id: true, etape: true } } },
  });
  return existant ? mettreAJour(d, existant) : creer(d);
}

/**
 * Un dossier déjà importé suit le statut du devis — tant que personne ne l'a
 * déplacé à la main. On le sait en comparant sa colonne à celle que l'import
 * lui avait donnée pour l'ancien statut.
 */
async function mettreAJour(
  d: DevisFinance,
  dossier: {
    id: string;
    statut: StatutLld;
    statutCrm: string | null;
    opportunite: { id: string; etape: EtapeCommerciale };
  },
): Promise<"avances" | "inchanges" | "gardes"> {
  if (dossier.statutCrm === (d.status ?? null)) return "inchanges";

  const ancien = statutLldDepuisDevis(dossier.statutCrm);
  const nouveau = statutLldDepuisDevis(d.status);
  const deplaceALaMain = dossier.statut !== ancien;

  await prisma.$transaction(async (tx) => {
    await tx.dossierLld.update({
      where: { id: dossier.id },
      data: {
        statutCrm: d.status ?? null,
        montantFinance: d.montant_ht ?? undefined,
        ...(deplaceALaMain || nouveau === dossier.statut
          ? {}
          : { statut: nouveau, entreEnEtapeLe: new Date(), ...cloture(nouveau, d.status) }),
      },
    });

    if (!deplaceALaMain && nouveau !== dossier.statut) {
      await journaliser(tx, {
        typeObjet: "DOSSIER_LLD",
        objetId: dossier.id,
        action: "CHANGEMENT_ETAPE",
        ancienneValeur: dossier.statut,
        nouvelleValeur: nouveau,
        detail: `Devis CRM ${d.indent ?? `#${d.id}`} passé à « ${libelleStatut(d.status)} »`,
        auteurId: null,
      });

      // L'opportunité suit, sauf si elle aussi a été déplacée à la main.
      const etapeAttendue = etapeDepuisStatutLld(ancien);
      if (dossier.opportunite.etape === etapeAttendue) {
        await tx.opportunite.update({
          where: { id: dossier.opportunite.id },
          data: {
            etape: etapeDepuisStatutLld(nouveau),
            entreEnEtapeLe: new Date(),
            ...clotureOpportunite(nouveau, d),
          },
        });
      }
    }
  });

  if (deplaceALaMain) return "gardes";
  return nouveau === dossier.statut ? "inchanges" : "avances";
}

function cloture(statut: StatutLld, status: string | null | undefined) {
  return statut === "CLOTURE_NON_POURSUIVI"
    ? {
        motifCloture: "AUTRE" as const,
        commentaireCloture: `Devis ${libelleStatut(status)} dans le CRM.`,
      }
    : {};
}

function clotureOpportunite(statut: StatutLld, d: DevisFinance) {
  if (statut === "LIVRAISON_CONFIRMEE_CONTRAT_ACTIF") {
    return { montantRetenu: d.montant_ht ?? undefined };
  }
  if (statut === "CLOTURE_NON_POURSUIVI") {
    return {
      motifCloture: "AUTRE" as const,
      commentaireCloture: `Devis ${libelleStatut(d.status)} dans le CRM.`,
    };
  }
  return {};
}

async function creer(d: DevisFinance): Promise<"crees"> {
  if (!d.client?.id) throw new Error("devis sans client");

  const reprise = await reprendreClient(d.client);
  if ("erreur" in reprise) throw new Error(`client ${d.client.id} : ${reprise.erreur}`);
  const organisationId = reprise.organisationId;

  const commercial = d.ref_commercial_id
    ? await prisma.utilisateur.findFirst({
        where: { idCrm: d.ref_commercial_id, actif: true },
        select: { id: true },
      })
    : null;

  // Le lead d'origine, si la demande CRM a déjà été importée comme lead.
  const lead = d.opportunite_id
    ? await prisma.lead.findUnique({
        where: { idCrmOpportunite: d.opportunite_id },
        select: { id: true, opportunite: { select: { id: true, dossierLld: { select: { id: true } } } } },
      })
    : null;

  const statut = statutLldDepuisDevis(d.status);
  const etape = etapeDepuisStatutLld(statut);
  const creeLe = d.date_crea ? new Date(d.date_crea) : new Date();
  const titre =
    texteDepuisHtml(d.objet).replace(/\s+/g, " ").trim().slice(0, 200) ||
    `Location financière — devis ${d.indent ?? d.id}`;
  const reference = d.indent ?? `#${d.id}`;

  await prisma.$transaction(async (tx) => {
    // Une opportunité déjà issue de ce lead, sans dossier, est réutilisée :
    // pas de seconde fiche pour la même affaire (§1).
    let opportuniteId = lead?.opportunite && !lead.opportunite.dossierLld
      ? lead.opportunite.id
      : null;

    if (opportuniteId) {
      await tx.opportunite.update({
        where: { id: opportuniteId },
        data: { etape, projetRecherche: "LLD", entreEnEtapeLe: new Date(), ...clotureOpportunite(statut, d) },
      });
    } else {
      const refOpp = await genererReference(tx, "OPP");
      const max = await tx.opportunite.aggregate({ where: { etape }, _max: { rang: true } });
      const opp = await tx.opportunite.create({
        data: {
          reference: refOpp,
          titre,
          etape,
          projetRecherche: "LLD",
          organisationId,
          commercialId: commercial?.id ?? null,
          // Un lead déjà converti garde son opportunité ; on ne s'y rattache
          // que s'il ne l'est pas encore.
          leadId: lead && !lead.opportunite ? lead.id : null,
          rang: (max._max.rang ?? -1) + 1,
          creeLe,
          entreEnEtapeLe: creeLe,
          ...clotureOpportunite(statut, d),
        } satisfies Prisma.OpportuniteUncheckedCreateInput,
      });
      opportuniteId = opp.id;
      await journaliser(tx, {
        typeObjet: "OPPORTUNITE",
        objetId: opp.id,
        action: "CREATION",
        detail: `${refOpp} créée depuis le devis CRM ${reference}, facturé à GRENKE`,
        auteurId: null,
      });
      if (lead && !lead.opportunite) {
        await tx.lead.update({
          where: { id: lead.id },
          data: { statut: "QUALIFIE_A_CONVERTIR", entreEnEtapeLe: new Date() },
        });
      }
    }

    const refLld = await genererReference(tx, "LLD");
    const maxLld = await tx.dossierLld.aggregate({ where: { statut }, _max: { rang: true } });
    const dossier = await tx.dossierLld.create({
      data: {
        reference: refLld,
        statut,
        dureeDemandeeMois: null, // le devis ne la porte pas : à renseigner
        montantFinance: d.montant_ht ?? null,
        opportuniteId,
        commercialId: commercial?.id ?? null,
        idCrmDevis: d.id,
        referenceDevisCrm: d.indent ?? null,
        statutCrm: d.status ?? null,
        rang: (maxLld._max.rang ?? -1) + 1,
        creeLe,
        entreEnEtapeLe: creeLe,
        ...cloture(statut, d.status),
      } satisfies Prisma.DossierLldUncheckedCreateInput,
    });

    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: dossier.id,
      action: "CREATION_LLD",
      detail:
        `${refLld} importé du devis CRM ${reference} (${libelleStatut(d.status)})` +
        (statut === "LIVRAISON_CONFIRMEE_CONTRAT_ACTIF"
          ? " — contrat actif : facture émise à GRENKE"
          : ""),
      auteurId: null,
    });

    // La checklist n'a de sens que pour un dossier encore en préparation.
    if (statut === "DOSSIER_A_PREPARER") {
      await tx.checklistItem.createMany({
        data: CHECKLIST_INTERNE.map((libelle, ordre) => ({
          libelle,
          ordre,
          dossierLldId: dossier.id,
        })),
      });
    }
  });

  return "crees";
}

export function resumerFinancements(b: BilanFinancements): string {
  if (b.etat !== "ok") return `financements CRM : ${b.etat}${b.detail ? ` — ${b.detail}` : ""}`;
  return (
    `financements CRM : ${b.crees} créé(s), ${b.avances} avancé(s), ` +
    `${b.inchanges} inchangé(s), ${b.gardes} gardé(s) — déplacés à la main, ` +
    `${b.erreurs.length} erreur(s)`
  );
}
