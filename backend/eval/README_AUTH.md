# Authentification de l'éval

`run_eval.py` appelle le backend déployé, dont le middleware valide le JWT via
`sb.auth.get_user()`. Il faut donc un vrai token d'accès Supabase — et ceux-ci
vivent une heure.

Trois voies, par ordre de robustesse.

---

## 1. Identité dédiée — recommandé, à faire une fois

Un compte propre à l'éval, indépendant de ta session navigateur. C'est
l'équivalent d'un compte de service pour une CI.

### Pourquoi pas simplement ton propre compte

Un refresh token partage sa **chaîne de rotation** avec la session qui l'a émis.
Supabase les fait tourner par famille : dès que l'onglet de l'app se rafraîchit —
ce qu'il fait tout seul, à l'heure ou au rechargement de page — le token stocké
côté éval est invalidé, avec `refresh_token_already_used`. Constaté le
27/08/2026 : l'éval a cessé de pouvoir s'authentifier entre deux lancements sans
que rien n'ait changé de son côté.

Le grant `password` ouvre une session neuve à chaque lancement, sans chaîne
partagée. Rien à renouveler.

### Étape 1 — créer le compte

Dans le dashboard Supabase, *Authentication > Users > Add user*, avec
**Auto Confirm User** activé (sinon la connexion échouera sur un email non
vérifié) :

```
email    : eval@smart-bees.fr
password : (généré, long, à conserver dans le fichier de l'étape 3)
```

### Étape 2 — donner accès au client de test

Le chat vérifie l'appartenance via `_assert_role(user_id, client_id, ["owner", "member"])` :
sans cette ligne, chaque cas renverra `403`.

```sql
-- Récupérer l'UUID du compte tout juste créé
SELECT id, email FROM auth.users WHERE email = 'eval@smart-bees.fr';

-- Lui donner le rôle member sur le client du testset (aroma-zone)
INSERT INTO client_members (client_id, member_id, role)
VALUES (
  'f2144b65-487e-43c7-9e51-59db11559ac6',
  '<UUID_DU_COMPTE_EVAL>',
  'member'                      -- `member` suffit : l'éval ne fait que lire
)
ON CONFLICT (client_id, member_id) DO NOTHING;
```

`member` et non `owner` : l'éval n'a besoin que de lire. Un compte qui ne peut
pas supprimer le client est un compte dont la fuite coûte moins cher.

⚠️ Si le testset gagne un jour des cas sur d'autres clients, il faudra une ligne
par client — sinon ces cas échoueront en `403` et non sur leur contenu.

### Étape 3 — poser les identifiants

Deux lignes, email puis mot de passe :

```bash
printf 'eval@smart-bees.fr\nLE_MOT_DE_PASSE\n' > backend/eval/.eval_credentials
chmod 600 backend/eval/.eval_credentials
```

Le fichier est dans `.gitignore`. Les variables `EVAL_EMAIL` / `EVAL_PASSWORD`
sont acceptées à la place, pour une CI.

### Étape 4 — lancer

```bash
cd backend
export BACKEND_URL='https://clientchat-v2-167005458056.europe-west9.run.app'
python eval/run_eval.py --judge
```

Plus rien à renouveler.

---

## 2. Refresh token de ta propre session — dépannage

```bash
# Navigateur, connecté à l'app :
#   DevTools > Application > Local Storage > sb-<ref>-auth-token, champ refresh_token
echo 'LE_REFRESH_TOKEN' > backend/eval/.eval_refresh_token
```

Fonctionne, mais **fragile** pour la raison expliquée plus haut : le premier
rafraîchissement de ton navigateur l'invalide. Le script réécrit le token roté
dans le fichier à chaque usage, ce qui repousse le problème sans le supprimer.

---

## 3. Token d'accès ponctuel — une heure

```bash
export EVAL_JWT="..."   # DevTools > Network > en-tête Authorization, sans 'Bearer '
```

Prioritaire sur les deux autres voies. Pratique pour un essai isolé ; à éviter
pour une passe complète, qui prend une quinzaine de minutes avec `--judge` et
peut expirer en route.

---

## Révocation

L'identité d'éval se désactive sans toucher à ta propre session :

```sql
DELETE FROM client_members
WHERE  member_id = '<UUID_DU_COMPTE_EVAL>';
```

Puis suppression du compte dans *Authentication > Users*. C'est le principal
intérêt d'une identité séparée : elle se coupe seule.
