/**
 * Import des demandes entrantes du CRM en leads à qualifier.
 *
 * Le CRM reçoit environ 70 demandes par jour ouvré — formulaire du site
 * surtout — et en fait des opportunités qui restent à 94 % « Ouverte », dans
 * la première étape de leur pipeline. Elles arrivent, personne ne sait ce
 * qu'elles deviennent : c'est le « une carte ne doit jamais être perdue » du
 * document, à l'envers.
 *
 * Le kanban les reprend donc comme leads à qualifier, au lieu de demander de
 * les ressaisir. Seulement les pipelines « Pros » et « Achats » : les
 * particuliers suivent un parcours presque automatique dans le CRM.
 *
 * L'import avance par identifiant d'opportunité croissant, mémorisé en base :
 * il ne rate rien et ne prend rien deux fois. Le premier passage remonte
 * trente jours ; au-delà, le stock est en grande partie mort.
 */

import type {
  CanalDetaille,
  ModeAcquisition,
  Prisma,
  ProjetRecherche,
  SegmentClient,
  StatutLead,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { genererReference } from "../lib/references";
import { journaliser } from "../lib/journal";
import { calculerPriorite } from "../domaine/regles";
import { reprendreClient, type LigneClientCrm } from "./recherche";

const DELAI_MS = 15_000;
const TAILLE_PAGE = 100;
/** Garde-fou : un passage ne lit pas plus de 20 pages, le suivant continue. */
const PAGES_MAX = 20;
const CLE_CURSEUR = "crm.demandes.dernier_id";

/** « Pros » et « Achats - tout-venant ». */
const PIPELINES_DEFAUT = "37021,37023";
/** Le pipeline « Achats » : ses demandes portent sur un achat. */
const PIPELINE_ACHATS = 37023;

/** Statuts CRM d'une affaire déjà tranchée : rien à qualifier. */
const STATUTS_CLOS = new Set(["Gagnée", "Perdue", "Annulée", "Fermée"]);

// ---------------------------------------------------------------------------
// Correspondances — les listes du CRM traduites dans celles du document
// ---------------------------------------------------------------------------

/**
 * Source lead du CRM → mode d'acquisition et canal détaillé (§2.1).
 * Toutes ces demandes sont entrantes, sauf la rencontre avec l'équipe, qui
 * relève de la prospection.
 */
const PAR_SOURCE: Record<string, [ModeAcquisition, CanalDetaille]> = {
  "Site internet": ["ENTRANT", "FORMULAIRE_SITE"],
  "Recommandation d'un ami / contact": ["ENTRANT", "RECOMMANDATION_CLIENT"],
  "Découvert lors d'un événement": ["ENTRANT", "EVENEMENT"],
  Salon: ["ENTRANT", "SALON"],
  "Rencontre avec quelqu'un de notre équipe": ["PROSPECTION", "VISITE_TERRAIN"],
  "Réseaux sociaux": ["ENTRANT", "RESEAU_SOCIAL_ENTRANT"],
  "Recommendation partenaire professionnel": ["ENTRANT", "PARTENAIRE"],
};

export function acquisitionDepuisSource(
  source: string | null | undefined,
): [ModeAcquisition, CanalDetaille] {
  // « Document pub papier », « Autre », ou rien : une demande de devis
  // entrante, sans canal plus précis.
  return PAR_SOURCE[source?.trim() ?? ""] ?? ["ENTRANT", "DEMANDE_DEVIS"];
}

/**
 * Secteur d'activité du CRM (26 valeurs) → segment du document (11 valeurs).
 * Le libellé CRM est conservé à côté, dans `secteurCrm` : la traduction perd
 * de la finesse, le libellé d'origine non.
 */
const PAR_SECTEUR: Record<number, SegmentClient> = {
  1: "AGENCE_EVENEMENTIELLE", // Agence événementielle & communication
  2: "COMMERCE", // Centre commercial, galerie marchande
  3: "COLLECTIVITE_ASSOCIATION", // Administration, fonction publique
  4: "ENTREPRISE", // Banque, assurance, mutuelles
  5: "COMMERCE", // Commerce de détail
  6: "COMMERCE", // Grande et moyenne surface
  7: "ANIMATION_LOISIRS", // Tourisme
  8: "LIEU_DE_RECEPTION", // Lieu de réception, restaurant, traiteur
  10: "HOTEL_CAMPING", // Hôtel, hébergement
  11: "AUTRE_PROFESSIONNEL", // Santé, action sociale
  12: "AUTRE_PROFESSIONNEL", // Services aux particuliers
  13: "COLLECTIVITE_ASSOCIATION", // Association professionnelle
  14: "ENTREPRISE", // Entreprise du secteur privé
  15: "ENTREPRISE", // Entreprise du secteur public
  16: "ETABLISSEMENT_ENSEIGNEMENT", // Enseignement, formation
  17: "ANIMATION_LOISIRS", // Bar, cabaret, discothèque
  18: "COMMERCE", // Concession automobile, garage
  19: "AUTRE_PROFESSIONNEL", // Autres secteurs d'activité
  20: "ANIMATION_LOISIRS", // Casino
  21: "COLLECTIVITE_ASSOCIATION", // Association bénévole
  22: "AUTRE_PROFESSIONNEL", // Domaine viticole, maison de champagne
  24: "LOUEUR_PRESTATAIRE_EVENEMENTIEL", // Congrès, salon, foire
  25: "ENTREPRISE", // Comité social et économique
  26: "LOUEUR_PRESTATAIRE_EVENEMENTIEL", // Photographe
  27: "LOUEUR_PRESTATAIRE_EVENEMENTIEL", // Prestataire événementiel
};

export function segmentDepuisClient(client: {
  client_type?: string | null;
  secteurs?: { id: number }[];
} | null): SegmentClient | null {
  if (!client) return null;
  if (client.client_type === "person") return "PARTICULIER";
  for (const s of client.secteurs ?? []) {
    const segment = PAR_SECTEUR[s.id];
    if (segment) return segment;
  }
  return null;
}

// ---------------------------------------------------------------------------
// L'import
// ---------------------------------------------------------------------------

type DemandeCrm = {
  id: number;
  numero?: string | null;
  nom?: string | null;
  brief?: string | null;
  type_demande?: string | null;
  date_echeance?: string | null;
  montant_potentiel?: number | null;
  created?: string | null;
  pipeline_id?: number | null;
  statut?: string | null;
  source?: string | null;
  commerciaux?: number[];
  client?:
    | (LigneClientCrm & {
        ville?: string | null;
        secteurs?: { id: number; nom: string }[];
      })
    | null;
};

export type BilanDemandes = {
  etat: "ok" | "non_configure" | "indisponible";
  detail?: string;
  importees: number;
  ignorees: number;
  erreurs: { idCrm: number; detail: string }[];
  dernierId: number | null;
};

let enCours = false;

export async function importerDemandes(): Promise<BilanDemandes> {
  const bilan: BilanDemandes = {
    etat: "ok",
    importees: 0,
    ignorees: 0,
    erreurs: [],
    dernierId: null,
  };

  const urlCrm = process.env.CRM_URL;
  if (!urlCrm) return { ...bilan, etat: "non_configure" };

  // Le démarrage et le passage périodique peuvent se chevaucher : un seul
  // import à la fois.
  if (enCours) {
    return { ...bilan, etat: "indisponible", detail: "Un import est déjà en cours." };
  }
  enCours = true;

  try {
    const pipelines = (process.env.CRM_PIPELINES_DEMANDES ?? PIPELINES_DEFAUT)
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    const curseur = await prisma.parametre.findUnique({ where: { cle: CLE_CURSEUR } });
    let dernierId = curseur ? Number(curseur.valeur) : 0;

    const jours = Number(process.env.CRM_DEMANDES_JOURS_INITIAUX ?? 30);
    const depuis = new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10);

    for (let page = 0; page < PAGES_MAX; page++) {
      const url =
        `${urlCrm.replace(/\/$/, "")}/api-v1/opportunites/demandes` +
        `?pipelines=${pipelines.join(",")}&limit=${TAILLE_PAGE}` +
        (dernierId > 0 ? `&apres_id=${dernierId}` : `&depuis=${depuis}`);

      let corps: { data?: DemandeCrm[]; suite?: boolean };
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
                ? "Le CRM n'expose pas encore /api-v1/opportunites/demandes."
                : `Le CRM a répondu ${reponse.status}.`,
          };
        }
        corps = await reponse.json();
      } catch (e) {
        return {
          ...bilan,
          etat: "indisponible",
          detail: e instanceof Error ? e.message : "CRM injoignable.",
        };
      }

      const demandes = Array.isArray(corps.data) ? corps.data : [];
      for (const d of demandes) {
        try {
          const issue = await importerUne(d);
          if (issue === "importee") bilan.importees++;
          else bilan.ignorees++;
        } catch (e) {
          bilan.erreurs.push({
            idCrm: d.id,
            detail: e instanceof Error ? e.message : String(e),
          });
        }
        // Le curseur avance même sur une erreur : une demande illisible ne
        // doit pas bloquer toutes les suivantes. Elle est signalée au bilan.
        dernierId = Math.max(dernierId, d.id);
      }

      if (demandes.length) {
        await prisma.parametre.upsert({
          where: { cle: CLE_CURSEUR },
          create: { cle: CLE_CURSEUR, valeur: String(dernierId) },
          update: { valeur: String(dernierId) },
        });
      }
      if (!corps.suite) break;
    }

    bilan.dernierId = dernierId || null;
    return bilan;
  } finally {
    enCours = false;
  }
}

