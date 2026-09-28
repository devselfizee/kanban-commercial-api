/**
 * Devis du CRM, lus à la demande.
 *
 * Le CRM en compte plus de 400 000. Les synchroniser reviendrait à publier un
 * évènement par enregistrement pour alimenter une table que le kanban n'affiche
 * qu'en lecture, sur une fiche — et la quasi-totalité d'entre eux ne se
 * rattache à aucune opportunité du kanban.
 *
 * On les lit donc quand une fiche s'ouvre, sans rien stocker. Le CRM reste la
 * seule source : aucun risque de divergence, et rien à reprendre.
 *
 * Le revers assumé : sans CRM joignable, la liste est absente. C'est pourquoi
 * l'appelant reçoit un état explicite plutôt qu'une liste vide — une section
 * vide ferait croire qu'il n'y a pas de devis, ce qui n'est pas la même chose
 * que « je n'ai pas pu regarder ».
 */

import { estGrenke } from "./partenaire";

const DELAI_MS = 5_000;

export type DevisCrm = {
  id: number;
  reference: string | null;
  objet: string | null;
  statut: string | null;
  dateCreation: string | null;
  dateEvenement: string | null;
  montantHt: number | null;
  montantTtc: number | null;
  typeDocument: string | null;
  /** Facturé à GRENKE : l'affaire est financée en location financière. */
  financeGrenke: boolean;
};

export type ResultatDevis =
  | { etat: "ok"; devis: DevisCrm[]; total: number }
  | { etat: "non_configure" }
  | { etat: "indisponible"; detail: string };

type LigneCrm = {
  id: number;
  indent?: string | null;
  objet?: string | null;
  status?: string | null;
  date_crea?: string | null;
  date_evenement?: string | null;
  montant_ht?: number | null;
  total_ttc?: number | null;
  type_doc_nom?: string | null;
  facture_a_client_id?: number | null;
};

/**
 * Les devis d'un client du CRM, les plus récents d'abord.
 *
 * `idCrm` est l'identifiant côté CRM, porté par l'organisation. Une
 * organisation créée dans le kanban sans correspondance CRM n'en a pas : il
 * n'y a alors rien à demander.
 */
export async function devisDuClient(
  idCrm: number | null | undefined,
  limite = 20,
): Promise<ResultatDevis> {
  const urlCrm = process.env.CRM_URL;
  if (!urlCrm) return { etat: "non_configure" };
  // GRENKE n'est pas un client à qui l'on vend : lister ses devis reviendrait
  // à afficher toutes les affaires financées de Selfizee sur une fiche.
  if (!idCrm || estGrenke(idCrm)) return { etat: "ok", devis: [], total: 0 };

  const url =
    `${urlCrm.replace(/\/$/, "")}/api-v1/devis/list` +
    `?client_id=${idCrm}&limit=${Math.min(200, Math.max(1, limite))}`;

  try {
    // Le CRM ne doit pas pouvoir suspendre l'affichage d'une fiche.
    const reponse = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DELAI_MS),
    });

    if (!reponse.ok) {
      return {
        etat: "indisponible",
        detail: `Le CRM a répondu ${reponse.status}.`,
      };
    }

    const corps = (await reponse.json()) as {
      data?: LigneCrm[];
      pagination?: { total?: number };
    };
    const lignes = Array.isArray(corps.data) ? corps.data : [];

    return {
      etat: "ok",
      devis: lignes.map(normaliser),
      total: corps.pagination?.total ?? lignes.length,
    };
  } catch (e) {
    const expire = e instanceof Error && e.name === "TimeoutError";
    return {
      etat: "indisponible",
      detail: expire
        ? "Le CRM n'a pas répondu dans le délai imparti."
        : e instanceof Error
          ? e.message
          : "CRM injoignable.",
    };
  }
}

/** Les champs du CRM, renommés dans le vocabulaire du kanban. */
function normaliser(l: LigneCrm): DevisCrm {
  return {
    id: l.id,
    reference: l.indent ?? null,
    objet: l.objet ?? null,
    statut: l.status ?? null,
    dateCreation: l.date_crea ?? null,
    dateEvenement: l.date_evenement ?? null,
    montantHt: typeof l.montant_ht === "number" ? l.montant_ht : null,
    montantTtc: typeof l.total_ttc === "number" ? l.total_ttc : null,
    typeDocument: l.type_doc_nom ?? null,
    financeGrenke: estGrenke(l.facture_a_client_id),
  };
}
