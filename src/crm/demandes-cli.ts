/**
 * Import des demandes CRM en leads, en ligne de commande.
 *
 *   npm run crm:demandes        en développement
 *   node dist/demandes.cjs      dans le conteneur
 *
 * L'API le lance déjà au démarrage et toutes les 5 minutes : cette commande
 * sert à le relancer tout de suite, et à lire le détail des erreurs.
 */

import { importerDemandes, reinitialiserImport, resumerDemandes } from "./demandes";
import { prisma } from "../lib/prisma";

async function principal() {
  // --reimporter : après une correction de l'import, refait les leads que
  // personne n'a encore touchés. Les leads déjà travaillés sont conservés.
  if (process.argv.includes("--reimporter")) {
    const r = await reinitialiserImport();
    console.log(
      `→ Réimport : ${r.supprimes} lead(s) intact(s) retiré(s), ` +
        `${r.nettoyes} lead(s) déjà travaillé(s) conservé(s).`,
    );
  }

  const bilan = await importerDemandes();
  console.log(resumerDemandes(bilan));
  for (const e of bilan.erreurs.slice(0, 30)) {
    console.log(`  demande CRM #${e.idCrm} : ${e.detail}`);
  }
  if (bilan.erreurs.length > 30) {
    console.log(`  … et ${bilan.erreurs.length - 30} autre(s).`);
  }
  await prisma.$disconnect();
  if (bilan.etat !== "ok") process.exit(1);
}

principal().catch(async (e) => {
  console.error("Import interrompu :", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
