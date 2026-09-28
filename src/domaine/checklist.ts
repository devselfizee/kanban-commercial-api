/**
 * Checklist interne Selfizee d'un dossier LLD.
 *
 * Elle mesure la complétude du dossier côté Selfizee, sans présumer des pièces
 * exigées par le partenaire, qui restent à confirmer avec GRENKE (§7). Partagée
 * par l'ouverture manuelle d'un dossier et par l'import des devis CRM, pour
 * qu'un dossier ait la même checklist quelle que soit son origine.
 */
export const CHECKLIST_INTERNE = [
  "Identité et coordonnées du locataire vérifiées",
  "Équipement et configuration arrêtés avec le client",
  "Durée et loyer confirmés avec le commercial",
  "Offre commerciale signée ou validée par le client",
  "Interlocuteur signataire identifié",
  "Coordonnées de facturation et de livraison confirmées",
  "Canal de transmission convenu avec le partenaire",
];
