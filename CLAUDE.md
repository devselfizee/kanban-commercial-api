# API du kanban commercial Selfizee

Le document de reprise du projet — les trois dossiers, le lancement, le
déploiement, ce qui vient du CRM, les décisions prises et les points ouverts —
est dans le dépôt de l'interface : `E:\DEV\kanban_commercial\PROJET.md`.
Le lire avant de modifier ce dépôt.

À retenir ici :

- Branche `master` (l'interface est sur `main`). Redéployer l'API avant
  l'interface.
- Vérifier avant de commiter : `npx tsc --noEmit`.
- Une migration s'écrit à partir de `npx prisma migrate diff`, jamais à la
  main : il n'y a pas de base locale pour `prisma migrate dev`.
- Le CRM (`c:\xampp\htdocs\crm-selfizee`) est géré à la main par l'équipe : ne
  rien y commiter ni pousser sans demande explicite.
- Ne jamais lancer le seed sur la base en ligne : il efface tout.
