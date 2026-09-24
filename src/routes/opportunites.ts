/**
 * Pipeline n°2 — pipeline commercial unique (§6).
 *
 * Le pipeline reste le même pour un achat et une LLD jusqu'au moment où le
 * traitement financier devient nécessaire : l'enjeu commercial ne disparaît pas
 * derrière la procédure de financement.
 */

import { Router } from "express";
import type { EtapeCommerciale, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { genererReference } from "../lib/references";
import { journaliser } from "../lib/journal";
import { peutModifierCarteCommerciale, voitToutesLesCartes } from "../lib/auth";
import {
  estEnRetard,
  estTerminaleOpportunite,
  joursDepuis,
  sansSuiviPlanifie,
  verifierCompatibilitePartenaire,
} from "../domaine/regles";

const routes = Router();

/** Checklist interne Selfizee, indépendante des pièces exigées par le partenaire. */
const CHECKLIST_INTERNE = [
  "Identité et coordonnées du locataire vérifiées",
  "Équipement et configuration arrêtés avec le client",
  "Durée et loyer confirmés avec le commercial",
  "Offre commerciale signée ou validée par le client",
  "Interlocuteur signataire identifié",
  "Coordonnées de facturation et de livraison confirmées",
  "Canal de transmission convenu avec le partenaire",
];

function dansNJours(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

async function prochainRang(
  tx: Prisma.TransactionClient,
  etape: EtapeCommerciale,
): Promise<number> {
  const max = await tx.opportunite.aggregate({ where: { etape }, _max: { rang: true } });
  return (max._max.rang ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Lecture du tableau
// ---------------------------------------------------------------------------

routes.get("/", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const filtre: Prisma.OpportuniteWhereInput = voitToutesLesCartes(utilisateur.role)
    ? {}
    : { commercialId: utilisateur.id };

  const opportunites = await prisma.opportunite.findMany({
    where: filtre,
    orderBy: [{ rang: "asc" }, { creeLe: "desc" }],
    include: {
      organisation: { select: { nom: true, ville: true, segment: true } },
      contactPrincipal: { select: { nom: true, prenom: true } },
      commercial: { select: { prenom: true, nom: true } },
      dossierLld: {
        select: { id: true, statut: true, dureeDemandeeMois: true, montantFinance: true },
      },
      activites: {
        orderBy: { dateReelle: "desc" },
        take: 1,
        select: { objet: true, dateReelle: true },
      },
      _count: { select: { activites: true } },
    },
  });

  const maintenant = new Date();

  const cartes = opportunites.map((o) => {
    // L'alerte de compatibilité suit l'opportunité dès qu'une LLD est envisagée,
    // avant même la création du dossier.
    const alerte =
      o.dossierLld || o.dureeLldMois
        ? verifierCompatibilitePartenaire(
            o.dossierLld?.dureeDemandeeMois ?? o.dureeLldMois!,
            o.dossierLld?.montantFinance
              ? Number(o.dossierLld.montantFinance)
              : o.montantVente
                ? Number(o.montantVente)
                : null,
          )
        : { aConfirmer: false, message: null };

    return {
      id: o.id,
      reference: o.reference,
      titre: o.titre,
      etape: o.etape,
      priorite: o.priorite,
      projetRecherche: o.projetRecherche,
      segment: o.organisation.segment,
      nom: o.organisation.nom,
      ville: o.organisation.ville,
      solutionEnvisagee: o.solutionEnvisagee,
      quantiteBornes: o.quantiteBornes,
      // Les valeurs restent distinctes : vente d'un côté, loyer de l'autre.
      montantVente: o.montantVente ? Number(o.montantVente) : null,
      loyerMensuelEnvisage: o.loyerMensuelEnvisage
        ? Number(o.loyerMensuelEnvisage)
        : null,
      dureeLldMois: o.dureeLldMois,
      dateCible: o.dateCible,
      dateEvenement: o.dateEvenement,
      contact: o.contactPrincipal
        ? `${o.contactPrincipal.prenom ?? ""} ${o.contactPrincipal.nom}`.trim()
        : null,
      responsable: o.commercial ? `${o.commercial.prenom} ${o.commercial.nom}` : null,
      prochaineActionLe: o.prochaineActionLe,
      prochaineActionLabel: o.prochaineActionLabel,
      prochaineActionEnRetard: estEnRetard(o.prochaineActionLe, maintenant),
      derniereActivite: o.activites[0]
        ? { objet: o.activites[0].objet, date: o.activites[0].dateReelle }
        : null,
      nbActivites: o._count.activites,
      ageEtape: joursDepuis(o.entreEnEtapeLe, maintenant),
      sansSuivi: sansSuiviPlanifie({
        prochaineActionLe: o.prochaineActionLe,
        terminale: estTerminaleOpportunite(o.etape),
      }),
      statutLld: o.dossierLld?.statut ?? null,
      dossierLldId: o.dossierLld?.id ?? null,
      alerteCompatibilite: alerte.message,
    };
  });

  // Ventes directes et LLD affichées séparément : on n'additionne jamais un
  // montant de vente et un total de loyers (§6, §11).
  const enCours = opportunites.filter((o) => !estTerminaleOpportunite(o.etape));
  const valeurs = {
    ventes: enCours
      .filter((o) => o.projetRecherche !== "LLD")
      .reduce((s, o) => s + Number(o.montantVente ?? 0), 0),
    nbVentes: enCours.filter((o) => o.projetRecherche !== "LLD").length,
    loyersMensuels: enCours
      .filter((o) => o.projetRecherche === "LLD")
      .reduce((s, o) => s + Number(o.loyerMensuelEnvisage ?? 0), 0),
    nbLld: enCours.filter((o) => o.projetRecherche === "LLD").length,
  };

  reponse.json({ cartes, valeurs });
});

// ---------------------------------------------------------------------------
// Fiche détaillée
// ---------------------------------------------------------------------------

routes.get("/:id", async (requete, reponse) => {
  const opp = await prisma.opportunite.findUnique({
    where: { id: requete.params.id },
    include: {
      organisation: true,
      contactPrincipal: true,
      commercial: { select: { id: true, prenom: true, nom: true } },
      lead: { select: { id: true, reference: true } },
      devis: { orderBy: { version: "desc" } },
      dossierLld: {
        include: {
          collaboratrice: { select: { prenom: true, nom: true } },
          checklist: { select: { fait: true } },
        },
      },
      activites: {
        orderBy: { dateReelle: "desc" },
        include: { auteur: { select: { prenom: true, nom: true } } },
      },
      taches: {
        orderBy: { echeance: "asc" },
        include: { responsable: { select: { prenom: true, nom: true } } },
      },
    },
  });

  if (!opp) return reponse.status(404).json({ erreur: "Opportunité introuvable." });

  const journal = await prisma.journalEntree.findMany({
    where: { typeObjet: "OPPORTUNITE", objetId: opp.id },
    orderBy: { creeLe: "desc" },
    include: { auteur: { select: { prenom: true, nom: true } } },
  });

  const alerte =
    opp.dureeLldMois || opp.dossierLld
      ? verifierCompatibilitePartenaire(
          opp.dossierLld?.dureeDemandeeMois ?? opp.dureeLldMois!,
          opp.dossierLld?.montantFinance
            ? Number(opp.dossierLld.montantFinance)
            : opp.montantVente
              ? Number(opp.montantVente)
              : null,
        )
      : { aConfirmer: false, message: null };

  reponse.json({ ...opp, journal, alerteCompatibilite: alerte.message });
});

// ---------------------------------------------------------------------------
// Déplacement
// ---------------------------------------------------------------------------

routes.patch("/:id/deplacer", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  if (!peutModifierCarteCommerciale(utilisateur.role)) {
    return reponse
      .status(403)
      .json({ erreur: "Votre rôle ne permet pas de déplacer une carte." });
  }

  const { etape, rang } = requete.body ?? {};
  const opp = await prisma.opportunite.findUnique({
    where: { id: requete.params.id },
    include: { dossierLld: true },
  });
  if (!opp) return reponse.status(404).json({ erreur: "Opportunité introuvable." });

  // Les issues passent par leurs actions dédiées : elles exigent un motif ou un
  // évènement de confirmation que le glisser-déposer ne fournit pas.
  if (etape === "PERDU_ABANDONNE" && !opp.motifCloture) {
    return reponse
      .status(400)
      .json({ erreur: "Utilisez « Marquer perdu » pour renseigner le motif normalisé." });
  }
  if (etape === "GAGNE_ACTIF" && !opp.dateCloture) {
    return reponse.status(400).json({
      erreur:
        "Utilisez « Marquer gagné » : la définition de « gagné » exige une confirmation explicite.",
    });
  }
  if (etape === "DOSSIER_LLD_EN_COURS" && !opp.dossierLld) {
    return reponse.status(400).json({
      erreur:
        "Créez d'abord le dossier LLD : cette étape suppose qu'un dossier de financement existe.",
    });
  }

  await prisma.$transaction(async (tx) => {
    if (etape !== opp.etape) {
      await journaliser(tx, {
        typeObjet: "OPPORTUNITE",
        objetId: opp.id,
        action: "CHANGEMENT_ETAPE",
        ancienneValeur: opp.etape,
        nouvelleValeur: String(etape),
        auteurId: utilisateur.id,
      });
    }
    await tx.opportunite.update({
      where: { id: opp.id },
      data: {
        etape: etape as EtapeCommerciale,
        rang: Number(rang ?? 0),
        entreEnEtapeLe: etape !== opp.etape ? new Date() : opp.entreEnEtapeLe,
      },
    });
  });

  reponse.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Prochaine action
// ---------------------------------------------------------------------------

routes.post("/:id/prochaine-action", async (requete, reponse) => {
  const { le, label } = requete.body ?? {};
  if (!le || !String(label ?? "").trim()) {
    return reponse.status(400).json({ erreur: "Indiquez une action et sa date." });
  }

  const opp = await prisma.opportunite.findUnique({ where: { id: requete.params.id } });
  if (!opp) return reponse.status(404).json({ erreur: "Opportunité introuvable." });

  await prisma.$transaction(async (tx) => {
    await tx.opportunite.update({
      where: { id: opp.id },
      data: {
        prochaineActionLe: new Date(le),
        prochaineActionLabel: String(label).trim(),
      },
    });
    await tx.tache.create({
      data: {
        libelle: String(label).trim(),
        echeance: new Date(le),
        responsableId: opp.commercialId,
        opportuniteId: opp.id,
      },
    });
  });

  reponse.json({ message: "Prochaine action planifiée." });
});

// ---------------------------------------------------------------------------
// Offre envoyée (§8)
// ---------------------------------------------------------------------------

routes.post("/:id/offre-envoyee", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const { montant, dateEnvoi, dateRelancePrevue, lienDevis, reference } =
    requete.body ?? {};

  if (!dateEnvoi || !dateRelancePrevue) {
    return reponse.status(400).json({
      erreur: "La date d'envoi et la date de relance sont obligatoires à cette étape.",
    });
  }

  const opp = await prisma.opportunite.findUnique({ where: { id: requete.params.id } });
  if (!opp) return reponse.status(404).json({ erreur: "Opportunité introuvable." });

  await prisma.$transaction(async (tx) => {
    const rang = await prochainRang(tx, "OFFRE_ENVOYEE");

    await tx.opportunite.update({
      where: { id: opp.id },
      data: {
        etape: "OFFRE_ENVOYEE",
        rang,
        entreEnEtapeLe: new Date(),
        dateOffreEnvoyee: new Date(dateEnvoi),
        dateRelancePrevue: new Date(dateRelancePrevue),
        montantVente: montant != null ? Number(montant) : opp.montantVente,
        prochaineActionLe: new Date(dateRelancePrevue),
        prochaineActionLabel: "Relancer le client sur l'offre",
      },
    });

    const dernier = await tx.devis.findFirst({
      where: { opportuniteId: opp.id },
      orderBy: { version: "desc" },
    });
    const version = (dernier?.version ?? 0) + 1;

    await tx.devis.create({
      data: {
        reference: String(reference ?? "").trim() || `${opp.reference}-D${version}`,
        version,
        montant: montant != null ? Number(montant) : null,
        dateEnvoi: new Date(dateEnvoi),
        lienDocument: String(lienDevis ?? "").trim() || null,
        opportuniteId: opp.id,
      },
    });

    await tx.activite.create({
      data: {
        type: "DEVIS_OFFRE",
        sens: "SORTANT",
        objet: `Offre v${version} transmise`,
        dateReelle: new Date(dateEnvoi),
        resultat: "Offre transmise au client",
        suiteAttendue: `Relance le ${new Date(dateRelancePrevue).toLocaleDateString("fr-FR")}`,
        auteurId: utilisateur.id,
        opportuniteId: opp.id,
      },
    });

    // Relance : une tâche de contrôle, jamais un envoi automatique au client.
    await tx.tache.create({
      data: {
        libelle: "Relancer le client sur l'offre",
        detail: "Vérifier le ton et le canal avant tout envoi.",
        echeance: new Date(dateRelancePrevue),
        responsableId: opp.commercialId,
        opportuniteId: opp.id,
      },
    });

    await journaliser(tx, {
      typeObjet: "OPPORTUNITE",
      objetId: opp.id,
      action: "CHANGEMENT_ETAPE",
      ancienneValeur: opp.etape,
      nouvelleValeur: "OFFRE_ENVOYEE",
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Offre enregistrée et relance planifiée." });
});

// ---------------------------------------------------------------------------
// Création du dossier LLD (§6, §7)
// ---------------------------------------------------------------------------

routes.post("/:id/dossier-lld", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const { dureeDemandeeMois, montantFinance, loyerMensuel, locataire, collaboratriceId } =
    requete.body ?? {};

  const opp = await prisma.opportunite.findUnique({
    where: { id: requete.params.id },
    include: { dossierLld: true, organisation: true },
  });
  if (!opp) return reponse.status(404).json({ erreur: "Opportunité introuvable." });
  if (opp.dossierLld) {
    return reponse
      .status(409)
      .json({ erreur: "Un dossier LLD existe déjà pour cette opportunité." });
  }
  if (!collaboratriceId) {
    return reponse
      .status(400)
      .json({ erreur: "Un dossier LLD doit avoir une collaboratrice responsable." });
  }
  if (!dureeDemandeeMois || Number(dureeDemandeeMois) < 1) {
    return reponse.status(400).json({ erreur: "Indiquez la durée demandée en mois." });
  }

  // Alerte interne : ne bloque jamais la création du dossier.
  const alerte = verifierCompatibilitePartenaire(
    Number(dureeDemandeeMois),
    montantFinance != null ? Number(montantFinance) : null,
  );

  const dossier = await prisma.$transaction(async (tx) => {
    const reference = await genererReference(tx, "LLD");
    const maxLld = await tx.dossierLld.aggregate({
      where: { statut: "LLD_A_ETUDIER" },
      _max: { rang: true },
    });

    const cree = await tx.dossierLld.create({
      data: {
        reference,
        statut: "LLD_A_ETUDIER",
        dureeDemandeeMois: Number(dureeDemandeeMois),
        montantFinance: montantFinance != null ? Number(montantFinance) : null,
        loyerMensuel:
          loyerMensuel != null ? Number(loyerMensuel) : opp.loyerMensuelEnvisage,
        locataire: String(locataire ?? "").trim() || opp.organisation.nom,
        opportuniteId: opp.id,
        collaboratriceId: String(collaboratriceId),
        commercialId: opp.commercialId,
        prochaineActionLe: dansNJours(2),
        prochaineActionLabel: "Valider durée, équipement, locataire et interlocuteurs",
        rang: (maxLld._max.rang ?? -1) + 1,
      },
    });

    // Checklist interne de complétude : elle ne présume pas des pièces exigées
    // par le partenaire, qui restent à confirmer avec GRENKE.
    await tx.checklistItem.createMany({
      data: CHECKLIST_INTERNE.map((libelle, ordre) => ({
        libelle,
        ordre,
        dossierLldId: cree.id,
      })),
    });

    await tx.opportunite.update({
      where: { id: opp.id },
      data: {
        etape: "DOSSIER_LLD_EN_COURS",
        entreEnEtapeLe: new Date(),
        projetRecherche: "LLD",
        dureeLldMois: Number(dureeDemandeeMois),
        rang: await prochainRang(tx, "DOSSIER_LLD_EN_COURS"),
      },
    });

    await tx.tache.create({
      data: {
        libelle: "Préparer le dossier LLD",
        echeance: dansNJours(2),
        responsableId: String(collaboratriceId),
        dossierLldId: cree.id,
      },
    });

    await journaliser(tx, {
      typeObjet: "DOSSIER_LLD",
      objetId: cree.id,
      action: "CREATION_LLD",
      detail: `${cree.reference} créé depuis ${opp.reference}${alerte.aConfirmer ? " — " + alerte.message : ""}`,
      auteurId: utilisateur.id,
    });

    return cree;
  });

  reponse.status(201).json({
    id: dossier.id,
    reference: dossier.reference,
    message: alerte.aConfirmer
      ? `Dossier ${dossier.reference} créé. ${alerte.message}`
      : `Dossier ${dossier.reference} créé.`,
  });
});

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

routes.post("/:id/gagnee", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const { montantRetenu, commentaire } = requete.body ?? {};

  const opp = await prisma.opportunite.findUnique({ where: { id: requete.params.id } });
  if (!opp) return reponse.status(404).json({ erreur: "Opportunité introuvable." });

  await prisma.$transaction(async (tx) => {
    await tx.opportunite.update({
      where: { id: opp.id },
      data: {
        etape: "GAGNE_ACTIF",
        dateCloture: new Date(),
        montantRetenu: montantRetenu != null ? Number(montantRetenu) : null,
        commentaireCloture: String(commentaire ?? "").trim() || null,
        prochaineActionLe: null,
        prochaineActionLabel: null,
        entreEnEtapeLe: new Date(),
        rang: await prochainRang(tx, "GAGNE_ACTIF"),
      },
    });

    // Tâches de démarrage, assistance et suivi client.
    for (const [libelle, jours] of [
      ["Planifier la mise en service", 3],
      ["Transmettre le dossier à l'assistance", 5],
      ["Appel de suivi post-livraison", 30],
    ] as const) {
      await tx.tache.create({
        data: {
          libelle,
          echeance: dansNJours(jours),
          responsableId: opp.commercialId,
          opportuniteId: opp.id,
        },
      });
    }

    await journaliser(tx, {
      typeObjet: "OPPORTUNITE",
      objetId: opp.id,
      action: "CLOTURE",
      nouvelleValeur: "GAGNE_ACTIF",
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Opportunité gagnée ; tâches de démarrage créées." });
});

routes.post("/:id/perdue", async (requete, reponse) => {
  const utilisateur = requete.utilisateur!;
  const { motif, concurrent, commentaire } = requete.body ?? {};

  if (!motif) {
    return reponse.status(400).json({ erreur: "Le motif de clôture est obligatoire." });
  }
  if (motif === "AUTRE" && !String(commentaire ?? "").trim()) {
    return reponse.status(400).json({ erreur: "Le motif « Autre » exige un commentaire." });
  }

  await prisma.$transaction(async (tx) => {
    await tx.opportunite.update({
      where: { id: requete.params.id },
      data: {
        etape: "PERDU_ABANDONNE",
        motifCloture: motif,
        concurrentIdentifie: String(concurrent ?? "").trim() || null,
        commentaireCloture: String(commentaire ?? "").trim() || null,
        dateCloture: new Date(),
        prochaineActionLe: null,
        prochaineActionLabel: null,
        entreEnEtapeLe: new Date(),
        rang: await prochainRang(tx, "PERDU_ABANDONNE"),
      },
    });
    await tx.tache.updateMany({
      where: { opportuniteId: requete.params.id, faite: false },
      data: { faite: true, faiteLe: new Date(), resultat: "Opportunité perdue" },
    });
    await journaliser(tx, {
      typeObjet: "OPPORTUNITE",
      objetId: requete.params.id,
      action: "CLOTURE",
      nouvelleValeur: String(motif),
      motif: String(commentaire ?? "").trim() || null,
      auteurId: utilisateur.id,
    });
  });

  reponse.json({ message: "Opportunité clôturée." });
});

export default routes;
