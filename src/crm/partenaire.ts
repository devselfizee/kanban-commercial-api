/**
 * GRENKE, le partenaire de financement, tel que le CRM le connaît.
 *
 * Dans le CRM, GRENKE est un client (1853) : en location financière, c'est à
 * lui que la borne est facturée — `create_facture_to_client_id` du devis — et
 * le client final le rembourse par ses loyers. Le CRM classe d'ailleurs en
 * « Loc'fi » tout ce qui lui est lié.
 *
 * Deux conséquences pour le kanban :
 *   - GRENKE n'est jamais un prospect : il ne doit être ni importé comme
 *     organisation, ni proposé à la recherche, ni listé avec ses devis ;
 *   - un devis facturé à GRENKE signale une affaire financée en LLD.
 */

const DEFAUT = 1853;

export function idClientGrenke(): number {
  const n = Number(process.env.CRM_CLIENT_GRENKE ?? DEFAUT);
  return Number.isInteger(n) && n > 0 ? n : DEFAUT;
}

export function estGrenke(idCrm: number | string | null | undefined): boolean {
  return idCrm != null && Number(idCrm) === idClientGrenke();
}
