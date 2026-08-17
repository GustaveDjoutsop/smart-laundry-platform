# 🚀 Guide: Pousser les Repositories sur GitHub

> ## ⚠️ DOCUMENT HISTORIQUE — NE PLUS SUIVRE
>
> Ce guide décrit une architecture en **trois dépôts séparés** (`laundry-backend`,
> `laundry-frontend`, `laundry-esp32`) qui **n'existe plus**. Le projet est
> aujourd'hui un monodépôt unique contenant les services Spring Boot
> (`spring-bot-manager-only`, `PaymentManagementService`, `MachineStateService`,
> `reporting-bff`, `api-gateway`) et le tableau de bord Next.js
> (`smart-laundry-dashboard`).
>
> Les chemins cités (`/home/claude/laundry-projects/...`) et les commandes
> `git remote add` ne s'appliquent pas à ce dépôt.
>
> Conservé uniquement comme trace de la structure initiale. Pour l'état réel,
> voir [`CURRENT_ARCHITECTURE.md`](./CURRENT_ARCHITECTURE.md) et
> [`ARCHITECTURE_TODO.md`](./ARCHITECTURE_TODO.md).
>
> **Twilio a été retiré du projet.** La messagerie WhatsApp utilise l'API
> **Meta WhatsApp Cloud**. Voir [`docs/SECRET-ROTATION.md`](./docs/SECRET-ROTATION.md).

## ✅ Repositories Créés Localement

Trois repositories ont été créés et initialisés avec leur structure complète :

1. **laundry-backend** - Backend Node.js + TypeScript
2. **laundry-frontend** - Frontend PWA (HTML/CSS/JS)
3. **laundry-esp32** - Firmware Arduino pour ESP32

---

## 📍 Étapes pour GitHub

### Étape 1: Créer les Repositories sur GitHub

1. **Connectez-vous à GitHub**: https://github.com
2. Cliquez sur **"New repository"** (bouton vert en haut à droite)
3. Créez **3 repositories** avec ces paramètres :

#### Repository 1: Backend
- **Name**: `laundry-backend`
- **Description**: `Backend API for automated laundromat system with 5 payment integrations`
- **Visibility**: Public (ou Private si vous préférez)
- **⚠️ NE PAS** cocher "Add README", "Add .gitignore", ou "Add license"
- Cliquez **"Create repository"**

#### Repository 2: Frontend
- **Name**: `laundry-frontend`
- **Description**: `Progressive Web App for automated laundromat system`
- **Visibility**: Public (ou Private)
- **⚠️ NE PAS** ajouter de fichiers
- Cliquez **"Create repository"**

#### Repository 3: ESP32
- **Name**: `laundry-esp32`
- **Description**: `Arduino firmware for ESP32 IoT controllers`
- **Visibility**: Public (ou Private)
- **⚠️ NE PAS** ajouter de fichiers
- Cliquez **"Create repository"**

---

### Étape 2: Pousser le Code Local vers GitHub

#### Pour laundry-backend:

```bash
cd /home/claude/laundry-projects/laundry-backend
git remote add origin https://github.com/VOTRE_USERNAME/laundry-backend.git
git branch -M main
git push -u origin main
```

#### Pour laundry-frontend:

```bash
cd /home/claude/laundry-projects/laundry-frontend
git remote add origin https://github.com/VOTRE_USERNAME/laundry-frontend.git
git branch -M main
git push -u origin main
```

#### Pour laundry-esp32:

```bash
cd /home/claude/laundry-projects/laundry-esp32
git remote add origin https://github.com/VOTRE_USERNAME/laundry-esp32.git
git branch -M main
git push -u origin main
```

**⚠️ Remplacez `VOTRE_USERNAME` par votre nom d'utilisateur GitHub réel !**

---

### Étape 3: Vérification

Après chaque push, visitez les URLs suivantes pour vérifier :

1. `https://github.com/VOTRE_USERNAME/laundry-backend`
2. `https://github.com/VOTRE_USERNAME/laundry-frontend`
3. `https://github.com/VOTRE_USERNAME/laundry-esp32`

Vous devriez voir :
- ✅ README.md bien formaté
- ✅ Structure de dossiers
- ✅ Fichiers de configuration
- ✅ 1 commit initial

---

## 📋 Contenu de Chaque Repository

### 🔙 laundry-backend

