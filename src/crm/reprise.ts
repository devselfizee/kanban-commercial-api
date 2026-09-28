/**
 * Reprise initiale des clients déjà présents dans le CRM.
 *
 * Le bus RabbitMQ ne publie qu'au moment où une donnée change : un client créé
 * l'an dernier et jamais modifié depuis n'émettra jamais rien. Le kanban
 * démarrerait donc vide, et ne se remplirait qu'au fil des modifications.
 *
 * Cette reprise parcourt `/api-v1/clients/list` et rejoue chaque enregistrement
 * comme un évènement, à travers `appliquerEvenement()`. Réutiliser ce chemin
 * plutôt que d'écrire des insertions directes apporte gratuitement ce qui
 * compte :
 *
 *   - rapprochement avant création — un client déjà remonté par le bus n'est
 *     pas dupliqué ;
 *   - idempotence par empreinte — la reprise peut être relancée sans dégât ;
 *   - préservation du travail commercial — les leads et opportunités attachés
 *     à une organisation existante ne sont jamais écrasés.
 *
 * ⚠ Limite connue. L'endpoint ne renvoie que neuf champs : ni SIRET, ni
 * adresse, ni ville, ni dates. Les organisations créées ici sont donc plus
 * pauvres que celles qui arrivent par le bus, et le rapprochement se fait sur
 * l'e-mail, le téléphone ou le nom plutôt que sur le SIREN. Les champs
 * manquants se compléteront à la première modification côté CRM. Pour une
 * reprise complète, il faudrait élargir le `select` de `ClientsController::list`.
 */

import { appliquerEvenement } from "./synchronisation";
import type { ResultatSynchro } from "@prisma/client";

export type OptionsReprise = {
  /** Racine du CRM, sans barre finale. */
  urlCrm: string;
  /** Nombre d'enregistrements par page. Le CRM plafonne à 200. */
  taillePage?: number;
  /** N'écrit rien : compte ce qui serait fait. */
  simulation?: boolean;
  /** S'arrêter après N pages — utile pour un premier essai. */
  pagesMax?: number;
  /** Suivi de progression. */
  journaliser?: (message: string) => void;
};

export type BilanReprise = {
  lus: number;
  parResultat: Record<string, number>;
  erreurs: { id: unknown; detail: string }[];
  simulation: boolean;
};

type ReponseListe = {
  data?: unknown[];
  pagination?: { page?: number; total?: number; total_pages?: number };
};

export async function repriseClients(
  options: OptionsReprise,
): Promise<BilanReprise> {
  const {
    urlCrm,
    taillePage = 200,
    simulation = false,
    pagesMax,
    journaliser = () => {},
  } = options;

  const bilan: BilanReprise = {
    lus: 0,
    parResultat: {},
    erreurs: [],
    simulation,
  };

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    if (pagesMax && page > pagesMax) {
      journaliser(`Arrêt demandé après ${pagesMax} page(s).`);
      break;
    }

    const url = `${urlCrm.replace(/\/$/, "")}/api-v1/clients/list?page=${page}&limit=${taillePage}`;
    const reponse = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!reponse.ok) {
      throw new Error(
        `Le CRM a répondu ${reponse.status} sur la page ${page}. Reprise interrompue.`,
      );
    }

    const corps = (await reponse.json()) as ReponseListe;
    const lignes = Array.isArray(corps.data) ? corps.data : [];
    totalPages = corps.pagination?.total_pages ?? 1;

    if (page === 1) {
      journaliser(
        `${corps.pagination?.total ?? lignes.length} client(s) à reprendre, ${totalPages} page(s).`,
      );
    }

    for (const ligne of lignes) {
      bilan.lus++;
      const charge = ligne as Record<string, unknown>;

      if (simulation) {
        compter(bilan, "SIMULE");
        continue;
      }

      try {
        // `created` fait de chaque enregistrement une création : le
        // rapprochement décidera s'il faut créer ou rattacher.
        const issue = await appliquerEvenement({
          routingKey: "crm.clients.created",
          charge,
        });
        compter(bilan, issue.resultat);
        if (issue.resultat === "ERREUR") {
          bilan.erreurs.push({ id: charge.id, detail: issue.detail });
        }
      } catch (e) {
        compter(bilan, "ERREUR");
        bilan.erreurs.push({
          id: charge.id,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }

    journaliser(`Page ${page}/${totalPages} — ${bilan.lus} lu(s).`);
    page++;
  }

  return bilan;
}

function compter(bilan: BilanReprise, resultat: ResultatSynchro | string) {
  bilan.parResultat[resultat] = (bilan.parResultat[resultat] ?? 0) + 1;
}
