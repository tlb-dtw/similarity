# SERP Similarity Tool

Outil statique avec fonction serverless Vercel pour clusteriser une liste de mots-clés SEO selon la similarité des SERP Google France.

## Fonctionnement

1. L'utilisateur charge un CSV contenant des mots-clés et volumes.
2. L'utilisateur saisit sa clé API Serper dans l'interface.
3. L'outil récupère les 10 premiers résultats organiques Google FR pour chaque mot-clé.
4. Les mots-clés sont comparés selon les URLs communes dans le top 10.
5. Le consultant fixe le seuil de similarité, avec 40% par défaut.
6. Les clusters sont construits autour du mot-clé non assigné ayant le plus fort volume.
7. Un mot-clé rejoint un cluster uniquement si sa SERP est similaire à celle du mot-clé principal.

Cette logique évite une fusion trop large par transitivité et garde des clusters plus cohérents pour une page SEO.

## Format du CSV

Colonnes détectées automatiquement :

- `keyword`, `mot-clé`, `mot clé`, `query`, `requête`
- `volume`, `search volume`, `vol`, `recherches`

## Sortie

L'export CSV contient :

- Mot-clé principal
- Volume
- Nombre de mots-clés dans le cluster
- Volume cumulé
- Ensemble des mots-clés du cluster, triés par proximité avec le mot-clé principal

## Développement

```bash
vercel dev
```

Puis ouvrir l'URL locale indiquée par Vercel.

## Déploiement Vercel

1. Pousser le projet sur GitHub.
2. Importer le repo dans Vercel.
3. Déployer sans variable d'environnement obligatoire.

La clé Serper est entrée par l'utilisateur dans l'UI et transmise à la route serveur uniquement pendant l'analyse.

Note : les gros fichiers sont traités par lots depuis l'interface afin d'éviter qu'une seule fonction Vercel porte toute l'analyse. Le volume réellement possible dépend surtout des crédits Serper disponibles et des limites du plan Vercel.

## Structure Vercel

- `public/` contient l'interface statique servie par Vercel.
- `api/analyze.js` contient la fonction serverless qui appelle Serper.
- `api/serps.js` récupère les SERP par lots pour les gros fichiers.