```
laundry-backend/
├── .github/
│   └── workflows/
│       └── ci-cd.yml          # GitHub Actions (CI/CD)
├── src/
│   ├── config/               # Config files
│   ├── controllers/          # Route controllers
│   ├── services/             # Business logic
│   │   ├── payment/          # 5 payment APIs
│   │   ├── mqtt/             # MQTT communication
│   │   └── whatsapp/         # WhatsApp bot
│   ├── models/
│   │   └── prisma/
│   │       └── schema.prisma # Database schema
│   ├── routes/               # API routes
│   ├── middleware/           # Express middleware
│   └── utils/                # Helpers
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example              # Environment variables template
├── .gitignore
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
└── README.md
```

**Technologies:**
- Node.js 20 + TypeScript
- Express.js
- PostgreSQL + Prisma
- Redis
- MQTT (Mosquitto)
- 5 Payment APIs: CamPay, MTN MoMo, Nkwa, Kora, Wave
- WhatsApp (Meta WhatsApp Cloud API — Twilio a été retiré du projet)

---

### 🎨 laundry-frontend

```
laundry-frontend/
├── .github/
│   └── workflows/            # CI/CD workflows
├── public/
│   ├── css/                  # Stylesheets
│   ├── js/                   # JavaScript
│   ├── images/               # Images
│   └── icons/                # PWA icons
├── manifest.json             # PWA manifest
├── service-worker.js         # Offline support
├── .gitignore
└── README.md
```

**Technologies:**
- HTML5 + CSS3
- Vanilla JavaScript (no framework)
- Tailwind CSS
- PWA (Progressive Web App)
- Service Worker

---

### 🔌 laundry-esp32

```
laundry-esp32/
├── laundry_controller/
│   ├── laundry_controller.ino  # Main sketch (à créer)
│   ├── config.h.example        # Config template
│   ├── mqtt_handler.h          # MQTT logic (à créer)
│   └── relay_controller.h      # Relay control (à créer)
├── docs/
│   ├── SETUP.md                # Setup guide (à créer)
│   └── FLASHING.md             # Flashing guide (à créer)
├── wiring_diagrams/            # Wiring diagrams (à ajouter)
├── .gitignore
└── README.md
```

**Technologies:**
- Arduino C++
- ESP32-WROOM-32
- WiFi
- MQTT (PubSubClient)
- GPIO relay control

---

## 🔐 Configuration Secrets

### GitHub Secrets (pour CI/CD)

Après avoir poussé le code, configurez les secrets GitHub :

**Pour laundry-backend** (Settings → Secrets → Actions → New repository secret):

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
CAMPAY_APP_KEY=sk_...
MTN_SUBSCRIPTION_KEY=...
NKWA_API_SECRET=...
KORA_SECRET_KEY=...
WAVE_API_SECRET=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_APP_SECRET=...
```

> Note : `TWILIO_AUTH_TOKEN` figurait ici. Twilio n'est plus utilisé ; les
> identifiants concernés doivent être révoqués côté fournisseur
> (voir [`docs/SECRET-ROTATION.md`](./docs/SECRET-ROTATION.md) §4.1).

---

## ✅ Checklist Post-Push

Après avoir poussé tous les repos :

- [ ] Vérifier que les 3 repos sont visibles sur GitHub
- [ ] README.md bien formatés
- [ ] GitHub Actions workflows présents (.github/workflows/)
- [ ] Mettre à jour les URLs dans les README (remplacer YOUR_USERNAME)
- [ ] Créer des Issues pour les premières tâches
- [ ] Activer GitHub Actions si nécessaire
- [ ] Configurer Branch Protection Rules (main branch)

---

## 🎯 Prochaines Étapes

1. **Créer les Issues GitHub** basées sur Notion Tasks
2. **Générer le code complet** pour chaque repository
3. **Setup CI/CD** avec GitHub Actions
4. **Commencer le développement** en suivant le roadmap 6 semaines

---

## 🆘 En Cas de Problème

### Erreur: Authentication Failed

```bash
# Si vous avez 2FA activé sur GitHub, utilisez un Personal Access Token:
# 1. GitHub → Settings → Developer settings → Personal access tokens
# 2. Generate new token (classic)
# 3. Cochez: repo, workflow, write:packages
# 4. Copiez le token
# 5. Utilisez-le comme mot de passe lors du push
```

### Erreur: Remote Origin Already Exists

```bash
# Supprimer l'ancien remote et ajouter le nouveau
git remote remove origin
git remote add origin https://github.com/USERNAME/REPO.git
```

### Erreur: Branch Main Doesn't Exist

```bash
# Vérifier la branche actuelle
git branch

# Renommer si nécessaire
git branch -M main
```

---

**🎉 Une fois poussé sur GitHub, vous aurez 3 repositories professionnels prêts pour le développement !**
