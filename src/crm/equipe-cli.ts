/**
 * Synchronisation de l'équipe avec le CRM, en ligne de commande.
 *
 *   npm run crm:equipe          en développement
 *   node dist/equipe.cjs        dans le conteneur
 *
 * L'API la lance déjà au démarrage et toutes les heures : cette commande sert
 * à la relancer tout de suite, et à lire le détail de ce qui a été ignoré.
 */

import { synchroniserEquipe, resumer, correspondances } from "./equipe";
import { prisma } from "../lib/prisma";

async function principal() {
  const carte = correspondances();
  console.log("→ Profils suivis :");
  for (const [profil, role] of carte) console.log(`  profil ${profil} → ${role}`);

  const bilan = await synchroniserEquipe();
  console.log(`\n${resumer(bilan)}`);
  for (const i of bilan.ignores) {
    console.log(`  utilisateur CRM ${i.idCrm} ignoré : ${i.motif}`);
  }

  await prisma.$disconnect();
  if (bilan.etat !== "ok") process.exit(1);
}

principal().catch(async (e) => {
  console.error("Synchronisation interrompue :", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
