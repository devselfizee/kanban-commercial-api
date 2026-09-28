/**
 * Import des devis GRENKE en dossiers LLD, en ligne de commande.
 *
 *   npm run crm:financements      en développement
 *   node dist/financements.cjs    dans le conteneur
 *
 * L'API le lance déjà au démarrage et tous les quarts d'heure : cette commande
 * sert à le relancer tout de suite, et à lire le détail des erreurs.
 */

import { importerFinancements, resumerFinancements } from "./financements";
import { prisma } from "../lib/prisma";

async function principal() {
  const bilan = await importerFinancements();
  console.log(resumerFinancements(bilan));
  for (const e of bilan.erreurs.slice(0, 30)) {
    console.log(`  devis CRM #${e.idCrm} : ${e.detail}`);
  }
  await prisma.$disconnect();
  if (bilan.etat !== "ok") process.exit(1);
}

principal().catch(async (e) => {
  console.error("Import interrompu :", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
