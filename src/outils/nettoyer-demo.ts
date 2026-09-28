/**
 * Retire le jeu de démonstration créé par `prisma/seed.ts`.
 *
 *   node dist/nettoyer-demo.cjs              simulation : compte, n'écrit rien
 *   node dist/nettoyer-demo.cjs --executer   supprime
 *
 * Le seed ne marque pas ses données : on ne peut pas « tout effacer », de vraies
 * cartes ont peut-être déjà été saisies. La démonstration est donc désignée
 * explicitement — ses dix organisations et ses cinq comptes — et seulement
 * quand ils n'ont aucun lien CRM. Une vraie organisation homonyme, venue du
 * CRM, n'est jamais touchée.
 *
 * Tout se fait dans une transaction : une étape qui échoue annule l'ensemble.
 * Un compte de démonstration encore référencé par une vraie donnée est
 * désactivé plutôt que supprimé.
 */

import { prisma } from "../lib/prisma";

/** Les organisations créées par `prisma/seed.ts`. */
const ORGANISATIONS_DEMO = [
  "Hôtel Ker Ar Mor",
  "Domaine de la Roseraie",
  "Agence Éclat Events",
  "Camping des Dunes",
  "Mairie de Lorient",
  "Bowling Le Strike",
  "Château de Kerlévenan",
  "Léa Fontaine",
  "Groupe Armor Distribution",
  "IUT de Vannes",
];

/** Les comptes créés par `prisma/seed.ts`. */
const COMPTES_DEMO = [
  "marie.commercial@selfizee.fr",
  "thomas.commercial@selfizee.fr",
  "sophie.lld@selfizee.fr",
  "laurent.manager@selfizee.fr",
  "direction@selfizee.fr",
];

