/**
 * Authentification et matrice de droits (§5, §12).
 *
 * Architecture séparée : le front obtient un jeton auprès de Keycloak et le
 * présente à chaque requête. Le back en vérifie la **signature** auprès du JWKS
 * du realm — un jeton n'est jamais cru sur parole, sans quoi n'importe qui
 * pourrait en fabriquer un et s'attribuer le rôle de son choix.
 *
 * Keycloak répond à une seule question : qui êtes-vous, et avez-vous le droit
 * d'entrer ? Le droit d'entrer est porté par le rôle `kanban-commercial`.
 * Le rôle métier — commercial, collaboratrice LLD, manager, direction — reste
 * géré ici et rapproché par l'e-mail : c'est un découpage propre à cette
 * application, pas une notion d'annuaire.
 *
 * Sans configuration Keycloak, un mode local permet de désigner l'utilisateur
 * par un en-tête. Il est réservé au développement et ne doit jamais être exposé.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "./prisma";

const ROLE_ACCES = process.env.KEYCLOAK_ROLE_ACCES || "kanban-commercial";
const ISSUER = process.env.KEYCLOAK_ISSUER;
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID;

/** Vrai lorsque la vérification des jetons est active. */
export const authentificationActive = Boolean(ISSUER);

/** Le jeu de clés publiques du realm, mis en cache par `jose`. */
const jwks = ISSUER
  ? createRemoteJWKSet(new URL(`${ISSUER}/protocol/openid-connect/certs`))
  : null;

export type UtilisateurCourant = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  role: Role;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Renseigné par `exigerAuthentification`. */
      utilisateur?: UtilisateurCourant;
      /** E-mail du jeton, même si aucun compte ne correspond ici. */
      emailJeton?: string;
    }
  }
}

type ChargeJeton = {
  email?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
};

function aLeRoleAcces(charge: ChargeJeton): boolean {
  const realm = charge.realm_access?.roles ?? [];
  const client = CLIENT_ID
    ? (charge.resource_access?.[CLIENT_ID]?.roles ?? [])
    : [];
  return [...realm, ...client].includes(ROLE_ACCES);
}

/**
 * Vérifie le jeton porteur et rattache l'utilisateur à la requête.
 *
 * Trois refus distincts, parce qu'ils appellent trois réactions différentes :
 *   401 sans jeton valide, 403 sans le rôle d'accès, 403 « compte inconnu »
 *   lorsque l'authentification réussit mais qu'aucun compte ne correspond ici.
 */
export async function exigerAuthentification(
  requete: Request,
  reponse: Response,
  suite: NextFunction,
) {
  // --- Mode local, sans Keycloak -------------------------------------------
  if (!authentificationActive) {
    const id = requete.header("x-utilisateur");
    if (!id) {
      return reponse
        .status(401)
        .json({ erreur: "Aucun utilisateur sélectionné." });
    }
    const u = await prisma.utilisateur.findFirst({
      where: { id, actif: true },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
    });
    if (!u) return reponse.status(401).json({ erreur: "Utilisateur inconnu." });
    requete.utilisateur = u;
    return suite();
  }

  // --- Vérification du jeton Keycloak --------------------------------------
  const entete = requete.header("authorization");
  const jeton = entete?.startsWith("Bearer ") ? entete.slice(7) : null;
  if (!jeton || !jwks) {
    return reponse.status(401).json({ erreur: "Jeton absent." });
  }

  let charge: ChargeJeton;
  try {
    const { payload } = await jwtVerify(jeton, jwks, { issuer: ISSUER });
    charge = payload as ChargeJeton;
  } catch {
    // Signature invalide, jeton expiré ou émetteur inattendu.
    return reponse.status(401).json({ erreur: "Jeton invalide ou expiré." });
  }

  if (!aLeRoleAcces(charge)) {
    return reponse.status(403).json({
      erreur: `Votre compte ne dispose pas du rôle « ${ROLE_ACCES} ».`,
      code: "ROLE_MANQUANT",
    });
  }

  const email = charge.email ?? charge.preferred_username;
  requete.emailJeton = email;

  const utilisateur = email
    ? await prisma.utilisateur.findFirst({
        where: { email, actif: true },
        select: { id: true, nom: true, prenom: true, email: true, role: true },
      })
    : null;

  if (!utilisateur) {
    // Authentifié, mais inconnu du kanban : aucune création automatique.
    return reponse.status(403).json({
      erreur: `Aucun compte ne correspond à ${email ?? "votre identité"} dans le kanban.`,
      code: "COMPTE_INCONNU",
      email,
    });
  }

  requete.utilisateur = utilisateur;
  return suite();
}

/** Garde de rôle, à poser après `exigerAuthentification`. */
export function exigerRole(...roles: Role[]) {
  return (requete: Request, reponse: Response, suite: NextFunction) => {
    if (!requete.utilisateur) {
      return reponse.status(401).json({ erreur: "Non authentifié." });
    }
    if (!roles.includes(requete.utilisateur.role)) {
      return reponse
        .status(403)
        .json({ erreur: "Votre rôle ne permet pas cette action." });
    }
    return suite();
  };
}

// ---------------------------------------------------------------------------
// Matrice de droits
// ---------------------------------------------------------------------------

/** Le manager et la direction voient l'ensemble ; les autres leur périmètre. */
export function voitToutesLesCartes(role: Role): boolean {
  return role === "MANAGER" || role === "DIRECTION";
}

/** Seul un manager réattribue une carte déjà prise en charge. */
export function peutReattribuer(role: Role): boolean {
  return role === "MANAGER";
}

/** La collaboratrice LLD et le manager font progresser un dossier de financement. */
export function peutModifierLld(role: Role): boolean {
  return role === "COLLABORATRICE_LLD" || role === "MANAGER";
}

/**
 * Les documents liés au financement ne sont accessibles qu'aux personnes qui
 * les traitent. Le commercial voit le statut LLD et le prochain jalon, pas le
 * contenu des pièces (§12).
 */
export function peutVoirDocumentsFinanciers(role: Role): boolean {
  return role === "COLLABORATRICE_LLD" || role === "MANAGER" || role === "DIRECTION";
}

/** La direction consulte ; elle ne fait pas avancer les cartes au quotidien. */
export function peutModifierCarteCommerciale(role: Role): boolean {
  return role !== "DIRECTION";
}

export function peutParametrer(role: Role): boolean {
  return role === "MANAGER";
}
