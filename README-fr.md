# Écriture

Écriture est une application de traitement de texte conçue spécifiquement pour les auteurs et les écrivains, intégrant des fonctionnalités d'assistance par intelligence artificielle, de gestion de projet littéraire, et d'outils linguistiques pour vous aider à rédiger votre prochain roman.

Ce projet est la version refaite en Rust (avec Tauri pour le frontend) de l'application originale écrite en Python, offrant ainsi de meilleures performances et une empreinte mémoire réduite.

## Fonctionnalités Principales

- **Gestion de Projet Littéraire :** Créez, chargez et sauvegardez vos projets de romans. Gérez la structure de votre manuscrit (chapitres et scènes), vos personnages, l'intrigue et vos notes.
- **Éditeur de Texte Avancé :** Éditeur avec défilement continu, formatage de texte riche (Gras, Italique, Petites Majuscules), sauts de page visuels, et comptage de mots en temps réel.
- **Assistant IA Intégré :** Aide à la réécriture, développement de texte, changements de point de vue, et génération de descriptions via une IA locale (support des modèles Hugging Face/Transformers).
- **Suivi des Objectifs :** Définissez et suivez vos objectifs quotidiens et globaux d'écriture.
- **Grille d'Intrigue :** Visualisez votre histoire sous forme de timeline ou de grille avec des cartes d'intrigue.
- **Outils Linguistiques :** Recherche de synonymes intégrée (pour le français et l'anglais) et support pour les outils NLP (Natural Language Processing).
- **Exportation et Sauvegarde :** Exportez votre document vers de multiples formats (DOCX, PDF, EPUB, MOBI, ODT, TXT) et gérez vos sauvegardes locales (ZIP).

## Captures d'écran

### Interface Principale (Français)
![Interface Principale (FR)](ecriture-rust/images/screenshot_main_fr.png)

### Mode Verrouillé / Concentration
![Mode Concentration](ecriture-rust/images/screenshot_locked.png)

### Grille d'Intrigue
![Grille d'Intrigue](ecriture-rust/images/screenshot_plot_grid.png)

### Timeline
![Timeline](ecriture-rust/images/screenshot_timeline.png)

## Installation

### Prérequis

1. **Rust & Cargo :** Vous devez avoir Rust installé sur votre système. Vous pouvez l'installer via [rustup](https://rustup.rs/).
2. **Node.js & npm :** Assurez-vous d'avoir Node.js installé. Vous pouvez le télécharger depuis [nodejs.org](https://nodejs.org/).
3. **Prérequis Tauri :** Suivez le guide officiel de Tauri pour installer les dépendances système nécessaires à la compilation (spécifique à Windows, macOS, ou Linux) : [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites).
4. **Chaîne de compilation llama.cpp :** le moteur IA local (`llama-cpp-2`) compile llama.cpp depuis les sources au moment du build via `cmake` + `bindgen`, ce qui nécessite un compilateur C/C++ et `clang` (pour `libclang`, utilisé pour générer les bindings FFI) :
   - Debian/Ubuntu : `sudo apt install build-essential cmake clang libclang-dev`
   - Fedora : `sudo dnf install gcc gcc-c++ cmake clang clang-devel`
   - Arch : `sudo pacman -S base-devel cmake clang`
   - macOS : `xcode-select --install` (donne clang + cmake via Homebrew : `brew install cmake`)

   Si la compilation échoue avec `fatal error: 'stdbool.h' file not found` (ou une erreur similaire de header standard manquant) même après avoir installé `clang`, c'est que le `libclang` utilisé par `bindgen` ne retrouve pas les headers embarqués de cette installation de clang. Indiquez-lui explicitement où les trouver :
   ```bash
   export BINDGEN_EXTRA_CLANG_ARGS="-I$(clang -print-resource-dir)/include"
   npm run tauri dev
   ```
   (ajoutez cette ligne `export` à votre profil de shell pour qu'elle s'applique aussi aux prochains lancements).

### Étapes d'installation

1. **Cloner le dépôt :**
   ```bash
   git clone <votre-url-de-depot>
   cd ecriture
   ```

2. **Se déplacer dans le dossier du projet Rust/Tauri :**
   ```bash
   cd ecriture-rust
   ```

3. **Installer les dépendances Frontend :**
   ```bash
   npm install
   ```

4. **Lancer l'application en mode Développement :**
   Cette commande va démarrer le serveur de développement Vite (frontend) et compiler/exécuter l'application Tauri (backend Rust).
   ```bash
   npm run tauri dev
   ```

5. **Compiler l'application pour la Production :**
   Une fois que vous souhaitez créer un exécutable autonome, utilisez la commande suivante :
   ```bash
   npm run tauri build
   ```
   L'exécutable généré se trouvera dans `ecriture-rust/src-tauri/target/release/`.

## Architecture du Projet

Le projet `ecriture-rust` est construit avec :
- **Frontend :** HTML5, Tailwind CSS, Vanilla TypeScript, packagé avec Vite.
- **Backend :** Rust avec le framework Tauri, offrant la communication (IPC) avec le frontend.

Le modèle de données utilise un format de fichier JSON pour stocker l'intégralité du roman (paramètres, manuscrit, intrigue, personnages, notes).

## État de la migration du backend

Le backend Rust est réparti en deux crates sous `ecriture-rust/` :

- **`ecriture-core`** — la logique métier, indépendante de Tauri, entièrement
  couverte par des tests unitaires et d'intégration : persistance des
  projets et édition de l'arbre du manuscrit, export txt/docx/pdf/odt/epub/mobi,
  recherche de synonymes en français (base `lexique.db` embarquée),
  sauvegardes locales au format JSON, chaînes de traduction, gabarits de
  prompts IA + réponses de secours hors-ligne, et comparaison de versions
  pour la mise à jour.
- **`src-tauri`** — de fines commandes `#[tauri::command]` qui appellent
  `ecriture-core`, exposées au frontend via `window.__TAURI__`.

Lancez `cargo test` dans `ecriture-rust/ecriture-core` pour exécuter la
suite complète de tests de non-régression/qualité/vérification des
fonctionnalités (plus de 60 tests, dont un test de non-régression sur la
vraie base `lexique.db`). Lancez `cargo clippy` dans chaque crate pour les
vérifications de qualité de code.

### IA locale (Gemma)

Les outils IA contextuels (décrire/réécrire/développer/POV/relecture/chat/
extraction de personnages) s'exécutent sur un vrai modèle local via
[`llama-cpp-2`](https://crates.io/crates/llama-cpp-2) (bindings Rust vers
llama.cpp — le même moteur que l'application Python pilotait via
`llama-cpp-python`), avec exactement le même fichier GGUF :
`bartowski/gemma-2-2b-it-GGUF` (`gemma-2-2b-it-Q8_0.gguf`, ~2,7 Go).

- **Dossier de téléchargement** (`ecriture_core::ai::model_store::model_cache_dir`,
  premier candidat inscriptible retenu) : `$ECRITURE_RUST_MODEL_DIR` →
  `$XDG_CACHE_HOME/ecriture-rust` → `~/.cache/ecriture-rust` →
  `<répertoire courant>/ecriture-rust_models` → le dossier temp de l'OS.
  C'est un dossier **séparé** de celui de l'application Python d'origine
  (`~/.cache/ecriture`, qui appartient à `github.com/neomars/ecriture` et
  sert à bien plus qu'au modèle) — les deux applications ne partagent pas
  de fichier modèle, donc attendez-vous à un vrai téléchargement d'environ
  2,7 Go au premier lancement de cette version, même si le modèle de
  l'application Python est déjà installé.
- L'app lance le téléchargement automatiquement dès qu'aucun modèle n'est
  trouvé (reprend le flux « Gemma manquant »), en écrivant d'abord dans un
  fichier `.part` puis en le renommant seulement une fois le transfert
  terminé.
- Le formatage des prompts utilise le gabarit de chat embarqué dans le
  fichier GGUF lui-même (le format `<start_of_turn>`/`<end_of_turn>` propre
  à Gemma, via `LlamaModel::apply_chat_template`) plutôt qu'un gabarit
  écrit à la main.
- Si le modèle n'est pas encore installé, ou qu'une génération échoue pour
  une raison quelconque, chaque commande IA retombe sur le même texte de
  secours « simulé » que l'application Python affiche quand son modèle
  n'est pas installé — jamais une boîte de dialogue d'erreur.

#### Accélération GPU

Le moteur *demande* toujours de décharger toutes les couches sur un GPU
(`n_gpu_layers` est fixé à une valeur élevée sans condition) ; que cela
se produise réellement dépend du backend GPU compilé. **Par défaut,
aucun ne l'est** — `cargo build`/`npm run tauri dev` produisent une
compilation CPU uniquement, volontairement, car chaque backend a besoin
du SDK de son fabricant installé au moment de la *compilation*, et
supposer sa présence risquerait de casser le build comme l'a fait le
prérequis non documenté clang/bindgen (voir plus haut). Activer le
mauvais backend, ou un backend dont le SDK n'est pas installé, fait
échouer la compilation ; vérifiez la sortie terminal de
`npm run tauri dev` après votre première requête IA — elle affiche
`[ai] ggml backend devices` listant chaque périphérique visible par
llama.cpp, GPU ou non — pour confirmer qu'il est bien utilisé.

Vous ne savez pas laquelle (s'il y en a une) s'applique à votre machine ?
Lancez `ecriture-rust/scripts/detect-gpu.sh` — il inspecte le matériel et
les SDK réellement installés sur la machine où il tourne (fabricant du
GPU via `lspci`/`nvidia-smi`, installation de CUDA/ROCm, un pilote Vulkan
fonctionnel, ou aucun GPU du tout) et affiche quelle feature `gpu-*`
utiliser, le cas échéant — le CPU seul reste toujours un choix sûr si
rien de spécifique à un GPU n'est détecté.

Choisissez la fonctionnalité (feature) correspondant à votre GPU et
transmettez-la à la compilation :

| Fabricant | Feature | Nécessite d'abord |
|---|---|---|
| NVIDIA | `gpu-cuda` | [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) |
| AMD | `gpu-rocm` | [ROCm](https://rocm.docs.amd.com/) |
| Apple Silicon / Mac Intel | `gpu-metal` | Outils en ligne de commande Xcode (`xcode-select --install`) |
| N'importe quel fabricant (NVIDIA/AMD/Intel) via Vulkan | `gpu-vulkan` | Le loader Vulkan + un compilateur GLSL→SPIR-V — voir ci-dessous |

```bash
# depuis ecriture-rust/src-tauri
cargo build --features gpu-cuda      # ou gpu-rocm / gpu-metal / gpu-vulkan
# ou, pour aussi lancer l'app desktop avec :
cargo tauri dev --features gpu-cuda
```

`gpu-vulkan` est l'option la plus proche d'un choix universel : sur une
machine dont le fabricant n'a pas de feature `gpu-*` dédiée ci-dessus (ou
si vous ne savez pas quel GPU est installé), c'est celle à essayer en
premier, puisqu'elle pilote le GPU via le pilote Vulkan du fabricant
plutôt qu'un kit de développement propre à chacun. Elle n'est pas exposée
par `llama-cpp-2` lui-même (seul `llama-cpp-sys-2`, une couche en
dessous, l'expose), donc `ecriture-core/Cargo.toml` dépend directement de
`llama-cpp-sys-2` uniquement pour atteindre ce marqueur — grâce à
l'unification des features de Cargo, il s'agit toujours exactement du
même crate sous-jacent que celui déjà utilisé par `llama-cpp-2`, pas
d'une deuxième copie. Elle nécessite, uniquement au moment de la
compilation :
- Debian/Ubuntu : `sudo apt install libvulkan-dev glslc` (ou
  `libshaderc-dev`, qui fournit le même compilateur de shaders `glslc`
  sous un autre nom de paquet sur certaines distributions)
- Fedora : `sudo dnf install vulkan-loader-devel shaderc`
- Arch : `sudo pacman -S vulkan-icd-loader shaderc`
- macOS : non pris en charge (utilisez plutôt `gpu-metal`) — Vulkan sur
  les plateformes Apple passerait par la couche de traduction MoltenVK,
  ce qui n'est pas ce que cible ici le backend Vulkan de llama.cpp.
- Windows : nécessite en plus le [Vulkan SDK](https://vulkan.lunarg.com/)
  installé et la variable `VULKAN_SDK` définie (le script de build de
  llama-cpp-sys-2 ne la vérifie que sur cette plateforme).

À l'*exécution*, Vulkan n'a besoin que du pilote GPU habituel de la
machine (celui déjà présent pour n'importe quelle application 3D) — pas
de kit de développement séparé à installer sur la machine qui fait
tourner l'app, contrairement à CUDA/ROCm.

Les GPU Intel n'ont pas de feature dédiée ici (le backend SYCL de
llama.cpp ne fait pas partie des fonctionnalités exposées par les
bindings), mais un GPU Intel discret ou intégré exposant un pilote
Vulkan (typiquement sous Linux via le pilote `ANV` de Mesa) reste
accessible via `gpu-vulkan`.

**Non vérifié de bout en bout dans l'environnement où ce code a été
écrit** : la politique réseau de ce bac à sable bloque `huggingface.co`,
donc le vrai téléchargement de plusieurs Go et une vraie génération n'ont
pas pu y être exécutés. La logique de téléchargement elle-même est testée
unitairement contre un serveur HTTP local (cas de succès, erreur HTTP, et
connexion refusée), et la séquence d'appels bas niveau à llama.cpp a été
écrite en suivant l'exemple officiel `examples/simple` de `llama-cpp-2`.
Merci de vérifier le premier vrai téléchargement et quelques requêtes IA
sur votre machine et de signaler tout comportement inattendu.

**Autres limites connues par rapport à l'application Python d'origine**
(suivies comme travail futur, jamais simulées silencieusement) :
- La recherche de synonymes ne dispose de vraies données qu'en français.
  L'application Python utilisait en plus NLTK WordNet + spaCy pour
  l'anglais, l'espagnol et le russe ; il n'existe pas d'équivalent pur Rust,
  donc ces langues renvoient une liste vide plutôt que de simuler un résultat.
- Les intégrations natives nécessitant des plugins Tauri supplémentaires
  (sélecteur de dossier pour les sauvegardes, import de documents
  `.docx`/`.odt`/`.epub`, téléchargement de mise à jour) ne sont pas encore
  branchées.

> *Note : Pour la version anglaise de ce README, veuillez consulter [README.md](README.md).*