async function importerUne(d: DemandeCrm): Promise<"importee" | "ignoree"> {
  if (d.statut && STATUTS_CLOS.has(d.statut)) return "ignoree";

  const deja = await prisma.lead.findUnique({
    where: { idCrmOpportunite: d.id },
    select: { id: true },
  });
  if (deja) return "ignoree";

  // Le client existait-il déjà dans le kanban ? C'est un critère de priorité.
  let organisationId: string | null = null;
  let clientExistant = false;
  if (d.client?.id) {
    const connue = await prisma.organisation.findUnique({
      where: { idCrm: Number(d.client.id) },
      select: { id: true },
    });
    clientExistant = Boolean(connue);
    const reprise = await reprendreClient(d.client);
    if ("erreur" in reprise) throw new Error(`client ${d.client.id} : ${reprise.erreur}`);
    organisationId = reprise.organisationId;
  }

  const [modeAcquisition, canalDetaille] = acquisitionDepuisSource(d.source);
  const segment = segmentDepuisClient(d.client ?? null);
  const projetRecherche: ProjetRecherche =
    d.pipeline_id === PIPELINE_ACHATS ? "ACHAT" : "A_PRECISER";

  const creeLe = d.created ? new Date(d.created.replace(" ", "T")) : new Date();
  const echeance = d.date_echeance ? new Date(d.date_echeance) : null;
  const joursAvantEcheance = echeance
    ? Math.round((echeance.getTime() - Date.now()) / 86_400_000)
    : null;

  const { priorite } = calculerPriorite({
    estEntrant: modeAcquisition === "ENTRANT",
    joursAvantEcheance,
    devisDemande: true, // toutes sont des « demandes de devis / contact »
    clientExistant,
    valeurIndicative: d.montant_potentiel ?? null,
  });

  // Un commercial déjà désigné dans le CRM, et connu du kanban, prend la carte.
  const proprietaire = d.commerciaux?.length
    ? await prisma.utilisateur.findFirst({
        where: { idCrm: { in: d.commerciaux }, actif: true },
        select: { id: true },
      })
    : null;
  const statut: StatutLead = proprietaire
    ? "PREMIER_CONTACT_A_REALISER"
    : "NOUVEAU_NON_ATTRIBUE";

  // Une demande entrante se prend en charge le jour même (§4).
  const prochaineActionLe = new Date();
  const prochaineActionLabel = "Premier contact suite à la demande";

  const besoin = [d.nom, d.type_demande, d.brief]
    .map((t) => t?.trim())
    .filter(Boolean)
    .join(" — ")
    .slice(0, 1000);

  const client = d.client;
  const nomBrut = client
    ? null
    : d.nom?.trim() || `Demande CRM ${d.numero ?? d.id}`;

  await prisma.$transaction(async (tx) => {
    const reference = await genererReference(tx, "L");
    const max = await tx.lead.aggregate({ where: { statut }, _max: { rang: true } });

    const lead = await tx.lead.create({
      data: {
        reference,
        modeAcquisition,
        canalDetaille,
        statut,
        priorite,
        segment,
        projetRecherche,
        besoinResume: besoin || null,
        ville: client?.ville?.trim() || null,
        nomBrut,
        organisationId,
        proprietaireId: proprietaire?.id ?? null,
        dateAttribution: proprietaire ? new Date() : null,
        prochaineActionLe,
        prochaineActionLabel,
        rang: (max._max.rang ?? -1) + 1,
        idCrmOpportunite: d.id,
        numeroCrm: d.numero ?? null,
        sourceCrm: d.source ?? null,
        secteurCrm: client?.secteurs?.map((s) => s.nom).join(", ") || null,
        demandeCrmLe: creeLe,
        // L'âge réel de la demande, pas celui de l'import : une demande de
        // trois semaines n'est pas fraîche parce qu'on vient de la reprendre.
        creeLe,
        entreEnEtapeLe: creeLe,
      } satisfies Prisma.LeadUncheckedCreateInput,
    });

    await journaliser(tx, {
      typeObjet: "LEAD",
      objetId: lead.id,
      action: "CREATION",
      detail: `${reference} importé de la demande CRM ${d.numero ?? `#${d.id}`}${
        d.source ? ` (${d.source})` : ""
      }`,
      auteurId: null,
    });

    await tx.tache.create({
      data: {
        libelle: prochaineActionLabel,
        echeance: prochaineActionLe,
        responsableId: proprietaire?.id ?? null,
        leadId: lead.id,
      },
    });
  });

  return "importee";
}

export function resumerDemandes(b: BilanDemandes): string {
  if (b.etat !== "ok") return `demandes CRM : ${b.etat}${b.detail ? ` — ${b.detail}` : ""}`;
  return (
    `demandes CRM : ${b.importees} importée(s), ${b.ignorees} ignorée(s), ` +
    `${b.erreurs.length} erreur(s)` +
    (b.dernierId ? `, dernière #${b.dernierId}` : "")
  );
}
