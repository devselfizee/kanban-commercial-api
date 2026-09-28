/**
 * Utilisateurs.
 *
 * L'identité de l'appelant sert au front à afficher son nom et son rôle ;
 * la liste de l'équipe alimente les listes déroulantes d'attribution.
 */

import { routeur } from "../lib/routeur";
import { prisma } from "../lib/prisma";
import { peutParametrer } from "../lib/auth";
import { synchroniserEquipe } from "../crm/equipe";

const routes = routeur();

/** L'utilisateur courant, tel que le back l'a identifié. */
routes.get("/moi", (requete, reponse) => {
  reponse.json(requete.utilisateur);
});

/** L'équipe, pour l'attribution des cartes. */
routes.get("/", async (requete, reponse) => {
  const role = String(requete.query.role ?? "");
  const utilisateurs = await prisma.utilisateur.findMany({
    where: {
      actif: true,
      ...(role ? { role: { in: role.split(",") as never } } : {}),
    },
    select: { id: true, prenom: true, nom: true, role: true },
    orderBy: [{ role: "asc" }, { nom: "asc" }],
  });
  reponse.json(utilisateurs);
});

/**
 * Liste complète, réservée au manager.
 * En mode local (sans Keycloak), elle alimente le sélecteur d'utilisateur.
 */
routes.get("/tous", async (requete, reponse) => {
  if (!peutParametrer(requete.utilisateur!.role)) {
    return reponse.status(403).json({ erreur: "Réservé au manager." });
  }
  reponse.json(
    await prisma.utilisateur.findMany({
      orderBy: [{ role: "asc" }, { nom: "asc" }],
      select: { id: true, prenom: true, nom: true, email: true, role: true, actif: true },
    }),
  );
});

/**
 * Relit l'équipe depuis le CRM sans attendre le passage horaire — utile juste
 * après avoir créé un commercial ou changé un profil. Réservé au manager.
 */
routes.post("/synchroniser-crm", async (requete, reponse) => {
  if (!peutParametrer(requete.utilisateur!.role)) {
    return reponse.status(403).json({ erreur: "Réservé au manager." });
  }
  const bilan = await synchroniserEquipe();
  reponse.status(bilan.etat === "ok" ? 200 : 502).json(bilan);
});

export default routes;
