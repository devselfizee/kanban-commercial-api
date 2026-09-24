/**
 * Données de démonstration.
 *
 * L'objectif est de rendre les trois tableaux immédiatement lisibles : des cartes
 * dans chaque colonne, des cas qui déclenchent les alertes (prise en charge en
 * retard, carte sans suivi planifié, durée LLD hors plage publiée) et un dossier
 * qui traverse tout le parcours.
 *
 * Les anciens clients sont importés avec le canal « Migration historique » afin de
 * ne pas fausser les mesures d'acquisition (§14).
 */

import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

const prisma = new PrismaClient();

function ilYaNJours(n: number, heure = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(heure, 0, 0, 0);
  return d;
}

function dansNJours(n: number, heure = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(heure, 0, 0, 0);
  return d;
}

const ANNEE = new Date().getFullYear();
let compteurs: Record<string, number> = { L: 0, OPP: 0, LLD: 0, ORG: 0 };

function ref(prefixe: "L" | "OPP" | "LLD" | "ORG"): string {
  compteurs[prefixe] += 1;
  return `${prefixe}-${ANNEE}-${String(compteurs[prefixe]).padStart(5, "0")}`;
}

async function main() {
  console.log("→ Nettoyage…");
  // Ordre imposé par les clés étrangères.
  await prisma.journalEntree.deleteMany();
  await prisma.tache.deleteMany();
  await prisma.activite.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.document.deleteMany();
  await prisma.devis.deleteMany();
  await prisma.dossierLld.deleteMany();
  await prisma.opportunite.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.organisation.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.compteurReference.deleteMany();

  console.log("→ Équipe…");
  const [marie, thomas, sophie, laurent] = await Promise.all([
    prisma.utilisateur.create({
      data: {
        email: "marie.commercial@selfizee.fr",
        prenom: "Marie",
        nom: "Lefèvre",
        role: "COMMERCIAL",
      },
    }),
    prisma.utilisateur.create({
      data: {
        email: "thomas.commercial@selfizee.fr",
        prenom: "Thomas",
        nom: "Guérin",
        role: "COMMERCIAL",
      },
    }),
    prisma.utilisateur.create({
      data: {
        email: "sophie.lld@selfizee.fr",
        prenom: "Sophie",
        nom: "Renaud",
        role: "COLLABORATRICE_LLD",
      },
    }),
    prisma.utilisateur.create({
      data: {
        email: "laurent.manager@selfizee.fr",
        prenom: "Laurent",
        nom: "Morvan",
        role: "MANAGER",
      },
    }),
  ]);
  await prisma.utilisateur.create({
    data: {
      email: "direction@selfizee.fr",
      prenom: "Claire",
      nom: "Bernard",
      role: "DIRECTION",
    },
  });

  console.log("→ Organisations et contacts…");

  type DefOrg = {
    nom: string;
    segment: Prisma.OrganisationCreateInput["segment"];
    ville: string;
    contact: { nom: string; prenom: string; role: string; email: string; tel: string };
    particulier?: boolean;
  };

  const defsOrg: DefOrg[] = [
    {
      nom: "Hôtel Ker Ar Mor",
      segment: "HOTEL_CAMPING",
      ville: "Vannes",
      contact: {
        nom: "Le Gall",
        prenom: "Anne",
        role: "Directrice",
        email: "a.legall@kerarmor.fr",
        tel: "0297123456",
      },
    },
    {
      nom: "Domaine de la Roseraie",
      segment: "LIEU_DE_RECEPTION",
      ville: "Nantes",
      contact: {
        nom: "Pichon",
        prenom: "Julien",
        role: "Responsable évènements",
        email: "j.pichon@roseraie.fr",
        tel: "0240889977",
      },
    },
    {
      nom: "Agence Éclat Events",
      segment: "AGENCE_EVENEMENTIELLE",
      ville: "Rennes",
      contact: {
        nom: "Moreau",
        prenom: "Sarah",
        role: "Directrice de production",
        email: "s.moreau@eclat-events.fr",
        tel: "0299334455",
      },
    },
    {
      nom: "Camping des Dunes",
      segment: "HOTEL_CAMPING",
      ville: "Quiberon",
      contact: {
        nom: "Tanguy",
        prenom: "Pierre",
        role: "Gérant",
        email: "contact@campingdesdunes.fr",
        tel: "0297501122",
      },
    },
    {
      nom: "Mairie de Lorient",
      segment: "COLLECTIVITE_ASSOCIATION",
      ville: "Lorient",
      contact: {
        nom: "Rivière",
        prenom: "Nathalie",
        role: "Chargée de la vie associative",
        email: "n.riviere@lorient.bzh",
        tel: "0297020304",
      },
    },
    {
      nom: "Bowling Le Strike",
      segment: "ANIMATION_LOISIRS",
      ville: "Brest",
      contact: {
        nom: "Kervella",
        prenom: "Yann",
        role: "Exploitant",
        email: "y.kervella@lestrike.fr",
        tel: "0298445566",
      },
    },
    {
      nom: "Château de Kerlévenan",
      segment: "LIEU_DE_RECEPTION",
      ville: "Sarzeau",
      contact: {
        nom: "Duval",
        prenom: "Hélène",
        role: "Propriétaire",
        email: "contact@kerlevenan.fr",
        tel: "0297267788",
      },
    },
    {
      nom: "Léa Fontaine",
      segment: "PARTICULIER",
      ville: "Auray",
      particulier: true,
      contact: {
        nom: "Fontaine",
        prenom: "Léa",
        role: "Mariée",
        email: "lea.fontaine@gmail.com",
        tel: "0612345678",
      },
    },
    {
      nom: "Groupe Armor Distribution",
      segment: "COMMERCE",
      ville: "Saint-Brieuc",
      contact: {
        nom: "Colin",
        prenom: "Marc",
        role: "Directeur marketing",
        email: "m.colin@armordis.fr",
        tel: "0296112233",
      },
    },
    {
      nom: "IUT de Vannes",
      segment: "ETABLISSEMENT_ENSEIGNEMENT",
      ville: "Vannes",
      contact: {
        nom: "Bertin",
        prenom: "Olivier",
        role: "Responsable communication",
        email: "o.bertin@iut-vannes.fr",
        tel: "0297998877",
      },
    },
  ];

  const orgs = [];
  for (const d of defsOrg) {
    const org = await prisma.organisation.create({
      data: {
        reference: ref("ORG"),
        nom: d.nom,
        segment: d.segment,
        estParticulier: d.particulier ?? false,
        ville: d.ville,
        email: d.contact.email,
        telephone: `+33${d.contact.tel.slice(1)}`,
        proprietaireId: marie.id,
        contacts: {
          create: {
            nom: d.contact.nom,
            prenom: d.contact.prenom,
            role: d.contact.role,
            email: d.contact.email,
            telephone: `+33${d.contact.tel.slice(1)}`,
            estDecideurEconomique: true,
          },
        },
      },
      include: { contacts: true },
    });
    orgs.push(org);
  }

  console.log("→ Leads…");

  type DefLead = {
    org: number;
    mode: Prisma.LeadCreateInput["modeAcquisition"];
    canal: Prisma.LeadCreateInput["canalDetaille"];
    statut: Prisma.LeadCreateInput["statut"];
    priorite: Prisma.LeadCreateInput["priorite"];
    projet: Prisma.LeadCreateInput["projetRecherche"];
    besoin: string;
    proprietaire?: string;
    creeIlYa: number;
    premierContactIlYa?: number;
    prochaineActionDans?: number;
    prochaineActionLabel?: string;
    reactivationDans?: number;
    motif?: Prisma.LeadCreateInput["motifCloture"];
  };

  const defsLead: DefLead[] = [
    // Entrant non attribué, créé il y a 2 jours : prise en charge en retard.
    {
      org: 3,
      mode: "ENTRANT",
      canal: "FORMULAIRE_SITE",
      statut: "NOUVEAU_NON_ATTRIBUE",
      priorite: "P1_REPONSE_IMMEDIATE",
      projet: "A_PRECISER",
      besoin: "Borne photo pour animation du camping en juillet",
      creeIlYa: 2,
      prochaineActionDans: 0,
      prochaineActionLabel: "Rappeler la demande du site",
    },
    {
      org: 4,
      mode: "ENTRANT",
      canal: "APPEL_ENTRANT",
      statut: "A_PRENDRE_EN_CHARGE",
      priorite: "P2_A_TRAITER_AUJOURDHUI",
      projet: "ACHAT_OU_LLD_A_CONSEILLER",
      besoin: "Équiper la salle des fêtes pour les évènements municipaux",
      creeIlYa: 1,
      prochaineActionDans: 1,
      prochaineActionLabel: "Qualifier le besoin et le budget",
    },
    {
      org: 5,
      mode: "ENTRANT",
      canal: "SALON",
      statut: "PREMIER_CONTACT_A_REALISER",
      priorite: "P2_A_TRAITER_AUJOURDHUI",
      projet: "LLD",
      besoin: "Borne permanente dans l'espace d'accueil du bowling",
      proprietaire: "marie",
      creeIlYa: 4,
      prochaineActionDans: 1,
      prochaineActionLabel: "Relance post-salon",
    },
    {
      org: 6,
      mode: "PROSPECTION",
      canal: "APPEL_SORTANT",
      statut: "CONTACT_EN_COURS",
      priorite: "P3_SUIVI_PLANIFIE",
      projet: "A_PRECISER",
      besoin: "Prestation photo pour les mariages du château",
      proprietaire: "thomas",
      creeIlYa: 12,
      premierContactIlYa: 9,
      prochaineActionDans: 2,
      prochaineActionLabel: "3e tentative d'appel",
    },
    {
      org: 7,
      mode: "ENTRANT",
      canal: "DEMANDE_DEVIS",
      statut: "CONTACT_ETABLI_A_QUALIFIER",
      priorite: "P2_A_TRAITER_AUJOURDHUI",
      projet: "LOCATION_COURTE_DUREE",
      besoin: "Location d'une borne pour un mariage en août",
      proprietaire: "marie",
      creeIlYa: 6,
      premierContactIlYa: 5,
      prochaineActionDans: 1,
      prochaineActionLabel: "Envoyer la grille tarifaire location",
    },
    // Carte sans prochaine action : doit apparaître en rouge.
    {
      org: 8,
      mode: "PROSPECTION",
      canal: "LINKEDIN",
      statut: "CONTACT_EN_COURS",
      priorite: "P3_SUIVI_PLANIFIE",
      projet: "ACHAT",
      besoin: "Animation des opérations commerciales en magasin",
      proprietaire: "thomas",
      creeIlYa: 18,
      premierContactIlYa: 14,
    },
    {
      org: 9,
      mode: "REACTIVATION",
      canal: "ANCIEN_DEVIS",
      statut: "NURTURING_A_REACTIVER",
      priorite: "P4_NURTURING",
      projet: "ACHAT_OU_LLD_A_CONSEILLER",
      besoin: "Projet reporté à la prochaine rentrée universitaire",
      proprietaire: "marie",
      creeIlYa: 40,
      premierContactIlYa: 35,
      reactivationDans: 120,
    },
    {
      org: 2,
      mode: "ENTRANT",
      canal: "RECOMMANDATION_CLIENT",
      statut: "NON_QUALIFIE_CLOTURE",
      priorite: "P4_NURTURING",
      projet: "A_PRECISER",
      besoin: "Demande hors périmètre : sonorisation uniquement",
      proprietaire: "thomas",
      creeIlYa: 25,
      premierContactIlYa: 24,
      motif: "MAUVAIS_SEGMENT",
    },
  ];

  const parNom: Record<string, string> = {
    marie: marie.id,
    thomas: thomas.id,
  };

  for (const d of defsLead) {
    const org = orgs[d.org];
    const proprietaireId = d.proprietaire ? parNom[d.proprietaire] : null;
    const creeLe = ilYaNJours(d.creeIlYa);

    const lead = await prisma.lead.create({
      data: {
        reference: ref("L"),
        modeAcquisition: d.mode,
        canalDetaille: d.canal,
        statut: d.statut,
        priorite: d.priorite,
        segment: org.segment,
        projetRecherche: d.projet,
        besoinResume: d.besoin,
        ville: org.ville,
        organisationId: org.id,
        contactPrincipalId: org.contacts[0].id,
        proprietaireId,
        dateAttribution: proprietaireId ? creeLe : null,
        premierContactLe:
          d.premierContactIlYa != null ? ilYaNJours(d.premierContactIlYa) : null,
        prochaineActionLe:
          d.prochaineActionDans != null ? dansNJours(d.prochaineActionDans) : null,
        prochaineActionLabel: d.prochaineActionLabel ?? null,
        dateReactivation:
          d.reactivationDans != null ? dansNJours(d.reactivationDans) : null,
        motifCloture: d.motif ?? null,
        dateCloture: d.motif ? ilYaNJours(d.creeIlYa - 20) : null,
        creeLe,
        entreEnEtapeLe: ilYaNJours(Math.max(0, d.creeIlYa - 2)),
      },
    });

    await prisma.journalEntree.create({
      data: {
        typeObjet: "LEAD",
        objetId: lead.id,
        action: "CREATION",
        detail: `${lead.reference} créé`,
        auteurId: proprietaireId ?? laurent.id,
        creeLe,
      },
    });

    if (d.premierContactIlYa != null) {
      await prisma.activite.create({
        data: {
          type: d.mode === "ENTRANT" ? "APPEL_ENTRANT" : "APPEL_SORTANT",
          sens: d.mode === "ENTRANT" ? "ENTRANT" : "SORTANT",
          objet: "Premier échange téléphonique",
          contenu: d.besoin,
          dateReelle: ilYaNJours(d.premierContactIlYa),
          resultat: "Interlocuteur joint",
          suiteAttendue: d.prochaineActionLabel ?? null,
          sansSuite: d.prochaineActionLabel == null,
          auteurId: proprietaireId,
          leadId: lead.id,
          contactId: org.contacts[0].id,
        },
      });
    }

    if (d.prochaineActionDans != null && d.prochaineActionLabel) {
      await prisma.tache.create({
        data: {
          libelle: d.prochaineActionLabel,
          echeance: dansNJours(d.prochaineActionDans),
          responsableId: proprietaireId,
          leadId: lead.id,
        },
      });
    }
  }

  console.log("→ Opportunités…");

  type DefOpp = {
    org: number;
    titre: string;
    etape: Prisma.OpportuniteCreateInput["etape"];
    projet: Prisma.OpportuniteCreateInput["projetRecherche"];
    solution: string;
    bornes: number;
    montant?: number;
    loyer?: number;
    duree?: number;
    commercial: string;
    dansEtapeDepuis: number;
    prochaineActionDans?: number;
    prochaineActionLabel?: string;
    evenementDans?: number;
  };

  const defsOpp: DefOpp[] = [
    {
      org: 0,
      titre: "Borne photo permanente — accueil",
      etape: "DECOUVERTE_SOLUTION",
      projet: "ACHAT_OU_LLD_A_CONSEILLER",
      solution: "Borne Selfizee Compact avec habillage personnalisé",
      bornes: 1,
      montant: 6900,
      commercial: "marie",
      dansEtapeDepuis: 5,
      prochaineActionDans: 2,
      prochaineActionLabel: "Visio de présentation de la configuration",
    },
    {
      org: 1,
      titre: "Deux bornes pour salle de réception",
      etape: "OFFRE_ENVOYEE",
      projet: "ACHAT",
      solution: "2 bornes Selfizee Studio + impression illimitée",
      bornes: 2,
      montant: 14200,
      commercial: "marie",
      dansEtapeDepuis: 8,
      prochaineActionDans: -2, // relance en retard
      prochaineActionLabel: "Relancer le client sur l'offre",
      evenementDans: 60,
    },
    {
      org: 2,
      titre: "Parc de 4 bornes en LLD",
      etape: "DOSSIER_LLD_EN_COURS",
      projet: "LLD",
      solution: "4 bornes Selfizee Studio, maintenance incluse",
      bornes: 4,
      loyer: 890,
      duree: 36,
      commercial: "thomas",
      dansEtapeDepuis: 10,
      prochaineActionDans: 4,
      prochaineActionLabel: "Point hebdomadaire avec le client",
    },
    {
      org: 6,
      titre: "Borne mariage — location saison",
      etape: "NEGOCIATION_VALIDATION_CLIENT",
      projet: "LOCATION_COURTE_DUREE",
      solution: "Location 4 week-ends sur la saison estivale",
      bornes: 1,
      montant: 3400,
      commercial: "thomas",
      dansEtapeDepuis: 3,
      prochaineActionDans: 1,
      prochaineActionLabel: "Valider le calendrier des dates",
      evenementDans: 45,
    },
    {
      org: 9,
      titre: "Borne pour évènements étudiants",
      etape: "QUALIFICATION_VALIDEE",
      projet: "A_PRECISER",
      solution: "À définir après découverte",
      bornes: 1,
      commercial: "marie",
      dansEtapeDepuis: 1,
      prochaineActionDans: 3,
      prochaineActionLabel: "Rendez-vous de découverte",
    },
    {
      org: 5,
      titre: "Borne permanente bowling — LLD courte",
      etape: "OFFRE_A_CONSTRUIRE",
      projet: "LLD",
      solution: "1 borne Compact, LLD courte durée",
      bornes: 1,
      loyer: 210,
      duree: 9, // hors plage publiée : déclenche l'alerte de compatibilité
      commercial: "marie",
      dansEtapeDepuis: 2,
      prochaineActionDans: 2,
      prochaineActionLabel: "Construire les variantes achat / LLD",
    },
    {
      org: 8,
      titre: "Animation magasins — 3 bornes",
      etape: "GAGNE_ACTIF",
      projet: "ACHAT",
      solution: "3 bornes Selfizee Compact",
      bornes: 3,
      montant: 18600,
      commercial: "thomas",
      dansEtapeDepuis: 15,
    },
  ];

  const opps = [];
  for (const d of defsOpp) {
    const org = orgs[d.org];
    const commercialId = parNom[d.commercial];

    const opp = await prisma.opportunite.create({
      data: {
        reference: ref("OPP"),
        titre: d.titre,
        etape: d.etape,
        priorite: d.prochaineActionDans != null && d.prochaineActionDans < 0
          ? "P1_REPONSE_IMMEDIATE"
          : "P3_SUIVI_PLANIFIE",
        projetRecherche: d.projet,
        solutionEnvisagee: d.solution,
        quantiteBornes: d.bornes,
        montantVente: d.montant ?? null,
        loyerMensuelEnvisage: d.loyer ?? null,
        dureeLldMois: d.duree ?? null,
        dateCible: dansNJours(d.evenementDans ?? 40),
        dateEvenement: d.evenementDans != null ? dansNJours(d.evenementDans) : null,
        organisationId: org.id,
        contactPrincipalId: org.contacts[0].id,
        commercialId,
        prochaineActionLe:
          d.prochaineActionDans != null ? dansNJours(d.prochaineActionDans) : null,
        prochaineActionLabel: d.prochaineActionLabel ?? null,
        dateOffreEnvoyee: d.etape === "OFFRE_ENVOYEE" ? ilYaNJours(8) : null,
        dateRelancePrevue:
          d.etape === "OFFRE_ENVOYEE" ? dansNJours(-2) : null,
        dateCloture: d.etape === "GAGNE_ACTIF" ? ilYaNJours(15) : null,
        montantRetenu: d.etape === "GAGNE_ACTIF" ? d.montant : null,
        entreEnEtapeLe: ilYaNJours(d.dansEtapeDepuis),
        creeLe: ilYaNJours(d.dansEtapeDepuis + 10),
      },
    });
    opps.push(opp);

    await prisma.journalEntree.create({
      data: {
        typeObjet: "OPPORTUNITE",
        objetId: opp.id,
        action: "CREATION",
        detail: `${opp.reference} créée`,
        auteurId: commercialId,
        creeLe: ilYaNJours(d.dansEtapeDepuis + 10),
      },
    });

    await prisma.activite.create({
      data: {
        type: "REUNION",
        sens: "SORTANT",
        objet: "Échange de découverte",
        contenu: d.solution,
        dateReelle: ilYaNJours(d.dansEtapeDepuis + 2),
        resultat: "Besoin confirmé",
        suiteAttendue: d.prochaineActionLabel ?? "Clôture",
        sansSuite: d.prochaineActionLabel == null,
        auteurId: commercialId,
        opportuniteId: opp.id,
      },
    });

    if (d.etape === "OFFRE_ENVOYEE") {
      await prisma.devis.create({
        data: {
          reference: `${opp.reference}-D1`,
          version: 1,
          montant: d.montant ?? null,
          dateEnvoi: ilYaNJours(8),
          dateValidite: dansNJours(22),
          opportuniteId: opp.id,
        },
      });
    }

    if (d.prochaineActionDans != null && d.prochaineActionLabel) {
      await prisma.tache.create({
        data: {
          libelle: d.prochaineActionLabel,
          echeance: dansNJours(d.prochaineActionDans),
          responsableId: commercialId,
          opportuniteId: opp.id,
        },
      });
    }
  }

  console.log("→ Dossiers LLD…");

  const checklist = [
    "Identité et coordonnées du locataire vérifiées",
    "Équipement et configuration arrêtés avec le client",
    "Durée et loyer confirmés avec le commercial",
    "Offre commerciale signée ou validée par le client",
    "Interlocuteur signataire identifié",
    "Coordonnées de facturation et de livraison confirmées",
    "Canal de transmission convenu avec le partenaire",
  ];

  type DefLld = {
    opp: number;
    statut: Prisma.DossierLldCreateInput["statut"];
    duree: number;
    montant: number;
    loyer: number;
    faits: number;
    dansEtapeDepuis: number;
    transmisIlYa?: number;
    retourIlYa?: number;
    signatureIlYa?: number;
    livraisonIlYa?: number;
    prochaineActionDans?: number;
    prochaineActionLabel?: string;
    elementAttendu?: string;
  };

  const defsLld: DefLld[] = [
    {
      opp: 2, // parc de 4 bornes, 36 mois
      statut: "TRANSMIS_A_GRENKE",
      duree: 36,
      montant: 28400,
      loyer: 890,
      faits: 7,
      dansEtapeDepuis: 3,
      transmisIlYa: 3,
      prochaineActionDans: 2,
      prochaineActionLabel: "Relance factuelle si aucun accusé reçu",
    },
    {
      opp: 5, // bowling, 9 mois : hors plage publiée
      statut: "DOSSIER_A_PREPARER",
      duree: 9,
      montant: 1800,
      loyer: 210,
      faits: 3,
      dansEtapeDepuis: 2,
      prochaineActionDans: 3,
      prochaineActionLabel: "Compléter la checklist interne",
    },
  ];

  for (const d of defsLld) {
    const opp = opps[d.opp];
    const dossier = await prisma.dossierLld.create({
      data: {
        reference: ref("LLD"),
        statut: d.statut,
        dureeDemandeeMois: d.duree,
        montantFinance: d.montant,
        loyerMensuel: d.loyer,
        opportuniteId: opp.id,
        collaboratriceId: sophie.id,
        commercialId: opp.commercialId,
        dateTransmission: d.transmisIlYa != null ? ilYaNJours(d.transmisIlYa) : null,
        canalTransmission: d.transmisIlYa != null ? "Portail partenaire" : null,
        auteurTransmission: d.transmisIlYa != null ? "Sophie Renaud" : null,
        preuveTransmission:
          d.transmisIlYa != null ? "Accusé portail n° 2026-0451" : null,
        prochaineRelanceLe:
          d.prochaineActionDans != null ? dansNJours(d.prochaineActionDans) : null,
        prochaineActionLe:
          d.prochaineActionDans != null ? dansNJours(d.prochaineActionDans) : null,
        prochaineActionLabel: d.prochaineActionLabel ?? null,
        elementAttenduLabel: d.elementAttendu ?? null,
        entreEnEtapeLe: ilYaNJours(d.dansEtapeDepuis),
        creeLe: ilYaNJours(d.dansEtapeDepuis + 5),
        checklist: {
          create: checklist.map((libelle, ordre) => ({
            libelle,
            ordre,
            fait: ordre < d.faits,
            faitLe: ordre < d.faits ? ilYaNJours(d.dansEtapeDepuis + 1) : null,
            faitPar: ordre < d.faits ? "Sophie Renaud" : null,
          })),
        },
      },
    });

    await prisma.journalEntree.create({
      data: {
        typeObjet: "DOSSIER_LLD",
        objetId: dossier.id,
        action: "CREATION_LLD",
        detail: `${dossier.reference} créé depuis ${opp.reference}`,
        auteurId: sophie.id,
        creeLe: ilYaNJours(d.dansEtapeDepuis + 5),
      },
    });

    if (d.transmisIlYa != null) {
      await prisma.activite.create({
        data: {
          type: "ACTIVITE_LLD",
          sens: "SORTANT",
          objet: "Demande transmise au partenaire",
          contenu: "Canal : portail partenaire — preuve : accusé n° 2026-0451",
          dateReelle: ilYaNJours(d.transmisIlYa),
          resultat: "Demande envoyée",
          suiteAttendue: `Contrôle le ${dansNJours(d.prochaineActionDans ?? 2).toLocaleDateString("fr-FR")}`,
          auteurId: sophie.id,
          dossierLldId: dossier.id,
        },
      });
      await prisma.journalEntree.create({
        data: {
          typeObjet: "DOSSIER_LLD",
          objetId: dossier.id,
          action: "TRANSMISSION_LLD",
          detail: "Transmis via le portail partenaire",
          nouvelleValeur: "Accusé portail n° 2026-0451",
          auteurId: sophie.id,
          creeLe: ilYaNJours(d.transmisIlYa),
        },
      });
    }

    if (d.prochaineActionDans != null && d.prochaineActionLabel) {
      await prisma.tache.create({
        data: {
          libelle: d.prochaineActionLabel,
          echeance: dansNJours(d.prochaineActionDans),
          responsableId: sophie.id,
          dossierLldId: dossier.id,
        },
      });
    }
  }

  console.log("→ Compteurs de références…");
  for (const [prefixe, valeur] of Object.entries(compteurs)) {
    await prisma.compteurReference.create({
      data: { prefixe, annee: ANNEE, valeur },
    });
  }

  console.log("\n✓ Jeu de démonstration créé.");
  console.log("  Connectez-vous comme Marie (commerciale), Sophie (LLD) ou Laurent (manager).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
