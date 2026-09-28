/**
 * Synchronisation de l'équipe avec les utilisateurs du CRM.
 *
 * Les commerciaux se connectent déjà au CRM pour créer devis et clients : ils
 * ne doivent pas être recréés à la main dans le kanban. Le CRM fait donc
 * autorité sur qui est dans l'équipe et avec quel rôle, lu à partir de ses
 * profils (« Konitys Commercial » = 11, etc.).
 *
 * Les correspondances profil → rôle sont des variables d'environnement : les
 * numéros de profil diffèrent d'une base à l'autre, et un profil créé demain
 * — la collaboratrice LLD — se branche sans redéploiement de code.
 *
 * Garanties :
 *   - un compte créé à la main (sans `idCrm`) n'est jamais modifié ;
 *   - un compte déjà présent est rattaché par son e-mail plutôt que dupliqué ;
 *   - un utilisateur qui disparaît du CRM est désactivé, jamais supprimé : il
 *     porte des cartes et des entrées de journal ;
 *   - une réponse vide ou en erreur ne désactive personne — un CRM en panne ne
 *     doit pas vider l'équipe.
 */

import type { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";

const DELAI_MS = 10_000;

/**
 * Ordre de priorité quand une personne cumule plusieurs profils : le rôle le
 * plus large l'emporte. Le manager passe avant la direction, qui n'a que la
 * lecture dans le kanban.
 */
const PRIORITE: Role[] = ["MANAGER", "DIRECTION", "COLLABORATRICE_LLD", "COMMERCIAL"];

const VARIABLE_PAR_ROLE: Record<Role, string> = {
  MANAGER: "CRM_PROFILS_MANAGER",
  DIRECTION: "CRM_PROFILS_DIRECTION",
  COLLABORATRICE_LLD: "CRM_PROFILS_LLD",
  COMMERCIAL: "CRM_PROFILS_COMMERCIAL",
};

/** « Konitys Commercial » : le seul numéro connu à l'avance. */
const DEFAUT_COMMERCIAL = "11";

type UtilisateurCrm = {
  id: number;
  nom?: string | null;
  prenom?: string | null;
  email?: string | null;
  profils?: number[];
};

export type BilanEquipe = {
  etat: "ok" | "non_configure" | "indisponible";
  detail?: string;
  crees: number;
  misAJour: number;
  rattaches: number;
  desactives: number;
  ignores: { idCrm: number; motif: string }[];
};

/** Profil CRM → rôle kanban, lu depuis l'environnement. */
export function correspondances(): Map<number, Role> {
  const carte = new Map<number, Role>();
  // Parcourue du moins au plus prioritaire : un numéro déclaré pour deux rôles
  // garde le plus large.
  for (const role of [...PRIORITE].reverse()) {
    const brut =
      process.env[VARIABLE_PAR_ROLE[role]] ??
      (role === "COMMERCIAL" ? DEFAUT_COMMERCIAL : "");
    for (const morceau of brut.split(",")) {
      const n = Number(morceau.trim());
      if (Number.isInteger(n) && n > 0) carte.set(n, role);
    }
  }
  return carte;
}

/** Le rôle le plus large parmi les profils de la personne, ou rien. */
export function roleDepuisProfils(
  profils: number[],
  carte: Map<number, Role>,
): Role | null {
  const roles = new Set(
    profils.map((p) => carte.get(p)).filter((r): r is Role => !!r),
  );
  return PRIORITE.find((r) => roles.has(r)) ?? null;
}

export async function synchroniserEquipe(): Promise<BilanEquipe> {
  const bilan: BilanEquipe = {
    etat: "ok",
    crees: 0,
    misAJour: 0,
    rattaches: 0,
    desactives: 0,
    ignores: [],
  };

  const urlCrm = process.env.CRM_URL;
  if (!urlCrm) return { ...bilan, etat: "non_configure" };

  const carte = correspondances();
  const url =
    `${urlCrm.replace(/\/$/, "")}/api-v1/users/equipe` +
    `?profils=${[...carte.keys()].join(",")}`;

  let recus: UtilisateurCrm[];
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
            ? "Le CRM n'expose pas encore /api-v1/users/equipe."
            : `Le CRM a répondu ${reponse.status}.`,
      };
    }
    const corps = (await reponse.json()) as { data?: UtilisateurCrm[] };
    recus = Array.isArray(corps.data) ? corps.data : [];
  } catch (e) {
    return {
      ...bilan,
      etat: "indisponible",
      detail: e instanceof Error ? e.message : "CRM injoignable.",
    };
  }

  // Une liste vide est bien plus souvent une anomalie qu'une équipe réellement
  // partie : on ne désactive personne sur cette base.
  if (recus.length === 0) {
    return {
      ...bilan,
      etat: "indisponible",
      detail: "Le CRM a renvoyé une équipe vide : aucune modification appliquée.",
    };
  }

  const vus = new Set<number>();
  const maintenant = new Date();

  for (const u of recus) {
    const idCrm = Number(u.id);
    if (!Number.isInteger(idCrm)) continue;

    const role = roleDepuisProfils(u.profils ?? [], carte);
    if (!role) {
      bilan.ignores.push({ idCrm, motif: "aucun profil correspondant à un rôle" });
      continue;
    }

    const email = u.email?.trim().toLowerCase();
    if (!email) {
      // Sans e-mail, pas de connexion Keycloak possible : le compte serait
      // inutilisable, et on ne peut pas le rattacher à un existant.
      bilan.ignores.push({ idCrm, motif: "pas d'e-mail dans le CRM" });
      continue;
    }
    vus.add(idCrm);

    const donnees = {
      email,
      nom: u.nom?.trim() || email,
      prenom: u.prenom?.trim() || "",
      role,
      actif: true,
      idCrm,
      synchroniseLe: maintenant,
    };

    const parId = await prisma.utilisateur.findUnique({ where: { idCrm } });
    if (parId) {
      await prisma.utilisateur.update({ where: { id: parId.id }, data: donnees });
      bilan.misAJour++;
      continue;
    }

    // Un compte créé à la main avec le même e-mail : on le rattache plutôt que
    // d'en créer un second, qui buterait sur l'unicité de l'e-mail.
    const parEmail = await prisma.utilisateur.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (parEmail) {
      if (parEmail.idCrm && parEmail.idCrm !== idCrm) {
        bilan.ignores.push({
          idCrm,
          motif: `e-mail déjà lié à l'utilisateur CRM ${parEmail.idCrm}`,
        });
        vus.delete(idCrm);
        continue;
      }
      await prisma.utilisateur.update({ where: { id: parEmail.id }, data: donnees });
      bilan.rattaches++;
      continue;
    }

    await prisma.utilisateur.create({ data: donnees });
    bilan.crees++;
  }

  // Partis du CRM, ou plus dans un profil suivi : désactivés, pas supprimés.
  const partis = await prisma.utilisateur.updateMany({
    where: {
      idCrm: { not: null, notIn: [...vus] },
      actif: true,
    },
    data: { actif: false, synchroniseLe: maintenant },
  });
  bilan.desactives = partis.count;

  return bilan;
}

/** Résumé d'une ligne pour les journaux. */
export function resumer(b: BilanEquipe): string {
  if (b.etat !== "ok") return `équipe CRM : ${b.etat}${b.detail ? ` — ${b.detail}` : ""}`;
  return (
    `équipe CRM : ${b.crees} créé(s), ${b.misAJour} mis à jour, ` +
    `${b.rattaches} rattaché(s), ${b.desactives} désactivé(s), ` +
    `${b.ignores.length} ignoré(s)`
  );
}