async function principal() {
  const executer = process.argv.includes("--executer");
  console.log(
    executer
      ? "→ Suppression du jeu de démonstration."
      : "→ Simulation : rien ne sera supprimé. Relancer avec --executer pour appliquer.",
  );

  const orgs = await prisma.organisation.findMany({
    where: { nom: { in: ORGANISATIONS_DEMO }, idCrm: null },
    select: { id: true },
  });
  const orgIds = orgs.map((o) => o.id);

  const comptes = await prisma.utilisateur.findMany({
    where: { email: { in: COMPTES_DEMO }, idCrm: null },
    select: { id: true, email: true },
  });
  const compteIds = comptes.map((c) => c.id);

  const leads = await prisma.lead.findMany({
    where: { organisationId: { in: orgIds } },
    select: { id: true },
  });
  const leadIds = leads.map((l) => l.id);

  const opps = await prisma.opportunite.findMany({
    where: {
      OR: [{ organisationId: { in: orgIds } }, { leadId: { in: leadIds } }],
    },
    select: { id: true },
  });
  const oppIds = opps.map((o) => o.id);

  const dossiers = await prisma.dossierLld.findMany({
    where: { opportuniteId: { in: oppIds } },
    select: { id: true },
  });
  const dossierIds = dossiers.map((d) => d.id);

  const contacts = await prisma.contact.findMany({
    where: { organisationId: { in: orgIds } },
    select: { id: true },
  });
  const contactIds = contacts.map((c) => c.id);

  const objets = [...leadIds, ...oppIds, ...dossierIds];
  const supprimes = new Set(objets);
  const surObjetSupprime = (r: {
    leadId: string | null;
    opportuniteId: string | null;
    dossierLldId: string | null;
  }) =>
    [r.leadId, r.opportuniteId, r.dossierLldId].some((id) => id && supprimes.has(id));

  // Un compte de démonstration encore utilisé par une vraie donnée ne peut pas
  // disparaître sans elle : il sera seulement désactivé.
  const encoreUtilises = new Set<string>();
  const references = await Promise.all([
    prisma.organisation.findMany({
      where: { proprietaireId: { in: compteIds }, id: { notIn: orgIds } },
      select: { proprietaireId: true },
    }),
    prisma.lead.findMany({
      where: { proprietaireId: { in: compteIds }, id: { notIn: leadIds } },
      select: { proprietaireId: true },
    }),
    prisma.opportunite.findMany({
      where: { commercialId: { in: compteIds }, id: { notIn: oppIds } },
      select: { commercialId: true },
    }),
    prisma.dossierLld.findMany({
      where: {
        id: { notIn: dossierIds },
        OR: [
          { collaboratriceId: { in: compteIds } },
          { commercialId: { in: compteIds } },
        ],
      },
      select: { collaboratriceId: true, commercialId: true },
    }),
    // Activités et tâches : le tri se fait ici, pas en SQL. Leurs colonnes de
    // rattachement sont souvent vides, et `NULL NOT IN (…)` écarterait la ligne
    // — une activité d'un compte démo sur une vraie carte passerait inaperçue.
    prisma.activite
      .findMany({
        where: { auteurId: { in: compteIds } },
        select: { auteurId: true, leadId: true, opportuniteId: true, dossierLldId: true },
      })
      .then((l) => l.filter((a) => !surObjetSupprime(a)).map((a) => ({ auteurId: a.auteurId }))),
    prisma.tache
      .findMany({
        where: { responsableId: { in: compteIds } },
        select: { responsableId: true, leadId: true, opportuniteId: true, dossierLldId: true },
      })
      .then((l) =>
        l.filter((t) => !surObjetSupprime(t)).map((t) => ({ responsableId: t.responsableId })),
      ),
    prisma.journalEntree.findMany({
      where: { auteurId: { in: compteIds }, objetId: { notIn: objets } },
      select: { auteurId: true },
    }),
  ]);
  for (const liste of references) {
    for (const ligne of liste as Record<string, string | null>[]) {
      for (const v of Object.values(ligne)) {
        if (v && compteIds.includes(v)) encoreUtilises.add(v);
      }
    }
  }
  const aSupprimer = compteIds.filter((id) => !encoreUtilises.has(id));
  const aDesactiver = compteIds.filter((id) => encoreUtilises.has(id));

  console.log("\nJeu de démonstration trouvé :");
  console.log(`  organisations      ${orgIds.length}`);
  console.log(`  contacts           ${contactIds.length}`);
  console.log(`  leads              ${leadIds.length}`);
  console.log(`  opportunités       ${oppIds.length}`);
  console.log(`  dossiers LLD       ${dossierIds.length}`);
  console.log(`  comptes supprimés  ${aSupprimer.length}`);
  if (aDesactiver.length) {
    console.log(
      `  comptes désactivés ${aDesactiver.length} (encore liés à de vraies données)`,
    );
  }
  console.log(
    "  (activités, tâches, checklists, devis et documents suivent leur carte)",
  );

  if (!executer) {
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Journal : il référence les objets par identifiant, sans clé étrangère.
    await tx.journalEntree.deleteMany({ where: { objetId: { in: objets } } });

    // Les cascades emportent checklists, documents, devis, activités, tâches.
    await tx.dossierLld.deleteMany({ where: { id: { in: dossierIds } } });
    await tx.opportunite.deleteMany({ where: { id: { in: oppIds } } });
    await tx.lead.deleteMany({ where: { id: { in: leadIds } } });

    // Une activité d'une vraie carte qui citerait un contact de démonstration
    // perd ce lien plutôt que d'empêcher la suppression.
    await tx.activite.updateMany({
      where: { contactId: { in: contactIds } },
      data: { contactId: null },
    });
    await tx.contact.deleteMany({ where: { id: { in: contactIds } } });

    await tx.organisation.updateMany({
      where: { fusionneeDansId: { in: orgIds } },
      data: { fusionneeDansId: null },
    });
    await tx.organisation.deleteMany({ where: { id: { in: orgIds } } });

    // Les entrées de journal écrites par ces comptes sur des objets supprimés
    // sont parties ci-dessus ; il ne reste que celles des comptes conservés.
    await tx.journalEntree.deleteMany({ where: { auteurId: { in: aSupprimer } } });
    await tx.utilisateur.deleteMany({ where: { id: { in: aSupprimer } } });
    await tx.utilisateur.updateMany({
      where: { id: { in: aDesactiver } },
      data: { actif: false },
    });
  });

  console.log("\n✓ Jeu de démonstration retiré.");
  await prisma.$disconnect();
}

principal().catch(async (e) => {
  console.error("\nNettoyage interrompu, rien n'a été supprimé :", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
