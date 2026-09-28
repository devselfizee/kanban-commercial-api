/**
 * Affaires signées dans le CRM, par mois : location financière GRENKE d'un
 * côté, autres affaires de l'autre (§11).
 *
 * Le kanban ne voit que ce qui passe par lui ; le CRM porte l'historique des
 * devis signés. Le pilotage lit donc ces chiffres à la demande, sans les
 * copier.
 *
 * Les deux séries ne sont jamais additionnées : une vente et un financement
 * ne répondent pas à la même question.
 */

import { idClientGrenke } from "./partenaire";

const DELAI_MS = 8_000;

export type MoisSignes = {
  mois: string; // « 2026-09 »
  lldNb: number;
  lldHt: number;
  autresNb: number;
  autresHt: number;
};

export type AffairesSignees =
  | { etat: "ok"; mois: MoisSignes[] }
  | { etat: "non_configure" }
  | { etat: "indisponible"; detail: string };

type LigneCrm = {
  mois: string;
  lld_nb: number;
  lld_ht: number;
  autres_nb: number;
  autres_ht: number;
};

/** Les N derniers mois, du plus ancien au plus récent, mois vides compris. */
export function moisGlissants(nb: number, maintenant = new Date()): string[] {
  const liste: string[] = [];
  for (let i = nb - 1; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    liste.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return liste;
}

export async function affairesSignees(nbMois = 12): Promise<AffairesSignees> {
  const urlCrm = process.env.CRM_URL;
  if (!urlCrm) return { etat: "non_configure" };

  const url =
    `${urlCrm.replace(/\/$/, "")}/api-v1/devis/statistiques` +
    `?financeur=${idClientGrenke()}&mois=${nbMois}`;

  try {
    const reponse = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!reponse.ok) {
      return {
        etat: "indisponible",
        detail:
          reponse.status === 404
            ? "Le CRM n'expose pas encore /api-v1/devis/statistiques."
            : `Le CRM a répondu ${reponse.status}.`,
      };
    }
    const corps = (await reponse.json()) as { data?: LigneCrm[] };
    const parMois = new Map((corps.data ?? []).map((l) => [l.mois, l]));

    // Un mois sans devis signé figure quand même, à zéro : un trou dans la
    // série se lirait comme une donnée manquante.
    return {
      etat: "ok",
      mois: moisGlissants(nbMois).map((mois) => {
        const l = parMois.get(mois);
        return {
          mois,
          lldNb: Number(l?.lld_nb ?? 0),
          lldHt: Number(l?.lld_ht ?? 0),
          autresNb: Number(l?.autres_nb ?? 0),
          autresHt: Number(l?.autres_ht ?? 0),
        };
      }),
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
