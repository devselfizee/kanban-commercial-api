/**
 * Reprise initiale des clients du CRM, en ligne de commande.
 *
 *   npm run crm:reprise -- --simulation        ce qui serait fait, sans écrire
 *   npm run crm:reprise -- --pages 1           un essai sur la première page
 *   npm run crm:reprise -- --executer          la reprise complète
 *
 * En production, depuis le terminal du conteneur :
 *
 *   node dist/reprise.cjs --simulation
 *   node dist/reprise.cjs --executer
 *
 * L'exécution réelle demande `--executer` explicitement : une reprise lancée
 * par mégarde sur une base qui contient déjà des données n'abîmerait rien
 * — le rapprochement et l'idempotence y veillent — mais autant que
 * l'intention soit dite.
 */

import { repriseClients } from "./reprise";
import { prisma } from "../lib/prisma";

async function principal() {
  const args = process.argv.slice(2);
  const simulation = args.includes("--simulation");
  const executer = args.includes("--executer");
  const iPages = args.indexOf("--pages");
  const pagesMax =
    iPages >= 0 && args[iPages + 1] ? Number(args[iPages + 1]) : undefined;

  const urlCrm = process.env.CRM_URL;

  if (!urlCrm) {
    console.error(
      "CRM_URL n'est pas renseigné. Exemple : CRM_URL=https://crm.exemple.com",
    );
    process.exit(1);
  }

  if (!simulation && !executer) {
    console.error(
      "Précisez --simulation (aucune écriture) ou --executer (reprise réelle).",
    );
    process.exit(1);
  }

  console.log(
    simulation
      ? "→ Simulation : aucune donnée ne sera écrite."
      : "→ Reprise réelle des clients du CRM.",
  );
  console.log(`→ Source : ${urlCrm}`);

  const bilan = await repriseClients({
    urlCrm,
    simulation,
    pagesMax,
    journaliser: (m) => console.log(`  ${m}`),
  });

  console.log("\n─────────────────────────────");
  console.log(`Clients lus : ${bilan.lus}`);
  for (const [resultat, nb] of Object.entries(bilan.parResultat)) {
    console.log(`  ${resultat} : ${nb}`);
  }

  if (bilan.erreurs.length > 0) {
    console.log(`\n${bilan.erreurs.length} erreur(s) :`);
    for (const e of bilan.erreurs.slice(0, 20)) {
      console.log(`  client ${e.id} — ${e.detail}`);
    }
    if (bilan.erreurs.length > 20) {
      console.log(`  … et ${bilan.erreurs.length - 20} autre(s).`);
    }
  }

  if (simulation) {
    console.log("\nAucune écriture. Relancez avec --executer pour appliquer.");
  }

  await prisma.$disconnect();
}

principal().catch(async (e) => {
  console.error("\nReprise interrompue :", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
