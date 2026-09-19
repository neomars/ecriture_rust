
window.showConfirm = function(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        const msgEl = document.getElementById('custom-confirm-message');
        const btnCancel = document.getElementById('custom-confirm-cancel');
        const btnOk = document.getElementById('custom-confirm-ok');

        msgEl.textContent = message;
        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            btnCancel.removeEventListener('click', onCancel);
            btnOk.removeEventListener('click', onOk);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const onOk = () => {
            cleanup();
            resolve(true);
        };

        btnCancel.addEventListener('click', onCancel);
        btnOk.addEventListener('click', onOk);
    });
};

        // Textarea caret position locator utility
        const properties = [
            'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
            'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
            'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
            'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize'
        ];
        const isFirefox = (typeof window !== 'undefined' && window.mozInnerScreenX != null);

        function getCaretCoordinates(element, position) {
            const div = document.createElement('div');
            div.id = 'input-textarea-caret-position-mirror-div';
            document.body.appendChild(div);

            const style = div.style;
            const computed = window.getComputedStyle(element);

            style.whiteSpace = 'pre-wrap';
            style.wordWrap = 'break-word';
            style.position = 'absolute';
            style.visibility = 'hidden';

            properties.forEach(prop => {
                style[prop] = computed[prop];
            });

            if (isFirefox) {
                if (element.scrollHeight > parseInt(computed.height)) {
                    style.overflowY = 'scroll';
                }
            } else {
                style.overflow = 'hidden';
            }

            div.textContent = element.value.substring(0, position);

            const span = document.createElement('span');
            span.textContent = element.value.substring(position) || '.';
            div.appendChild(span);

            const coordinates = {
                top: span.offsetTop + parseInt(computed['borderTopWidth']),
                left: span.offsetLeft + parseInt(computed['borderLeftWidth']),
                height: parseInt(computed['lineHeight'])
            };

            document.body.removeChild(div);
            return coordinates;
        }

        // Core application data state
        let projectData = null;
        let translations = {};
        window.activeLang = "fr";
        let isSavingDisabled = false;

        let activeNodeId = null;     // ID of current active workspace item (scene/chap/char/note)
        let activeNodeType = null;   // "scene", "chapter", "character", "note", or "plot_grid"
        let activePlotSubView = "grid"; // Sub-view for plotting: "grid" or "timeline"

        // Auto-save debounce timer
        let autoSaveTimer = null;

        // Drag and drop state for chapters
        let draggedChapId = null;

        // Drag and drop state for scenes
        let draggedSceneId = null;
        let draggedSceneParentChapId = null;

        // Pomodoro Focus Timer variables
        let timerDurationMinutes = 15;
        let timerSecondsLeft = 15 * 60;
        let timerIntervalId = null;
        let timerIsRunning = false;

        // Scroll Sync Logic
        function setupScrollSync() {
            const scrollContainer = document.getElementById('editor-scroll-container');
            if (!scrollContainer) return;

            let scrollTimeout;
            scrollContainer.addEventListener('scroll', () => {
                if (scrollTimeout) clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    if (activeNodeType !== 'scene' && activeNodeType !== 'chapter') return;

                    const scenes = document.querySelectorAll('.editor-scene-contenteditable');
                    let visibleScene = null;
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const triggerPoint = containerRect.top + (containerRect.height / 3);

                    for (let i = 0; i < scenes.length; i++) {
                        const rect = scenes[i].getBoundingClientRect();
                        if (rect.top <= triggerPoint && rect.bottom >= triggerPoint) {
                            visibleScene = scenes[i];
                            break;
                        }
                    }

                    if (visibleScene) {
                        const sceneId = visibleScene.getAttribute('data-scene-id');
                        if (activeNodeId !== sceneId) {
                            activeNodeId = sceneId;
                            activeNodeType = 'scene';

                            // Optimized sidebar tree highlight update without full re-render
                            const prevActive = document.querySelector('.cursor-pointer.bg-indigo-100');
                            if (prevActive) {
                                prevActive.classList.remove('bg-indigo-100', 'text-indigo-900', 'font-semibold');
                                prevActive.classList.add('text-slate-700', 'hover:bg-slate-100');
                            }
                            // Find new active item in sidebar tree using onclick attribute
                            const allNodes = document.querySelectorAll('.cursor-pointer');
                            for(let node of allNodes) {
                                if (node.getAttribute('onclick') && node.getAttribute('onclick').includes(`'${sceneId}'`)) {
                                    node.classList.add('bg-indigo-100', 'text-indigo-900', 'font-semibold');
                                    node.classList.remove('text-slate-700', 'hover:bg-slate-100');
                                    break;
                                }
                            }
                        }
                    }
                }, 100);
            });
        }

        // Initialize application
        window.addEventListener('DOMContentLoaded', async () => {
            setupScrollSync();
            // Close resource quick menu if clicked outside
            document.addEventListener('click', (e) => {
                const dropdown = document.getElementById('asset-menu-dropdown');
                if (dropdown && !e.target.closest('.relative')) {
                    dropdown.classList.add('hidden');
                }
                const exportMenu = document.getElementById('export-dropdown-menu');
                if (exportMenu && !e.target.closest('#export-dropdown-wrapper')) {
                    exportMenu.classList.add('hidden');
                }

                const rewriteMenu = document.getElementById('ai-rewrite-dropdown-menu');
                if (rewriteMenu && !e.target.closest('#ai-rewrite-dropdown-wrapper')) {
                    rewriteMenu.classList.add('hidden');
                }

                const synonymsMenu = document.getElementById('synonyms-dropdown-menu');
                if (synonymsMenu && !e.target.closest('#synonyms-dropdown-wrapper')) {
                    synonymsMenu.classList.add('hidden');
                }

                // Hide selection menu if clicked outside selection and selection menu
                // Close modals when clicking outside
                if (e.target.classList.contains('fixed') && e.target.classList.contains('inset-0') && (e.target.classList.contains('z-50') || e.target.classList.contains('z-[9999]'))) {
                    if (e.target.id === 'chapter-type-modal' && e.target.hasAttribute('data-uncancelable')) {
                        // Do not close it
                        return;
                    }
                    e.target.classList.add('hidden');
                }
            });

            // Listen for text selection inside the editor using delegation to survive dynamic editor recreations
            document.addEventListener('mouseup', function(e) {
                const editor = document.getElementById('editor-content');
                if (editor && editor.contains(e.target)) {
                    handleTextSelection(e);
                }
            });
            document.addEventListener('keyup', function(e) {
                const editor = document.getElementById('editor-content');
                if (editor && editor.contains(e.target)) {
                    handleTextSelection(e);
                }
            });



            await loadProjectsList();
            await loadProject();
            await checkGemmaStatus();
            await window.checkUpdatesOnStartup();
            initDonationTimer();
        });

        // Check Gemma Status on Startup

        // Check Donation on an interval
        let usageTimeInterval = null;
        function initDonationTimer() {
            // Track total usage time in milliseconds across sessions
            // If total usage time exceeds 5 hours (18000000 ms), show modal
            usageTimeInterval = setInterval(() => {
                if (projectData && projectData.settings && projectData.settings.disable_ads) return;

                let usageTime = parseInt(localStorage.getItem('usage-time-ms') || '0', 10);
                usageTime += 60000; // add 1 minute

                if (usageTime >= 5 * 60 * 60 * 1000) {
                    const modal = document.getElementById('donation-modal');
                    if (modal && modal.classList.contains('hidden')) {
                        modal.classList.remove('hidden');
                        // Reset timer after showing
                        usageTime = 0;
                    }
                }
                localStorage.setItem('usage-time-ms', usageTime.toString());
            }, 60000); // Check every minute
        }

        // Expose function to disable ads from donation modal
        window.disableAdsFromModal = function() {
            if (projectData && projectData.settings) {
                projectData.settings.disable_ads = true;
                persistProject();
            }
            window.closeDonationModal();
        };

        window.closeDonationModal = function() {
            const modal = document.getElementById('donation-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        };

        // Checks whether the local Gemma engine is installed
        // (ai_status/ai_install_engine/ai_install_status are real Tauri
        // commands backed by ecriture_core::ai::{model_store,download} -
        // see that module's docs for how the model is fetched and where
        // it's cached on disk). If it's missing, show the informational
        // modal and kick off the download automatically, matching the
        // original app's behavior.
        async function checkGemmaStatus() {
            try {
                const data = await window.api_invoke('ai_status');
                console.log("ai_status:", data);
                if (!data.installed) {
                    showGemmaMissingModal();
                    installGemmaModel();
                }
            } catch (err) {
                console.error("Error checking Gemma status:", err);
            }
        }

        function showGemmaMissingModal() {
            const modal = document.getElementById('gemma-missing-modal');
            if (modal) {
                modal.classList.remove('hidden');
            }
        }

        function closeGemmaInstalledModal() {
            const modal = document.getElementById('gemma-installed-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        }
        window.closeGemmaInstalledModal = closeGemmaInstalledModal;

        let installPollInterval = null;

        window.installGemmaModel = async function() {
            const progressDiv = document.getElementById('gemma-install-progress-container');
            if (progressDiv) progressDiv.classList.remove('hidden');

            try {
                const started = await window.api_invoke('ai_install_engine');
                console.log("ai_install_engine:", started);
                if (installPollInterval) clearInterval(installPollInterval);
                installPollInterval = setInterval(pollInstallStatus, 1000);
                pollInstallStatus(); // don't wait a full second for the first update
            } catch (e) {
                console.error("Error starting Gemma installation:", e);
                const statusText = document.getElementById('gemma-install-status-text');
                if (statusText) statusText.innerText = "Erreur lors du démarrage du téléchargement.";
            }
        }

        async function pollInstallStatus() {
            try {
                const data = await window.api_invoke('ai_install_status');
                console.log("ai_install_status:", data);

                const statusText = document.getElementById('gemma-install-status-text');
                const progressBar = document.getElementById('gemma-install-progress-bar');
                if (!statusText || !progressBar) return;

                if (data.status === 'error') {
                    clearInterval(installPollInterval);
                    console.error("Gemma download failed:", data.message);
                    statusText.innerText = data.message || 'Erreur lors de l\'installation.';
                    progressBar.classList.replace('bg-indigo-600', 'bg-red-600');
                    // Left visible on purpose (no auto-hide): the message is
                    // the only place the actual failure reason shows up.
                } else if (data.status === 'done') {
                    clearInterval(installPollInterval);
                    statusText.innerText = 'Terminé !';
                    progressBar.style.width = '100%';
                    progressBar.classList.replace('bg-indigo-600', 'bg-green-600');
                    setTimeout(() => {
                        const modal = document.getElementById('gemma-missing-modal');
                        if (modal) modal.classList.add('hidden');
                    }, 1500);
                } else {
                    let etaStr = '';
                    if (data.eta_secs !== undefined && data.eta_secs !== null) {
                        const mins = Math.floor(data.eta_secs / 60);
                        const secs = Math.floor(data.eta_secs % 60);
                        etaStr = mins > 0
                            ? ` - Environ ${mins} min ${secs} sec restantes`
                            : ` - Environ ${secs} sec restantes`;
                    }
                    statusText.innerText = `${data.message || 'Téléchargement en cours...'} (${data.progress}%)${etaStr}`;
                    progressBar.style.width = data.progress + '%';
                }
            } catch (e) {
                console.error("Error polling install status:", e);
            }
        }

        function resetInstallModal() {
            if (installPollInterval) clearInterval(installPollInterval);

            const progressDiv = document.getElementById('gemma-install-progress-container');
            const progressBar = document.getElementById('gemma-install-progress-bar');
            if (progressDiv) progressDiv.classList.add('hidden');

            if(progressBar) {
                progressBar.style.width = '0%';
                progressBar.classList.remove('bg-red-600', 'bg-green-600');
                progressBar.classList.add('bg-indigo-600');
            }
        }


        async function loadProjectsList() {
            try {
                const projects = await window.api_invoke('get_project_list');

                const select = document.getElementById('project-select');
                select.innerHTML = "";

                projects.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.filename;
                    opt.innerText = p.title;
                    select.appendChild(opt);
                });

                // Get active project filename
                const activeData = await window.api_invoke("get_active_project");
                select.value = activeData.active_filename;
            } catch (err) {
                console.error("Error loading projects list:", err);
            }
        }

        // SWITCH CURRENT ACTIVE NOVEL
        async function switchProject(filename) {
            try {
                // Save current project state first
                if (projectData) {
                    await persistProject();
                    projectData = null;
                    if (autoSaveTimer) clearTimeout(autoSaveTimer);
                }

                let switchOk = true;
                try {
                    await window.api_invoke('load_project', { filename });
                } catch (e) {
                    switchOk = false;
                }

                if (switchOk) {
                    activeNodeId = null;
                    activeNodeType = null;
                    await loadProjectsList();
                    await loadProject();
                }
            } catch (err) {
                console.error("Failed to switch project:", err);
            }
        }

        // OPEN / CLOSE NEW PROJECT MODAL
        window.openNewProjectModal = function openNewProjectModal() {
            document.getElementById('new-project-title-input').value = "";
            document.getElementById('new-project-modal').classList.remove('hidden');
        }

        window.closeNewProjectModal = function closeNewProjectModal() {
            document.getElementById('new-project-modal').classList.add('hidden');
        }

        // CREATE NEW NOVEL PROJECT
        window.createNewProject = async function createNewProject() {
            const title = document.getElementById('new-project-title-input').value.trim();
            if (!title) {
                alert("Please enter a title.");
                return;
            }

            try {
                // Save current first
                if (projectData) {
                    await persistProject();
                    projectData = null;
                    if (autoSaveTimer) clearTimeout(autoSaveTimer);
                }

                let createOk = true;
                try {
                    await window.api_invoke('create_project', { title });
                } catch (e) {
                    createOk = false;
                }

                if (createOk) {
                    closeNewProjectModal();
                    activeNodeId = null;
                    activeNodeType = null;
                    await loadProjectsList();
                    await loadProject();

                    // The user wants to directly be in the menu to create a chapter
                    // without the possibility of canceling it.
                    openChapterTypeModal();

                    // To prevent cancellation, we can hide the close/cancel buttons in the chapter-type-modal
                    const chapterTypeModal = document.getElementById('chapter-type-modal');
                    if (chapterTypeModal) {
                         chapterTypeModal.setAttribute('data-uncancelable', 'true');
                         const closeBtns = chapterTypeModal.querySelectorAll('button[onclick="closeChapterTypeModal()"]');
                         closeBtns.forEach(btn => btn.style.display = 'none');
                    }
                }
            } catch (err) {
                console.error("Failed to create new project:", err);
            }
        }

        // ENFORCE LOCK STATE IN FRONTEND
        function applyLockState() {
            const isLocked = !!(projectData && projectData.settings && projectData.settings.locked);

            // Disable editing inputs
            const editorTitle = document.getElementById('editor-title');
            if (editorTitle) editorTitle.disabled = isLocked;

            const editorContent = document.getElementById('editor-content');
            if (editorContent) {
                editorContent.disabled = isLocked;
                if (isLocked) {
                    editorContent.classList.add('bg-slate-50/30', 'cursor-not-allowed');
                    editorContent.setAttribute('placeholder', translations["locked_warning"] || "Ce roman est verrouillé.");
                } else {
                    editorContent.classList.remove('bg-slate-50/30', 'cursor-not-allowed');
                    editorContent.setAttribute('placeholder', translations["editor_placeholder"] || "Commencez à rédiger votre chef-d'œuvre ici...");
                }
            }

            const resourceTitle = document.getElementById('resource-title');
            if (resourceTitle) resourceTitle.disabled = isLocked;

            const charRole = document.getElementById('char-role');
            if (charRole) charRole.disabled = isLocked;

            const charDesc = document.getElementById('char-desc');
            if (charDesc) charDesc.disabled = isLocked;

            const noteType = document.getElementById('note-type');
            if (noteType) noteType.disabled = isLocked;

            const noteContent = document.getElementById('note-content');
            if (noteContent) noteContent.disabled = isLocked;

            const dailyGoalInput = document.getElementById('daily-goal-input');
            if (dailyGoalInput) dailyGoalInput.disabled = isLocked;

            // Hide or disable sidebar additions
            const addChapterBtn = document.querySelector('[onclick="addNewChapter()"]');
            if (addChapterBtn) addChapterBtn.style.display = isLocked ? 'none' : 'block';

            const addSceneBtn = document.querySelector('[onclick="addNewScene()"]');
            if (addSceneBtn) addSceneBtn.style.display = isLocked ? 'none' : 'block';

            const showAssetMenuBtn = document.querySelector('[onclick="showAssetMenu(); event.stopPropagation();"]');
            if (showAssetMenuBtn) {
                const parentDiv = showAssetMenuBtn.parentElement;
                if (parentDiv) parentDiv.style.display = isLocked ? 'none' : 'block';
            }

            // Adjust quick actions footer visibility
            const quickActionsFooter = document.querySelector('.grid-cols-3');
            if (quickActionsFooter) {
                if (isLocked) {
                    quickActionsFooter.classList.add('hidden');
                } else {
                    quickActionsFooter.classList.remove('hidden');
                }
            }
        }

        // APPLY USER-DEFINED LAYOUT AND TYPOGRAPHY SETTINGS TO THE EDITOR
        function applyEditorLayoutSettings() {
            if (!projectData || !projectData.settings) return;
            if (!projectData.settings.editor_layout) {
                // Set defaults: Georgia 12pt, 1.6 spacing, left alignment
                projectData.settings.editor_layout = {
                    font_family: "Georgia, serif",
                    font_size: "12pt",
                    line_spacing: "1.6",
                    text_align: "left"
                };
            }

            const layout = projectData.settings.editor_layout;
            const editor = document.getElementById('editor-content');
            if (editor) {
                editor.style.fontFamily = layout.font_family || "Georgia, serif";
                editor.style.fontSize = layout.font_size || "12pt";
                editor.style.lineHeight = layout.line_spacing || "1.6";
                editor.style.textAlign = layout.text_align || "left";

                // Also adjust paragraph separation spacing inside textarea
                editor.style.paddingAfter = "6px";
            }
        }

        // LOAD ACTIVE PROJECT FROM BACKEND JSON
        async function loadProject() {
            try {
                projectData = await window.api_invoke('get_active_project');

                // Normalize all characters to ensure backward compatibility
                if (projectData && projectData.characters) {
                    projectData.characters.forEach(c => ensureCharacterFields(c));
                }

                // Read language preference, fallback to localStorage, then English
                let storedLang = localStorage.getItem('app-lang');
                window.activeLang = storedLang || projectData.settings.lang || "en";
                projectData.settings.lang = activeLang;
                document.getElementById('lang-select').value = activeLang;

                // Load appropriate language translation file
                await loadLocale(activeLang);

                // Build navigation pane
                renderTree();

                // Apply layout configuration to the text canvas
                applyEditorLayoutSettings();

                // Update settings modals and right sidebar progress goals
                updateRightSidebar();

                // Load first scene into editor if none selected
                if (!activeNodeId) {
                    loadFirstAvailableScene();
                } else {
                    refreshActiveWorkspace();
                }

                // Apply locking restrictions frontend
                applyLockState();

                // Check and run automated backup on launch if due
                runAutoBackup();

            } catch (err) {
                console.error("Error loading project state:", err);
            }
        }

        // FETCH EXTERNAL LOCALIZATION
        async function loadLocale(lang) {
            try {
                translations = await window.api_invoke('get_locale', { lang });
                window.activeLang = lang;
                translateDOM();
            } catch (err) {
                console.error("Could not load locale:", err);
            }
        }

        // TRANSLATE DOM ELEMENTS USING TRANSLATIONS MAP
        function translateDOM() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (translations[key]) {
                    el.innerHTML = translations[key];
                }
            });

            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                if (translations[key]) {
                    el.setAttribute('placeholder', translations[key]);
                }
            });

            document.querySelectorAll('[data-i18n-title]').forEach(el => {
                const key = el.getAttribute('data-i18n-title');
                if (translations[key]) {
                    el.setAttribute('title', translations[key]);
                }
            });

            if (typeof updateChatWelcomeMessage === "function") {
                updateChatWelcomeMessage();
            }
        }

        // HELPER: Format strings with curly braces (e.g., "Written: {written} / {goal}")
        function formatTranslation(key, params = {}) {
            let val = translations[key] || "";
            for (const [k, v] of Object.entries(params)) {
                val = val.replace(`{${k}}`, v);
            }
            return val;
        }


        // SAVE STATE BACK TO JSON FILE
        async function persistProject() {
            if (!projectData || isSavingDisabled) return; // Prevent ghost saves if project is being unloaded
            try {
                projectData = await window.api_invoke('update_project', { data: projectData });
                updateRightSidebar();
                // Silently trigger auto-backup check
                runAutoBackup();
            } catch (err) {
                console.error("Failed to save project data:", err);
            }
        }

        async function runAutoBackup() {
            if (!projectData || !projectData.settings || !projectData.settings.backup_config) return;
            const config = projectData.settings.backup_config;
            const path = config.folder_path;
            const freq = config.frequency || 'daily';
            if (!path || !path.trim()) return;

            if (!config.last_backup_timestamps) {
                config.last_backup_timestamps = {};
            }

            const now = new Date();
            const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

            const oneJan = new Date(now.getFullYear(), 0, 1);
            const numberOfDays = Math.floor((now - oneJan) / (24 * 60 * 60 * 1000));
            const weekStr = `${now.getFullYear()}-W${Math.ceil((numberOfDays + oneJan.getDay() + 1) / 7)}`;

            const monthStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;

            let shouldBackup = false;
            if (freq === 'daily') {
                if (config.last_backup_timestamps.daily !== todayStr) {
                    shouldBackup = true;
                    config.last_backup_timestamps.daily = todayStr;
                }
            } else if (freq === 'weekly') {
                if (config.last_backup_timestamps.weekly !== weekStr) {
                    shouldBackup = true;
                    config.last_backup_timestamps.weekly = weekStr;
                }
            } else if (freq === 'monthly') {
                if (config.last_backup_timestamps.monthly !== monthStr) {
                    shouldBackup = true;
                    config.last_backup_timestamps.monthly = monthStr;
                }
            }

            if (shouldBackup) {
                try {
                    await window.api_invoke('backup_create', { folderPath: path, frequency: freq });
                    // Save timestamps state back to project
                    await window.api_invoke("update_project", {data: projectData});
                } catch (e) {
                    console.error("Failed to run automated backup:", e);
                }
            }
        }

        // DEBOUNCED AUTOMATED SAVING
        function triggerAutoSave() {
            if (isSavingDisabled) return;
            if (autoSaveTimer) clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(() => {
                persistProject();
            }, 800); // 800ms quiet period before saving
        }

        // DYNAMIC TREE VIEW RENDER
        function renderTree(filterText = "") {
            const searchVal = filterText.toLowerCase().trim();
            const isLocked = !!(projectData && projectData.settings && projectData.settings.locked);

            // Project title in Left Sidebar
            const lockIndicator = isLocked ? " 🔒" : "";
            document.getElementById('project-title-display').innerText = ((projectData && projectData.settings && projectData.settings.title) || "") + lockIndicator;

            // 1. Render Manuscript (Chapters & Scenes)
            const msList = document.getElementById('manuscript-nodes-list');
            msList.innerHTML = "";

            if (projectData && projectData.manuscript) {
                projectData.manuscript.forEach(chap => {
                    const chapTitle = chap.title || "";
                    const matchesChap = chapTitle.toLowerCase().includes(searchVal);

                    // Gather matching scenes
                    const childrenList = chap.children || [];
                    const matchingScenes = childrenList.filter(scene => {
                        const sceneTitle = scene.title || "";
                        const sceneContent = scene.content || "";
                        return sceneTitle.toLowerCase().includes(searchVal) ||
                               sceneContent.toLowerCase().includes(searchVal);
                    });

                    if (searchVal && !matchesChap && matchingScenes.length === 0) {
                        return; // Skip since it doesn't match query
                    }

                    // Create Chapter node element
                    const chapEl = document.createElement('div');
                    chapEl.className = "group transition-all duration-150 border-t-2 border-b-2 border-transparent";
                    if (!isLocked) {
                        chapEl.draggable = true;
                        chapEl.setAttribute('data-chap-id', chap.id);
                        chapEl.addEventListener('dragstart', handleChapDragStart);
                        chapEl.addEventListener('dragover', handleChapDragOver);
                        chapEl.addEventListener('dragleave', handleChapDragLeave);
                        chapEl.addEventListener('drop', handleChapDrop);
                        chapEl.addEventListener('dragend', handleChapDragEnd);
                    }

                    const isChapActive = (activeNodeId === chap.id);
                    const chapButtons = isLocked ? "" : `
                        <div class="opacity-0 group-hover:opacity-100 flex items-center space-x-1 shrink-0">
                            <button onclick="event.stopPropagation(); renameItem('${chap.id}', 'chapter')" class="hover:text-indigo-600 p-0.5 text-xs">✏️</button>
                            <button onclick="event.stopPropagation(); deleteItem('${chap.id}', 'chapter')" class="hover:text-red-600 p-0.5 text-xs">🗑️</button>
                        </div>
                    `;

                    chapEl.innerHTML = `
                        <div class="flex items-center justify-between px-2 py-1 rounded-lg text-sm font-semibold ${isChapActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-200/50'} cursor-pointer select-none">
                            <div class="flex items-center space-x-1.5 flex-1 min-w-0" onclick="selectChapter('${chap.id}')">
                                <span>📁</span>
                                <span class="truncate">${chapTitle}</span>
                            </div>
                            ${chapButtons}
                        </div>
                        <div class="pl-4 mt-0.5 space-y-0.5">
                            ${(searchVal ? matchingScenes : childrenList).map(scene => {
                                const isSceneActive = (activeNodeId === scene.id);
                                const sceneTitle = scene.title || "";
                                const sceneButtons = isLocked ? "" : `
                                        <div class="opacity-0 group-hover/scene:opacity-100 flex items-center space-x-1 shrink-0">
                                            <button onclick="event.stopPropagation(); renameItem('${scene.id}', 'scene')" class="hover:text-indigo-600 p-0.5">✏️</button>
                                            <button onclick="event.stopPropagation(); deleteItem('${scene.id}', 'scene')" class="hover:text-red-600 p-0.5">🗑️</button>
                                        </div>
                                `;
                                return `
                                    <div class="group/scene flex items-center justify-between px-2 py-1 rounded-lg text-xs font-medium ${isSceneActive ? 'bg-indigo-100 text-indigo-800 font-bold' : 'text-slate-500 hover:bg-slate-200/50'} cursor-pointer border-t-2 border-b-2 border-transparent transition-all duration-150"
                                         ${isLocked ? "" : `
                                            draggable="true"
                                            data-scene-id="${scene.id}"
                                            data-parent-chap-id="${chap.id}"
                                            ondragstart="handleSceneDragStart(event)"
                                            ondragover="handleSceneDragOver(event)"
                                            ondragleave="handleSceneDragLeave(event)"
                                            ondrop="handleSceneDrop(event)"
                                            ondragend="handleSceneDragEnd(event)"
                                         `}>
                                        <div class="flex items-center space-x-1.5 flex-1 min-w-0" onclick="selectScene('${scene.id}')">
                                            <span>📄</span>
                                            <span class="truncate">${sceneTitle}</span>
                                        </div>
                                        ${sceneButtons}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `;
                    msList.appendChild(chapEl);
                });
            }

            // Highlight active state on Plot Grid menu button
            const plotGridBtn = document.getElementById('plot-grid-menu-item');
            if (activeNodeType === "plot_grid") {
                plotGridBtn.className = "flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-bold bg-indigo-50 text-indigo-700 cursor-pointer transition-all";
            } else {
                plotGridBtn.className = "flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900 cursor-pointer transition-all";
            }

            // 2. Render Characters
            const charList = document.getElementById('characters-list');
            charList.innerHTML = "";
            if (projectData && projectData.characters) {
                projectData.characters.forEach(char => {
                    const charName = char.name || "";
                    const charRole = char.role || "";
                    if (searchVal && !charName.toLowerCase().includes(searchVal) && !charRole.toLowerCase().includes(searchVal)) {
                        return;
                    }
                    const isCharActive = (activeNodeId === char.id);
                    const charEl = document.createElement('div');
                    charEl.className = "group/char flex items-center justify-between px-2.5 py-1 rounded-lg text-sm font-medium " +
                                      (isCharActive ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-200/50') +
                                      " cursor-pointer";
                    const charButtons = isLocked ? "" : `
                        <div class="opacity-0 group-hover/char:opacity-100 flex items-center space-x-1 shrink-0">
                            <button onclick="event.stopPropagation(); renameItem('${char.id}', 'character')" class="hover:text-indigo-600 p-0.5 text-xs">✏️</button>
                            <button onclick="event.stopPropagation(); deleteItem('${char.id}', 'character')" class="hover:text-red-600 p-0.5 text-xs">🗑️</button>
                        </div>
                    `;
                    charEl.innerHTML = `
                        <div class="flex items-center space-x-1.5 flex-1 min-w-0" onclick="selectCharacter('${char.id}')">
                            <span>👤</span>
                            <span class="truncate">${charName}</span>
                        </div>
                        ${charButtons}
                    `;
                    charList.appendChild(charEl);
                });
            }

            // 3. Render Story Notes
            const noteList = document.getElementById('notes-list');
            noteList.innerHTML = "";
            if (projectData && projectData.story_notes) {
                projectData.story_notes.forEach(note => {
                    const noteTitle = note.title || "";
                    const noteContent = note.content || "";
                    if (searchVal && !noteTitle.toLowerCase().includes(searchVal) && !noteContent.toLowerCase().includes(searchVal)) {
                        return;
                    }
                    const isNoteActive = (activeNodeId === note.id);
                    const noteEl = document.createElement('div');
                    noteEl.className = "group/note flex items-center justify-between px-2.5 py-1 rounded-lg text-sm font-medium " +
                                      (isNoteActive ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-200/50') +
                                      " cursor-pointer";
                    const noteButtons = isLocked ? "" : `
                        <div class="opacity-0 group-hover/note:opacity-100 flex items-center space-x-1 shrink-0">
                            <button onclick="event.stopPropagation(); renameItem('${note.id}', 'note')" class="hover:text-indigo-600 p-0.5 text-xs">✏️</button>
                            <button onclick="event.stopPropagation(); deleteItem('${note.id}', 'note')" class="hover:text-red-600 p-0.5 text-xs">🗑️</button>
                        </div>
                    `;
                    noteEl.innerHTML = `
                        <div class="flex items-center space-x-1.5 flex-1 min-w-0" onclick="selectNote('${note.id}')">
                            <span>📌</span>
                            <span class="truncate">${noteTitle}</span>
                        </div>
                        ${noteButtons}
                    `;
                    noteList.appendChild(noteEl);
                });
            }

            // 4. Render Annotations
            const annotationsList = document.getElementById('annotations-list');
            if (annotationsList) {
                annotationsList.innerHTML = "";
                let allAnnotations = [];

                // Extract annotations from manuscript
                if (projectData && projectData.manuscript) {
                    projectData.manuscript.forEach(chap => {
                        if (chap.children) {
                            chap.children.forEach(scene => {
                                if (scene.content) {
                                    // Parse HTML to extract annotation elements
                                    const tempDiv = document.createElement('div');
                                    tempDiv.innerHTML = scene.content;
                                    const spans = tempDiv.querySelectorAll('.annotation-highlight');
                                    spans.forEach(span => {
                                        let annoId = span.getAttribute('data-annotation-id');
                                        if (!annoId) {
                                            // Assign a persistent ID if it lacks one
                                            annoId = 'anno-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                                            span.setAttribute('data-annotation-id', annoId);
                                            // Update scene content with the new ID
                                            scene.content = tempDiv.innerHTML;
                                            triggerAutoSave();
                                        }
                                        const text = span.textContent || "";
                                        allAnnotations.push({
                                            id: annoId,
                                            sceneId: scene.id,
                                            text: text
                                        });
                                    });
                                }
                            });
                        }
                    });
                }

                window.globalAnnotationsCache = allAnnotations;
                const totalAnnotations = allAnnotations.length;

                allAnnotations.forEach((anno, index) => {
                    const annoIndex = index + 1;
                    const annoTitle = `✍️ Annotation ${annoIndex}/${totalAnnotations}`;
                    const previewText = anno.text.length > 20 ? anno.text.substring(0, 20) + "..." : anno.text;

                    if (searchVal && !annoTitle.toLowerCase().includes(searchVal) && !previewText.toLowerCase().includes(searchVal)) {
                        return;
                    }

                    const isAnnoActive = (activeAnnotationId === anno.id);
                    const annoEl = document.createElement('div');
                    annoEl.className = "group/anno flex flex-col px-2.5 py-1 rounded-lg text-sm font-medium " +
                                      (isAnnoActive ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-200/50') +
                                      " cursor-pointer";

                    const safeTitle = document.createElement('div');
                    safeTitle.textContent = annoTitle;
                    const safePreview = document.createElement('div');
                    safePreview.textContent = previewText;

                    annoEl.innerHTML = `
                        <div class="flex items-center space-x-1.5 flex-1 min-w-0" onclick="selectAnnotation('${anno.sceneId}', '${anno.id}')">
                            <span class="truncate title-container"></span>
                        </div>
                        <div class="text-xs text-slate-400 truncate pl-5 pointer-events-none preview-container"></div>
                    `;
                    annoEl.querySelector('.title-container').textContent = safeTitle.textContent;
                    annoEl.querySelector('.preview-container').textContent = safePreview.textContent;
                    annotationsList.appendChild(annoEl);
                });
            }
        }

        let activeAnnotationId = null;

        window.selectAnnotation = function(sceneId, annotationId) {
            activeAnnotationId = annotationId;
            selectScene(sceneId);

            // Wait for editor to render, then scroll to it
            setTimeout(() => {
                const editor = document.getElementById('editor-content');
                if (editor) {
                    const span = editor.querySelector(`.annotation-highlight[data-annotation-id="${annotationId}"]`);
                    if (span) {
                        span.scrollIntoView({ behavior: 'smooth', block: 'center' });

                        // Briefly highlight the annotation for visual feedback
                        const originalBg = span.style.backgroundColor;
                        span.style.backgroundColor = 'rgba(99, 102, 241, 0.2)'; // indigo-500 light
                        setTimeout(() => {
                            span.style.backgroundColor = originalBg;
                        }, 1500);
                    }
                }
                renderTree();
            }, 100);
        };

        // TRIGGER TREE FILTERING
        function filterTree(val) {
            renderTree(val);
        }

        // LOAD FIRST SCENE ON START
        function loadFirstAvailableScene() {
            let firstSceneId = null;
            if (projectData && projectData.manuscript) {
                for (const chap of projectData.manuscript) {
                    if (chap.children && chap.children.length > 0) {
                        firstSceneId = chap.children[0].id;
                        break;
                    }
                }
            }
            if (firstSceneId) {
                activeNodeId = firstSceneId;
                activeNodeType = "scene";
                renderTree();
                refreshActiveWorkspace(true);
            } else {
                selectPlotGrid();
            }
        }

        // PANELS NAVIGATION & VIEW SWITCHING
        function switchView(viewName) {
            document.getElementById('editor-view').classList.add('hidden');
            document.getElementById('plot-grid-view').classList.add('hidden');
            document.getElementById('resource-view').classList.add('hidden');
            if (document.getElementById('stats-view')) document.getElementById('stats-view').classList.add('hidden');

            if (viewName === 'editor') {
                document.getElementById('editor-view').classList.remove('hidden');
            } else if (viewName === 'plot') {
                document.getElementById('plot-grid-view').classList.remove('hidden');
            } else if (viewName === 'resource') {
                document.getElementById('resource-view').classList.remove('hidden');
            } else if (viewName === 'stats') {
                if (document.getElementById('stats-view')) {
                    document.getElementById('stats-view').classList.remove('hidden');
                    document.getElementById('stats-view').classList.add('flex');
                    renderStatisticsDashboard();
                }
            }
        }

// -----------------------------------------------------------------------------
// STATISTICS DASHBOARD
// -----------------------------------------------------------------------------

function selectStatisticsDashboard() {
    activeChapterIndex = -1;
    activeSceneIndex = -1;
    renderTree(); // deselect all
    switchView('stats');
}

function renderStatisticsDashboard() {
    if (!projectData) return;

    // 1. Basic properties
    document.getElementById('stats-title-display').textContent = projectData.title || "Mon Roman";

    // 2. Compute structural stats
    let totalWords = 0;
    let chaptersCount = projectData.manuscript ? projectData.manuscript.length : 0;
    let scenesCount = 0;
    let chapterWordCounts = [];

    if (projectData.manuscript) {
        projectData.manuscript.forEach(chapter => {
            let chapterWords = 0;
            if (chapter.scenes) {
                scenesCount += chapter.scenes.length;
                chapter.scenes.forEach(scene => {
                    let text = scene.content || "";
                    // Strip HTML tags for word count
                    let plainText = text.replace(/<[^>]+>/g, ' ');
                    let words = plainText.trim().split(/\s+/).filter(word => word.length > 0).length;
                    chapterWords += words;
                    totalWords += words;
                });
            }
            chapterWordCounts.push({
                title: chapter.title || "Chapitre",
                words: chapterWords
            });
        });
    }

    // 3. Populate High Level Stats
    document.getElementById('stats-total-words').textContent = totalWords.toLocaleString();
    let readingTimeMins = Math.ceil(totalWords / 250); // average reading speed 250 wpm
    document.getElementById('stats-reading-time').textContent = `≈ ${readingTimeMins} min de lecture`;

    // Goal
    let goal = 10000;
    if (projectData.settings && projectData.settings.global_word_goal) {
        goal = projectData.settings.global_word_goal;
    }
    let goalProgress = Math.min(100, Math.round((totalWords / goal) * 100));
    document.getElementById('stats-goal-text').textContent = `${totalWords.toLocaleString()} / ${goal.toLocaleString()}`;
    document.getElementById('stats-goal-bar').style.width = `${goalProgress}%`;

    // Streak (Basic mock logic or real if implemented later)
    let currentStreak = 0;
    let longestStreak = 0;
    if (projectData.settings && projectData.settings.streak) {
        currentStreak = projectData.settings.streak.current || 0;
        longestStreak = projectData.settings.streak.longest || 0;
    }
    document.getElementById('stats-streak').innerHTML = `${currentStreak} <span class="text-2xl text-slate-500 font-normal">jours</span>`;
    document.getElementById('stats-longest-streak').textContent = `Plus longue : ${longestStreak}`;

    // 4. Structure Stats
    document.getElementById('stats-structure-summary').textContent = `${scenesCount} SCÈNES · ${chaptersCount} CHAPITRES`;
    document.getElementById('stats-scenes-count').textContent = scenesCount;
    document.getElementById('stats-chapters-count-sub').textContent = `dans ${chaptersCount} chapitres`;
    let avgWordsScene = scenesCount > 0 ? Math.round(totalWords / scenesCount) : 0;
    document.getElementById('stats-avg-words-scene').textContent = avgWordsScene.toLocaleString();

    document.getElementById('stats-notes-count').textContent = (projectData.notes && projectData.notes.notes) ? projectData.notes.notes.length : 0;
    document.getElementById('stats-events-count').textContent = (projectData.notes && projectData.notes.timeline_events) ? projectData.notes.timeline_events.length : 0;

    // 5. Chapters Chart
    const chartContainer = document.getElementById('stats-chapters-chart');
    const labelsContainer = document.getElementById('stats-chapters-labels');
    chartContainer.innerHTML = '';
    labelsContainer.innerHTML = '';

    if (chapterWordCounts.length > 0) {
        let maxWords = Math.max(...chapterWordCounts.map(c => c.words), 1); // prevent div by zero
        chapterWordCounts.forEach((c, index) => {
            let heightPercent = Math.max(5, (c.words / maxWords) * 100);

            // Bar
            let bar = document.createElement('div');
            bar.className = 'bg-indigo-500 rounded-t-sm flex-1 hover:bg-indigo-400 transition-colors relative group';
            bar.style.height = `${heightPercent}%`;

            // Tooltip
            let tooltip = document.createElement('div');
            tooltip.className = 'opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 bg-slate-800 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap transition-opacity z-10';
            tooltip.textContent = `${c.title}: ${c.words} mots`;
            bar.appendChild(tooltip);

            chartContainer.appendChild(bar);

            // Label
            let label = document.createElement('div');
            label.className = 'text-[10px] text-slate-400 truncate text-center flex-1 overflow-hidden';
            label.textContent = `${index + 1}`;
            label.title = c.title;
            labelsContainer.appendChild(label);
        });
    }

    // 6. Characters List (By appearance/cards)
    document.getElementById('stats-inhabitants-summary').textContent = `${projectData.characters ? projectData.characters.length : 0} PERSONNAGES`;
    const charsList = document.getElementById('stats-characters-list');
    charsList.innerHTML = '';

    if (projectData.characters && projectData.characters.length > 0) {
        // Calculate mentions across manuscript
        let charactersWithCounts = projectData.characters.map(char => {
            let count = 0;
            let nameLower = char.name.toLowerCase();
            let aliasesLower = char.aliases ? char.aliases.map(a => a.toLowerCase()) : [];

            if (projectData.manuscript) {
                projectData.manuscript.forEach(ch => {
                    if (ch.scenes) {
                        ch.scenes.forEach(sc => {
                            let text = (sc.content || "").toLowerCase();
                            // Count main name
                            let regexName = new RegExp(`\\b${nameLower}\\b`, 'g');
                            count += (text.match(regexName) || []).length;
                            // Count aliases
                            aliasesLower.forEach(alias => {
                                let regexAlias = new RegExp(`\\b${alias}\\b`, 'g');
                                count += (text.match(regexAlias) || []).length;
                            });
                        });
                    }
                });
            }
            return { name: char.name, count: count, color: char.color || '#6366f1' };
        });

        // Sort by appearances, descending
        charactersWithCounts.sort((a, b) => b.count - a.count);
        let maxCount = Math.max(...charactersWithCounts.map(c => c.count), 1);

        // Display top 5 or all if less
        let topChars = charactersWithCounts.slice(0, 5);
        if (topChars.length === 0 || topChars[0].count === 0) {
            charsList.innerHTML = '<div class="text-sm text-slate-500 italic">Aucune mention détectée.</div>';
        } else {
            topChars.forEach(char => {
                if (char.count > 0) {
                    let widthPercent = (char.count / maxCount) * 100;

                    let row = document.createElement('div');
                    row.className = 'flex items-center space-x-3';

                    row.innerHTML = `
                        <div class="w-24 text-xs font-semibold text-slate-700 truncate" title="${char.name}">${char.name}</div>
                        <div class="flex-1 bg-slate-100 rounded-full h-2">
                            <div class="h-2 rounded-full transition-all" style="width: ${widthPercent}%; background-color: ${char.color}"></div>
                        </div>
                        <div class="w-12 text-right text-xs text-slate-500">${char.count}</div>
                    `;
                    charsList.appendChild(row);
                }
            });
        }
    } else {
        charsList.innerHTML = '<div class="text-sm text-slate-500 italic">Aucun personnage.</div>';
    }
}

        function findParentChapter(sceneId) {
            for (const chap of projectData.manuscript) {
                if (chap.children) {
                    for (const scene of chap.children) {
                        if (scene.id === sceneId) {
                            return chap;
                        }
                    }
                }
            }
            return null;
        }

        function autoResizeTextarea(el) {
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        }

        function onChapterBlockInput(chapId, field, val) {
            const node = findNodeById(chapId);
            if (node) {
                node[field] = val;
                triggerAutoSave();
                // Live update tree title
                const treeTitleEl = document.querySelector(`[data-chap-id="${chapId}"] .chap-title`);
                if (treeTitleEl) treeTitleEl.innerText = val;
            }
        }

        function onSceneBlockInput(sceneId, field, val) {
            const node = findNodeById(sceneId);
            if (node) {
                node[field] = val;
                triggerAutoSave();
                if (field === 'title') {
                    // Live update tree title
                    const treeTitleEl = document.querySelector(`[data-scene-id="${sceneId}"] .scene-title`);
                    if (treeTitleEl) treeTitleEl.innerText = val;
                }
                updateEditorWordsCount();
            }
        }

        function onSceneBlockFocus(sceneId) {
            // Restore previous active textarea's id if any
            const previousActive = document.getElementById('editor-content');
            if (previousActive && previousActive.getAttribute('data-scene-id') !== sceneId) {
                const oldId = previousActive.getAttribute('data-scene-id');
                previousActive.id = `editor-content-${oldId}`;
            }

            // Assign 'editor-content' id to focused textarea
            const currentTextarea = document.getElementById(`editor-content-${sceneId}`);
            if (currentTextarea) {
                currentTextarea.id = 'editor-content';
            }

            // Update active node state & highlights
            if (activeNodeId !== sceneId) {
                activeNodeId = sceneId;
                activeNodeType = "scene";
                renderTree();
                updateEditorWordsCount();
            }
        }

        // TYPOGRAPHY ASSISTANT FOR CONTENTEDITABLE
        function handleContentEditableTypography(e) {
            if (e.key === '"') {
                e.preventDefault();
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);

                    const container = range.startContainer;
                    const offset = range.startOffset;
                    let isOpening = true;
                    if (container.nodeType === Node.TEXT_NODE) {
                        const text = container.nodeValue;
                        const lastChar = offset > 0 ? text[offset - 1] : "";
                        isOpening = !lastChar || /\s|[.,!?;:([{\-]/.test(lastChar);
                    }

                    const quoteStr = isOpening ? '«\u00A0' : '\u00A0»';
                    const node = document.createTextNode(quoteStr);
                    range.insertNode(node);
                    range.setStartAfter(node);
                    range.setEndAfter(node);
                    selection.removeAllRanges();
                    selection.addRange(range);

                    const editor = document.getElementById('editor-content');
                    if (editor) {
                        onCombinedEditorInput(null, null);
                    }
                }
            } else if (e.key === '-') {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const container = range.startContainer;
                    const offset = range.startOffset;
                    if (container.nodeType === Node.TEXT_NODE) {
                        const text = container.nodeValue;
                        if (offset > 0 && text[offset - 1] === '-') {
                            e.preventDefault();
                            range.setStart(container, offset - 1);
                            range.setEnd(container, offset);
                            range.deleteContents();

                            const dashNode = document.createTextNode('—');
                            range.insertNode(dashNode);
                            range.setStartAfter(dashNode);
                            range.setEndAfter(dashNode);
                            selection.removeAllRanges();
                            selection.addRange(range);

                            const editor = document.getElementById('editor-content');
                            if (editor) {
                                onCombinedEditorInput(null, null);
                            }
                        }
                    }
                }
            }
        }

        // ACTIVE WORKSPACE REFRESH
        function onCombinedEditorInput(val, targetElement = null) {
            if (targetElement && targetElement.classList.contains('editor-scene-contenteditable')) {
                const sceneId = targetElement.getAttribute('data-scene-id');
                const chapterId = targetElement.getAttribute('data-chapter-id');

                let chapter = findNodeById(chapterId);
                if (chapter && chapter.children) {
                    let scene = chapter.children.find(s => s.id === sceneId);
                    if (scene) {
                        let htmlVal = targetElement.innerHTML;
                        scene.content = htmlVal.replace(/<br\s*\/?>/gi, '\n');
                        triggerAutoSave();
                    }
                }
            } else {
                // Fallback: iterate over all scene elements
                const sceneEditors = document.querySelectorAll('.editor-scene-contenteditable');
                sceneEditors.forEach(ta => {
                    const sceneId = ta.getAttribute('data-scene-id');
                    const chapterId = ta.getAttribute('data-chapter-id');

                    let chapter = findNodeById(chapterId);
                    if (chapter && chapter.children) {
                        let scene = chapter.children.find(s => s.id === sceneId);
                        if (scene) {
                            let htmlVal = ta.innerHTML;
                            scene.content = htmlVal.replace(/<br\s*\/?>/gi, '\n');
                        }
                    }
                });
                triggerAutoSave();
            }
            updateEditorWordsCount();

            // Re-apply pagination if text length changed significantly enough to alter layout
            const scrollContainer = document.getElementById('editor-scroll-container');
            if (scrollContainer && scrollContainer.classList.contains('show-page-numbers')) {
                applyPagination();
            }
        }

        function scrollToTarget(targetSceneId, targetChapterId) {
            setTimeout(() => {
                if (targetSceneId) {
                    const anchor = document.getElementById(`scene-anchor-${targetSceneId}`);
                    if (anchor) {
                        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        anchor.focus();
                    }
                } else if (targetChapterId) {
                    const anchor = document.getElementById(`chapter-anchor-${targetChapterId}`);
                    if (anchor) {
                        anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        const firstScene = anchor.querySelector('.editor-scene-contenteditable');
                        if (firstScene) firstScene.focus();
                    }
                } else {
                    const scrollContainer = document.getElementById('editor-scroll-container');
                    if (scrollContainer) scrollContainer.scrollTop = 0;
                }
            }, 50);
        }

        function refreshActiveWorkspace(forceRebuild = true) {
            if (activeNodeType === "scene" || activeNodeType === "chapter") {
                let targetSceneId = null;
                let targetChapterId = null;

                if (activeNodeType === "scene") {
                    targetSceneId = activeNodeId;
                    let chap = findParentChapter(targetSceneId);
                    if (chap) targetChapterId = chap.id;
                } else {
                    targetChapterId = activeNodeId;
                }

                switchView('editor');
                const wrapper = document.getElementById('editor-layout-wrapper');

                // If not forcing rebuild and editor already exists, just scroll
                if (!forceRebuild && document.getElementById('editor-content')) {
                    scrollToTarget(targetSceneId, targetChapterId);
                    return;
                }

                const editorContentDiv = document.createElement('div');
                editorContentDiv.id = 'editor-content';
                editorContentDiv.className = 'w-full h-full flex flex-col p-4 outline-none focus:ring-0 bg-transparent min-h-[500px]';
                editorContentDiv.style.whiteSpace = 'pre-wrap';
                editorContentDiv.style.wordWrap = 'break-word';
                editorContentDiv.style.outline = 'none';

                wrapper.innerHTML = '';
                wrapper.appendChild(editorContentDiv);

                if (!projectData.manuscript || projectData.manuscript.length === 0) {
                    editorContentDiv.innerHTML = `
                        <div class="text-slate-400 italic text-sm text-center py-10">
                            Aucun chapitre. Créez-en un pour commencer à rédiger !
                        </div>
                    `;
                    return;
                }

                const placeholderText = formatTranslation("editor_placeholder") || "Commencez à rédiger votre chef-d'œuvre ici...";

                function setupSceneEditor(ta) {
                    ta.addEventListener('input', function() {
                        onCombinedEditorInput(null, ta);
                    });
                    ta.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            document.execCommand('insertLineBreak');
                            onCombinedEditorInput(null, ta);
                        } else if (e.key === '"' || e.key === '-') {
                            handleContentEditableTypography(e);
                        }
                    });
                    ta.addEventListener('focus', function() {
                        const sceneId = ta.getAttribute('data-scene-id');
                        if (activeNodeId !== sceneId) {
                            activeNodeId = sceneId;
                            activeNodeType = "scene";
                            renderTree();
                        }
                    });
                    // AI tools selection listening (defined in linguistique.js)
                    if (typeof handleEditorSelection === 'function') {
                        ta.addEventListener('mouseup', handleEditorSelection);
                        ta.addEventListener('keyup', handleEditorSelection);
                    }
                }

                let currentChapterIndex = 0;

                function renderNextChunk() {
                    if (currentChapterIndex >= projectData.manuscript.length) {
                        // Finalize UI update
                        if (targetSceneId) {
                            const anchor = document.getElementById(`scene-anchor-${targetSceneId}`);
                            if (anchor) {
                                anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                anchor.focus();
                            }
                        } else if (targetChapterId) {
                            const anchor = document.getElementById(`chapter-anchor-${targetChapterId}`);
                            if (anchor) {
                                anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                const firstScene = anchor.querySelector('.editor-scene-contenteditable');
                                if (firstScene) firstScene.focus();
                            }
                        } else {
                            const scrollContainer = document.getElementById('editor-scroll-container');
                            if (scrollContainer) scrollContainer.scrollTop = 0;
                        }
                        updateEditorWordsCount();
                        return;
                    }

                    const CHUNK_SIZE = 5; // render 5 chapters at a time
                    const endChunk = Math.min(currentChapterIndex + CHUNK_SIZE, projectData.manuscript.length);

                    for (let i = currentChapterIndex; i < endChunk; i++) {
                        const chap = projectData.manuscript[i];
                        const chapDiv = document.createElement('div');
                        chapDiv.className = 'chapter-container mb-12';
                        chapDiv.id = `chapter-anchor-${chap.id}`;

                        let chapHtml = `<h1 class="text-3xl font-bold text-slate-800 mb-6 text-center mt-10">${chap.title}</h1>`;
                        chapDiv.innerHTML = chapHtml;

                        if (!chap.children || chap.children.length === 0) {
                            const emptyDiv = document.createElement('div');
                            emptyDiv.className = 'text-slate-400 italic text-sm text-center py-4';
                            emptyDiv.innerText = 'Aucune scène dans ce chapitre.';
                            chapDiv.appendChild(emptyDiv);
                        } else {
                            chap.children.forEach(scene => {
                                const sceneDiv = document.createElement('div');
                                sceneDiv.id = `scene-anchor-${scene.id}`;
                                sceneDiv.className = 'editor-scene-contenteditable w-full font-georgia text-lg leading-relaxed text-slate-800 border-none outline-none mb-4';
                                sceneDiv.contentEditable = 'true';
                                sceneDiv.setAttribute('data-scene-id', scene.id);
                                sceneDiv.setAttribute('data-chapter-id', chap.id);
                                sceneDiv.setAttribute('data-placeholder', placeholderText);
                                sceneDiv.innerHTML = (scene.content || "").replace(/\n/g, '<br>');

                                setupSceneEditor(sceneDiv);
                                chapDiv.appendChild(sceneDiv);
                            });
                        }

                        editorContentDiv.appendChild(chapDiv);
                    }

                    currentChapterIndex = endChunk;

                    if (currentChapterIndex < projectData.manuscript.length) {
                        requestAnimationFrame(renderNextChunk);
                    } else {
                        // Finalize UI update



                        if (targetSceneId) {
                            const anchor = document.getElementById(`scene-anchor-${targetSceneId}`);
                            if (anchor) {
                                anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                anchor.focus();
                            }
                        } else if (targetChapterId) {
                            const anchor = document.getElementById(`chapter-anchor-${targetChapterId}`);
                            if (anchor) {
                                anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                const firstScene = anchor.querySelector('.editor-scene-contenteditable');
                                if (firstScene) firstScene.focus();
                            }
                        } else {
                            const scrollContainer = document.getElementById('editor-scroll-container');
                            if (scrollContainer) scrollContainer.scrollTop = 0;
                        }
                        updateEditorWordsCount();
                    }
                }

                requestAnimationFrame(renderNextChunk);

            } else if (activeNodeType === "character") {
                let char = projectData.characters.find(c => c.id === activeNodeId);
                if (char) {
                    char = ensureCharacterFields(char);
                    switchView('resource');
                    document.getElementById('resource-icon').innerText = "👤";
                    document.getElementById('resource-title').value = char.name;
                    document.getElementById('character-fields').classList.remove('hidden');
                    document.getElementById('note-fields').classList.add('hidden');

                    renderCharacterFields(char);
                }
            } else if (activeNodeType === "note") {
                const note = projectData.story_notes.find(n => n.id === activeNodeId);
                if (note) {
                    switchView('resource');
                    document.getElementById('resource-icon').innerText = "📌";
                    document.getElementById('resource-title').value = note.title;
                    document.getElementById('character-fields').classList.add('hidden');
                    document.getElementById('note-fields').classList.remove('hidden');

                    document.getElementById('note-type').value = note.type || "";
                    document.getElementById('note-content').value = note.content || "";
                }
            } else if (activeNodeType === "plot_grid") {
                switchView('plot');
                refreshPlotView();
            }
            applyLockState();
            applyEditorLayoutSettings();
        }

        // DRAG AND DROP HANDLERS FOR CHAPTERS
        function handleChapDragStart(e) {
            draggedChapId = this.getAttribute('data-chap-id');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedChapId);
            this.classList.add('opacity-50');
        }

        function handleChapDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const rect = this.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;

            if (e.clientY < midpoint) {
                this.classList.add('border-t-indigo-500');
                this.classList.remove('border-t-transparent', 'border-b-indigo-500');
                this.classList.add('border-b-transparent');
            } else {
                this.classList.add('border-b-indigo-500');
                this.classList.remove('border-b-transparent', 'border-t-indigo-500');
                this.classList.add('border-t-transparent');
            }
        }

        function handleChapDragLeave(e) {
            this.classList.remove('border-t-indigo-500', 'border-b-indigo-500');
            this.classList.add('border-t-transparent', 'border-b-transparent');
        }

        function handleChapDragEnd(e) {
            this.classList.remove('opacity-50', 'border-t-indigo-500', 'border-b-indigo-500');
            this.classList.add('border-t-transparent', 'border-b-transparent');
            document.querySelectorAll('#manuscript-nodes-list > .group').forEach(el => {
                el.classList.remove('border-t-indigo-500', 'border-b-indigo-500');
                el.classList.add('border-t-transparent', 'border-b-transparent');
            });
        }

        function handleChapDrop(e) {
            e.preventDefault();
            this.classList.remove('border-t-indigo-500', 'border-b-indigo-500');
            this.classList.add('border-t-transparent', 'border-b-transparent');

            const targetChapId = this.getAttribute('data-chap-id');

            // If dropping a scene onto a chapter header
            if (draggedSceneId) {
                if (draggedSceneParentChapId === targetChapId) return; // already in this chapter
                const sourceChap = findNodeById(draggedSceneParentChapId);
                const targetChap = findNodeById(targetChapId);
                if (!sourceChap || !targetChap) return;

                const draggedIdx = sourceChap.children.findIndex(s => s.id === draggedSceneId);
                if (draggedIdx === -1) return;

                // Remove from source and push to target end
                const [draggedScene] = sourceChap.children.splice(draggedIdx, 1);
                targetChap.children.push(draggedScene);

                triggerAutoSave();
                renderTree();
                refreshActiveWorkspace();
                return;
            }

            if (!draggedChapId || draggedChapId === targetChapId) return;

            // Reorder in projectData.manuscript
            const manuscript = projectData.manuscript;
            const draggedIdx = manuscript.findIndex(c => c.id === draggedChapId);
            const targetIdx = manuscript.findIndex(c => c.id === targetChapId);

            if (draggedIdx === -1 || targetIdx === -1) return;

            const rect = this.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;

            // Determine insertion index
            let newIdx = targetIdx;
            if (e.clientY >= midpoint) {
                newIdx = targetIdx + 1;
            }

            // Remove from old position
            const [draggedChap] = manuscript.splice(draggedIdx, 1);

            // Adjust target index if old index was before target index
            let insertIdx = newIdx;
            if (draggedIdx < newIdx) {
                insertIdx = newIdx - 1;
            }

            // Insert at new position
            manuscript.splice(insertIdx, 0, draggedChap);

            // Save and re-render
            triggerAutoSave();
            renderTree();
        }

        // DRAG AND DROP HANDLERS FOR SCENES
        window.handleSceneDragStart = function(e) {
            e.stopPropagation();
            draggedSceneId = e.currentTarget.getAttribute('data-scene-id');
            draggedSceneParentChapId = e.currentTarget.getAttribute('data-parent-chap-id');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedSceneId);
            e.currentTarget.classList.add('opacity-50');
        };

        window.handleSceneDragOver = function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';

            const el = e.currentTarget;
            const rect = el.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;

            if (e.clientY < midpoint) {
                el.classList.add('border-t-indigo-500');
                el.classList.remove('border-t-transparent', 'border-b-indigo-500');
                el.classList.add('border-b-transparent');
            } else {
                el.classList.add('border-b-indigo-500');
                el.classList.remove('border-b-transparent', 'border-t-indigo-500');
                el.classList.add('border-t-transparent');
            }
        };

        window.handleSceneDragLeave = function(e) {
            e.stopPropagation();
            const el = e.currentTarget;
            el.classList.remove('border-t-indigo-500', 'border-b-indigo-500');
            el.classList.add('border-t-transparent', 'border-b-transparent');
        };

        window.handleSceneDragEnd = function(e) {
            e.currentTarget.classList.remove('opacity-50', 'border-t-indigo-500', 'border-b-indigo-500');
            document.querySelectorAll('[data-scene-id]').forEach(el => {
                el.classList.remove('border-t-indigo-500', 'border-b-indigo-500', 'border-t-transparent', 'border-b-transparent');
            });
            draggedSceneId = null;
            draggedSceneParentChapId = null;
        };

        window.handleSceneDrop = function(e) {
            e.preventDefault();
            e.stopPropagation();
            const el = e.currentTarget;
            el.classList.remove('border-t-indigo-500', 'border-b-indigo-500');

            const targetSceneId = el.getAttribute('data-scene-id');
            const targetParentChapId = el.getAttribute('data-parent-chap-id');
            if (!draggedSceneId || draggedSceneId === targetSceneId) return;

            const sourceChap = findNodeById(draggedSceneParentChapId);
            const targetChap = findNodeById(targetParentChapId);
            if (!sourceChap || !targetChap) return;

            const draggedIdx = sourceChap.children.findIndex(s => s.id === draggedSceneId);
            const targetIdx = targetChap.children.findIndex(s => s.id === targetSceneId);
            if (draggedIdx === -1 || targetIdx === -1) return;

            const rect = el.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;

            let newIdx = targetIdx;
            if (e.clientY >= midpoint) {
                newIdx = targetIdx + 1;
            }

            const [draggedScene] = sourceChap.children.splice(draggedIdx, 1);

            let insertIdx = newIdx;
            if (draggedSceneParentChapId === targetParentChapId && draggedIdx < newIdx) {
                insertIdx = newIdx - 1;
            }

            targetChap.children.splice(insertIdx, 0, draggedScene);

            triggerAutoSave();
            renderTree();
            refreshActiveWorkspace();
        };

        // SELECT HANDLERS
        function selectScene(id) {
            activeNodeId = id;
            activeNodeType = "scene";
            renderTree();
            refreshActiveWorkspace(false);
        }

        function selectChapter(id) {
            activeNodeId = id;
            activeNodeType = "chapter";
            renderTree();
            refreshActiveWorkspace(false);
        }

        function selectCharacter(id) {
            activeNodeId = id;
            activeNodeType = "character";
            renderTree();
            refreshActiveWorkspace();
        }

        function selectNote(id) {
            activeNodeId = id;
            activeNodeType = "note";
            renderTree();
            refreshActiveWorkspace();
        }

        function selectPlotGrid() {
            activeNodeId = "PLOT_GRID";
            activeNodeType = "plot_grid";
            renderTree();
            refreshActiveWorkspace();
        }

        // FIND NODE IN MANUSCRIPT HIERARCHY
        function findNodeById(id, list = projectData.manuscript) {
            for (const item of list) {
                if (item.id === id) return item;
                if (item.children) {
                    const found = findNodeById(id, item.children);
                    if (found) return found;
                }
            }
            return null;
        }

        // INPUT CHANGED HANDLERS (EDITOR / RESOURCE)
        function onEditorInput(field, val) {
            if (activeNodeType === "scene" || activeNodeType === "chapter") {
                if (field === 'content') {
                    onCombinedEditorInput(val, null);
                } else if (field === 'title') {
                    const node = findNodeById(activeNodeId);
                    if (node) {
                        node.title = val;
                        renderTree();
                        triggerAutoSave();
                    }
                }
            }
        }

        // RESOURCE FIELDS SAVE
        function onResourceInput(field, val) {
            if (activeNodeType === "character") {
                const char = projectData.characters.find(c => c.id === activeNodeId);
                if (char) {
                    if (field === 'title') {
                        char.name = val;
                        renderTree();
                    } else {
                        char[field] = val;
                    }
                    triggerAutoSave();
                }
            } else if (activeNodeType === "note") {
                const note = projectData.story_notes.find(n => n.id === activeNodeId);
                if (note) {
                    if (field === 'title') {
                        note.title = val;
                        renderTree();
                    } else {
                        note[field] = val;
                    }
                    triggerAutoSave();
                }
            }
        }

        // CHARACTER LORE MODEL AND RENDERING HELPERS
        function ensureCharacterFields(char) {
            if (!char) return char;
            if (char.type === undefined) char.type = "personnage";
            if (char.aliases === undefined) char.aliases = [];
            if (char.traits === undefined) char.traits = [];
            if (char.appearance === undefined) char.appearance = "";
            if (char.notes === undefined) char.notes = "";
            if (char.relations === undefined) char.relations = [];
            if (char.linked_scenes === undefined) char.linked_scenes = [];
            return char;
        }

        function renderCharacterFields(char) {
            const container = document.getElementById('character-fields');
            if (!container) return;
            container.innerHTML = "";

            // Ensure compatibility
            ensureCharacterFields(char);

            // 0. INTERVIEW BUTTON
            const interviewDiv = document.createElement('div');
            interviewDiv.className = "mb-4";
            interviewDiv.innerHTML = `
                <button onclick="openInterviewModal('${char.id}')" class="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-3 py-2 rounded-lg text-xs font-semibold transition-all flex justify-center items-center space-x-2">
                    <span>💬</span> <span data-i18n="interview_btn">Interviewer (IA)</span>
                </button>
            `;
            container.appendChild(interviewDiv);

            // 1. ROLE / FONCTION
            const roleDiv = document.createElement('div');
            roleDiv.className = "space-y-1";
            roleDiv.innerHTML = `
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-400" data-i18n="character_role">${translations["character_role"] || "Rôle / Fonction"}</label>
                <input type="text" id="char-role" value="${char.role || ''}" class="w-full rounded-lg border-slate-300 text-sm focus:border-indigo-500 focus:ring-indigo-500 shadow-sm">
            `;
            const roleInput = roleDiv.querySelector('#char-role');
            roleInput.addEventListener('input', (e) => {
                char.role = e.target.value;
                triggerAutoSave();
            });
            container.appendChild(roleDiv);

            // 2. ALIASES / SURNOMS (TAGS + INPUT)
            const aliasDiv = document.createElement('div');
            aliasDiv.className = "space-y-2";

            // Render existing tags
            let aliasTagsHtml = char.aliases.map((alias, idx) => `
                <span class="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs px-2.5 py-1 rounded-full border border-slate-200">
                    <span>${escapeHtml(alias)}</span>
                    <button class="text-slate-400 hover:text-slate-600 font-bold focus:outline-none" onclick="removeAlias(${idx})">&times;</button>
                </span>
            `).join('');

            aliasDiv.innerHTML = `
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-400" data-i18n="character_aliases">${translations["character_aliases"] || "Surnoms / Alias"}</label>
                <div class="flex flex-wrap gap-1.5 mb-2">${aliasTagsHtml || '<span class="text-xs text-slate-400 italic">Aucun surnom</span>'}</div>
                <div class="flex gap-1.5">
                    <input type="text" id="new-alias-input" placeholder="${translations["placeholder_new_alias"] || "Nouveau surnom..."}" class="flex-1 rounded-lg border-slate-300 text-xs focus:border-indigo-500 focus:ring-indigo-500 shadow-sm">
                    <button onclick="addAlias()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-all" data-i18n="add_alias">${translations["add_alias"] || "Ajouter"}</button>
                </div>
            `;
            container.appendChild(aliasDiv);

            // Add alias enter listener
            const aliasInput = aliasDiv.querySelector('#new-alias-input');
            aliasInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addAlias();
                }
            });

            window.addAlias = () => {
                const input = document.getElementById('new-alias-input');
                const val = input.value.trim();
                if (val) {
                    char.aliases.push(val);
                    triggerAutoSave();
                    renderCharacterFields(char);
                }
            };
            window.removeAlias = (idx) => {
                char.aliases.splice(idx, 1);
                triggerAutoSave();
                renderCharacterFields(char);
            };

            // 3. TRAITS / CARACTÈRE (TAGS + INPUT)
            const traitDiv = document.createElement('div');
            traitDiv.className = "space-y-2";

            let traitTagsHtml = char.traits.map((trait, idx) => `
                <span class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-full border border-indigo-100">
                    <span>${escapeHtml(trait)}</span>
                    <button class="text-indigo-400 hover:text-indigo-600 font-bold focus:outline-none" onclick="removeTrait(${idx})">&times;</button>
                </span>
            `).join('');

            traitDiv.innerHTML = `
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-400" data-i18n="character_traits">${translations["character_traits"] || "Traits de caractère"}</label>
                <div class="flex flex-wrap gap-1.5 mb-2">${traitTagsHtml || '<span class="text-xs text-slate-400 italic">Aucun trait</span>'}</div>
                <div class="flex gap-1.5">
                    <input type="text" id="new-trait-input" placeholder="${translations["placeholder_new_trait"] || "Nouveau trait..."}" class="flex-1 rounded-lg border-slate-300 text-xs focus:border-indigo-500 focus:ring-indigo-500 shadow-sm">
                    <button onclick="addTrait()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-all" data-i18n="add_trait">${translations["add_trait"] || "Ajouter"}</button>
                </div>
            `;
            container.appendChild(traitDiv);

            // Add trait enter listener
            const traitInput = traitDiv.querySelector('#new-trait-input');
            traitInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addTrait();
                }
            });

            window.addTrait = () => {
                const input = document.getElementById('new-trait-input');
                const val = input.value.trim();
                if (val) {
                    char.traits.push(val);
                    triggerAutoSave();
                    renderCharacterFields(char);
                }
            };
            window.removeTrait = (idx) => {
                char.traits.splice(idx, 1);
                triggerAutoSave();
                renderCharacterFields(char);
            };

            // 4. DESCRIPTION PHYSIQUE
            const appDiv = document.createElement('div');
            appDiv.className = "space-y-1";
            appDiv.innerHTML = `
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-400" data-i18n="character_appearance">${translations["character_appearance"] || "Apparence physique"}</label>
                <textarea id="char-appearance" rows="3" class="w-full rounded-lg border-slate-300 text-sm focus:border-indigo-500 focus:ring-indigo-500 shadow-sm resize-none" placeholder="cicatrices, style vestimentaire, particularités...">${char.appearance || ''}</textarea>
            `;
            const appTextarea = appDiv.querySelector('#char-appearance');
            appTextarea.addEventListener('input', (e) => {
                char.appearance = e.target.value;
                triggerAutoSave();
            });
            container.appendChild(appDiv);

            // 5. DESCRIPTION GÉNÉRALE
            const descDiv = document.createElement('div');
            descDiv.className = "space-y-1";
            descDiv.innerHTML = `
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-400" data-i18n="character_desc">${translations["character_desc"] || "Description du personnage"}</label>
                <textarea id="char-desc" rows="4" class="w-full rounded-lg border-slate-300 text-sm focus:border-indigo-500 focus:ring-indigo-500 shadow-sm resize-none">${char.description || ''}</textarea>
            `;
            const descTextarea = descDiv.querySelector('#char-desc');
            descTextarea.addEventListener('input', (e) => {
                char.description = e.target.value;
                triggerAutoSave();
            });
            container.appendChild(descDiv);

            // 6. RELATIONS (DYNAMIC CARDS LIST)
            const relDiv = document.createElement('div');
            relDiv.className = "space-y-3 pt-4 border-t border-slate-100";

            let relationsHtml = "";
            const availableChars = projectData.characters.filter(c => c.id !== char.id);

            if (char.relations.length === 0) {
                relationsHtml = `<div class="text-xs text-slate-400 italic">Aucune relation définie.</div>`;
            } else {
                char.relations.forEach((rel, idx) => {
                    const selectOptions = availableChars.map(c => `
                        <option value="${c.id}" ${c.id === rel.target_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>
                    `).join('');

                    relationsHtml += `
                        <div class="bg-slate-50 border border-slate-200 p-3 rounded-lg flex flex-col gap-2 relative group shadow-2xs">
                            <button onclick="removeRelation(${idx})" class="absolute top-2 right-2 text-slate-400 hover:text-red-500 text-sm focus:outline-none">🗑️</button>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div>
                                    <label class="block text-[10px] font-semibold text-slate-400 mb-0.5" data-i18n="relation_target">${translations["relation_target"] || "Personnage cible"}</label>
                                    <select onchange="updateRelation(${idx}, 'target_id', this.value)" class="w-full bg-white border border-slate-300 rounded-lg text-xs py-1 px-1.5 focus:border-indigo-500 focus:ring-indigo-500">
                                        <option value="" disabled ${!rel.target_id ? 'selected' : ''}>Sélectionner...</option>
                                        ${selectOptions}
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[10px] font-semibold text-slate-400 mb-0.5" data-i18n="relation_type">${translations["relation_type"] || "Type de relation"}</label>
                                    <input type="text" value="${escapeHtml(rel.type || '')}" oninput="updateRelation(${idx}, 'type', this.value)" placeholder="${translations["placeholder_relation_type"] || "e.g. Rival, Amant..."}" class="w-full bg-white border border-slate-300 rounded-lg text-xs py-1 px-1.5 focus:border-indigo-500 focus:ring-indigo-500">
                                </div>
                            </div>
                            <div>
                                <label class="block text-[10px] font-semibold text-slate-400 mb-0.5" data-i18n="relation_desc">${translations["relation_desc"] || "Description de la relation"}</label>
                                <input type="text" value="${escapeHtml(rel.description || '')}" oninput="updateRelation(${idx}, 'description', this.value)" placeholder="${translations["placeholder_relation_desc"] || "Description..."}" class="w-full bg-white border border-slate-300 rounded-lg text-xs py-1 px-1.5 focus:border-indigo-500 focus:ring-indigo-500">
                            </div>
                        </div>
                    `;
                });
            }

            relDiv.innerHTML = `
                <div class="flex justify-between items-center">
                    <label class="block text-xs font-bold uppercase tracking-wider text-slate-400" data-i18n="character_relations">${translations["character_relations"] || "Relations"}</label>
                    <button onclick="addRelation()" class="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold px-2.5 py-1 rounded-lg text-xs transition-all" data-i18n="add_relation">${translations["add_relation"] || "+ Ajouter relation"}</button>
                </div>
                <div class="space-y-2.5">${relationsHtml}</div>
            `;
            container.appendChild(relDiv);

            window.addRelation = () => {
                char.relations.push({ target_id: "", type: "", description: "" });
                triggerAutoSave();
                renderCharacterFields(char);
            };
            window.removeRelation = (idx) => {
                char.relations.splice(idx, 1);
                triggerAutoSave();
                renderCharacterFields(char);
            };
            window.updateRelation = (idx, key, val) => {
                char.relations[idx][key] = val;
                triggerAutoSave();
            };

            // 7. SCÈNES RELIÉES (CHECKLIST OF ALL SCENES IN MANUSCRIPT)
            const scenesDiv = document.createElement('div');
            scenesDiv.className = "space-y-2 pt-4 border-t border-slate-100";

            // Collect all scenes
            const allScenes = [];
            projectData.manuscript.forEach(chap => {
                chap.children.forEach(scene => {
                    allScenes.push({ id: scene.id, title: scene.title, chapterTitle: chap.title });
                });
            });

            let scenesChecklistHtml = "";
            if (allScenes.length === 0) {
                scenesChecklistHtml = `<div class="text-xs text-slate-400 italic">Aucune scène disponible dans le manuscrit.</div>`;
            } else {
                allScenes.forEach(scene => {
                    const isChecked = char.linked_scenes && char.linked_scenes.includes(scene.id);
                    scenesChecklistHtml += `
                        <label class="flex items-center space-x-2 text-xs text-slate-600 hover:text-slate-900 cursor-pointer py-0.5">
                            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleLinkedScene('${scene.id}', this.checked)" class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer">
                            <span>${escapeHtml(scene.chapterTitle)} : <strong class="text-slate-700">${escapeHtml(scene.title)}</strong></span>
                        </label>
                    `;
                });
            }

            scenesDiv.innerHTML = `
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-400" data-i18n="character_scenes">${translations["character_scenes"] || "Scènes associées"}</label>
                <div class="max-h-36 overflow-y-auto bg-slate-50 border border-slate-200 p-2.5 rounded-lg space-y-1 shadow-2xs">${scenesChecklistHtml}</div>
            `;
            container.appendChild(scenesDiv);

            window.toggleLinkedScene = (sceneId, isChecked) => {
                if (!char.linked_scenes) char.linked_scenes = [];
                if (isChecked) {
                    if (!char.linked_scenes.includes(sceneId)) char.linked_scenes.push(sceneId);
                } else {
                    char.linked_scenes = char.linked_scenes.filter(id => id !== sceneId);
                }
                triggerAutoSave();
            };

            // 8. NOTES LIBRES / LORE
            const notesDiv = document.createElement('div');
            notesDiv.className = "space-y-1 pt-4 border-t border-slate-100";
            notesDiv.innerHTML = `
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-400" data-i18n="character_notes">${translations["character_notes"] || "Notes libres / Lore"}</label>
                <textarea id="char-notes" rows="4" class="w-full rounded-lg border-slate-300 text-sm focus:border-indigo-500 focus:ring-indigo-500 shadow-sm resize-none" placeholder="Notes de l'auteur sur son passé, motivations...">${char.notes || ''}</textarea>
            `;
            const notesTextarea = notesDiv.querySelector('#char-notes');
            notesTextarea.addEventListener('input', (e) => {
                char.notes = e.target.value;
                triggerAutoSave();
            });
            container.appendChild(notesDiv);
        }

        // Helper to escape HTML characters securely
        function escapeHtml(str) {
            if (!str) return '';
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        // WORD COUNTERS UPDATES
        function updateEditorWordsCount(text) {
            if (text === undefined) {
                const el = document.getElementById('editor-content');
                text = el ? (el.innerText || "") : "";
            }
            const cleanText = text.trim();
            const words = cleanText ? cleanText.split(/\s+/).length : 0;
            const chars = text.length;

            document.getElementById('editor-words-count').innerText = formatTranslation("words_count", { words });
            document.getElementById('editor-chars-count').innerText = formatTranslation("chars_count", { chars });
        }

        // WORD GOALS & PROGRESS UPDATE
        function updateRightSidebar() {
            // Recompute overall written word count
            let totalWords = 0;
            projectData.manuscript.forEach(chap => {
                chap.children.forEach(scene => {
                    const cleanText = (scene.content || "").trim();
                    if (cleanText) {
                        totalWords += cleanText.split(/\s+/).length;
                    }
                });
            });

            projectData.settings.overall_written = totalWords;

            const dailyGoal = projectData.settings.daily_goal || 500;
            const overallGoal = projectData.settings.overall_goal || 50000;
            const dailyWritten = Math.min(dailyGoal, totalWords); // simplified simulation

            // Update inputs and sliders
            document.getElementById('daily-goal-input').value = dailyGoal;

            // Update text elements
            document.getElementById('daily-progress-text').innerText = formatTranslation("daily_progress", { written: dailyWritten, goal: dailyGoal });
            document.getElementById('overall-progress-text').innerText = formatTranslation("overall_progress", { written: totalWords, goal: overallGoal });

            // Update bars
            const dailyPct = Math.min(100, (dailyWritten / dailyGoal) * 100);
            const overallPct = Math.min(100, (totalWords / overallGoal) * 100);

            document.getElementById('daily-progress-bar').style.width = `${dailyPct}%`;
            document.getElementById('overall-progress-bar').style.width = `${overallPct}%`;
        }

        function onDailyGoalChange(val) {
            projectData.settings.daily_goal = parseInt(val) || 500;
            updateRightSidebar();
            persistProject();
        }

        // ADDING NODES (CHAPTERS / SCENES / ASSETS)
        function generateId(prefix) {
            return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
        }

        // DATASET FOR SPECIAL CHAPTER TYPES
        const CHAPTER_TYPES = {
            "page_titre": {
                emoji: "📝",
                category: "liminaires",
                title_fr: "Page de titre",
                title_en: "Title Page",
                desc_fr: "Titre + sous-titre + auteur",
                desc_en: "Title + subtitle + author",
                default_title_fr: "Page de Titre",
                default_title_en: "Title Page",
                template_fr: "[TITRE DU ROMAN]\n[SOUS-TITRE (OPTIONNEL)]\n\n\nÉcrit par [NOM DE L'AUTEUR]",
                template_en: "[NOVEL TITLE]\n[SUBTITLE (OPTIONAL)]\n\n\nWritten by [AUTHOR NAME]"
            },
            "copyright": {
                emoji: "⚖️",
                category: "liminaires",
                title_fr: "Page de copyright / mentions légales",
                title_en: "Copyright Page / Legal notes",
                desc_fr: "Droits d'auteur, ISBN, année, maison d'édition",
                desc_en: "Copyright, ISBN, year, publisher",
                default_title_fr: "Copyright",
                default_title_en: "Copyright",
                template_fr: "© [ANNÉE] [NOM DE L'AUTEUR]. Tous droits réservés.\n\nISBN : [ISBN-13]\nMaison d'édition : [NOM DE LA MAISON D'ÉDITION]\n\nAucune partie de ce livre ne peut être reproduite ou transmise sous quelque forme ou par quelque moyen que ce soit, électronique ou mécanique, y compris la photocopie, l'enregistrement ou par tout système de stockage et de récupération d'informations, sans l'autorisation écrite de l'auteur.",
                template_en: "© [YEAR] [AUTHOR NAME]. All rights reserved.\n\nISBN: [ISBN-13]\nPublisher: [PUBLISHER NAME]\n\nNo part of this book may be reproduced or transmitted in any form or by any means, electronic or mechanical, including photocopying, recording, or by any information storage and retrieval system, without written permission from the author."
            },
            "dedicace": {
                emoji: "💝",
                category: "liminaires",
                title_fr: "Dédicace",
                title_en: "Dedication",
                desc_fr: "Citation ou hommage personnel en ouverture",
                desc_en: "Opening quote or personal tribute",
                default_title_fr: "Dédicace",
                default_title_en: "Dedication",
                template_fr: "À [Nom de la personne],\n\n[Votre dédicace personnelle ici, par exemple : pour m'avoir toujours soutenu et inspiré tout au long de cette aventure.]",
                template_en: "To [Person's Name],\n\n[Your personal dedication here, e.g.: for always supporting and inspiring me throughout this journey.]"
            },
            "epigraphe": {
                emoji: "💬",
                category: "liminaires",
                title_fr: "Épigraphe",
                title_en: "Epigraph",
                desc_fr: "Citation en ouverture du livre",
                desc_en: "Citation in opening of the book",
                default_title_fr: "Épigraphe",
                default_title_en: "Epigraph",
                template_fr: "\"Le secret de commencer est de s'y mettre.\"\n— Mark Twain",
                template_en: "\"The secret of getting ahead is getting started.\"\n— Mark Twain"
            },
            "preface": {
                emoji: "✍️",
                category: "liminaires",
                title_fr: "Préface / Avant-propos",
                title_en: "Preface / Foreword",
                desc_fr: "Texte de présentation rédigé par l'auteur",
                desc_en: "Presentation text written by the author",
                default_title_fr: "Préface",
                default_title_en: "Preface",
                template_fr: "PRÉFACE\n\n[Écrivez ici votre préface. Expliquez le contexte de l'œuvre, votre inspiration, les motivations qui vous ont poussé à écrire ce livre, ou tout message préalable à l'intention de vos lecteurs.]",
                template_en: "PREFACE\n\n[Write your preface here. Explain the context of the work, your inspiration, the motivations that drove you to write this book, or any introductory message for your readers.]"
            },
            "preambule": {
                emoji: "🌌",
                category: "liminaires",
                title_fr: "Préambule",
                title_en: "Preamble",
                desc_fr: "Texte court posant l'univers ou un événement antérieur",
                desc_en: "Short text setting up the universe or prior event",
                default_title_fr: "Préambule",
                default_title_en: "Preamble",
                template_fr: "PRÉAMBULE\n\n[Le préambule présente brièvement l'univers ou un événement marquant survenu antérieurement au début de l'intrigue principale.]",
                template_en: "PREAMBLE\n\n[The preamble briefly introduces the universe or a significant event that occurred prior to the start of the main plot.]"
            },
            "introduction": {
                emoji: "📘",
                category: "liminaires",
                title_fr: "Introduction",
                title_en: "Introduction",
                desc_fr: "Surtout pour la non-fiction ou romans littéraires",
                desc_en: "Mainly for non-fiction or literary novels",
                default_title_fr: "Introduction",
                default_title_en: "Introduction",
                template_fr: "INTRODUCTION\n\n[Introduction générale posant les thèmes majeurs du roman, particulièrement adapté pour la non-fiction ou les œuvres littéraires complexes.]",
                template_en: "INTRODUCTION\n\n[General introduction establishing the major themes of the book, particularly suitable for non-fiction or complex literary works.]"
            },
            "table_matieres": {
                emoji: "📊",
                category: "liminaires",
                title_fr: "Table des matières",
                title_en: "Table of Contents",
                desc_fr: "Générée automatiquement lors de l'export final",
                desc_en: "Automatically generated during final export",
                default_title_fr: "Table des Matières",
                default_title_en: "Table of Contents",
                template_fr: "TABLE DES MATIÈRES (GÉNÉRÉE AUTOMATIQUEMENT)\n\n[La table des matières sera générée dynamiquement lors de la publication ou de l'export final.]",
                template_en: "TABLE OF CONTENTS (AUTOMATICALLY GENERATED)\n\n[The table of contents will be generated dynamically during publication or final export.]"
            },
            "prologue": {
                emoji: "🎬",
                category: "corps",
                title_fr: "Prologue",
                title_en: "Prologue",
                desc_fr: "Scène d'ouverture se passant avant l'histoire principale",
                desc_en: "Opening scene taking place before the main story",
                default_title_fr: "Prologue",
                default_title_en: "Prologue",
                template_fr: "PROLOGUE\n\n[Scène d'ouverture se déroulant généralement avant le début de l'intrigue principale, posant une ambiance dramatique ou un événement fondateur.]",
                template_en: "PROLOGUE\n\n[Opening scene usually taking place before the main plot starts, setting a dramatic mood or seminal event.]"
            },
            "chapitre_ouverture": {
                emoji: "🔑",
                category: "corps",
                title_fr: "Chapitre d'ouverture / Incipit",
                title_en: "Opening Chapter / Incipit",
                desc_fr: "Premier chapitre posant le protagoniste et la situation",
                desc_en: "First chapter setting up protagonist and initial situation",
                default_title_fr: "Chapitre d'ouverture",
                default_title_en: "Opening Chapter",
                template_fr: "[Entrez ici le texte de votre scène d'ouverture. L'incipit a pour but de capter l'intérêt du lecteur, d'introduire le protagoniste et de poser les bases de la situation initiale.]",
                template_en: "[Enter your opening scene text here. The incipit aims to capture reader interest, introduce the protagonist, and establish the initial situation.]"
            },
            "chapitre_standard": {
                emoji: "📖",
                category: "corps",
                title_fr: "Chapitre",
                title_en: "Chapter",
                desc_fr: "Le cœur et le corps principal du roman",
                desc_en: "The heart and main body of the novel",
                default_title_fr: "Chapitre",
                default_title_en: "Chapter",
                template_fr: "[Entrez ici le texte de votre scène. Développez l'intrigue, les dialogues et les péripéties de vos personnages.]",
                template_en: "[Enter your scene text here. Develop the plot, dialogue, and adventures of your characters.]"
            },
            "epilogue": {
                emoji: "🏁",
                category: "finales",
                title_fr: "Épilogue",
                title_en: "Epilogue",
                desc_fr: "Scène finale après la résolution de l'intrigue",
                desc_en: "Final scene after the resolution of the plot",
                default_title_fr: "Épilogue",
                default_title_en: "Epilogue",
                template_fr: "ÉPILOGUE\n\n[Scène de clôture se déroulant après la résolution de l'intrigue, montrant l'avenir des personnages ou offrant une conclusion finale à l'histoire.]",
                template_en: "EPILOGUE\n\n[Closing scene taking place after plot resolution, showing the characters' future or offering a final conclusion to the story.]"
            },
            "remerciements": {
                emoji: "🙏",
                category: "finales",
                title_fr: "Remerciements",
                title_en: "Acknowledgments",
                desc_fr: "Remerciements à votre entourage et relecteurs",
                desc_en: "Thanks to helpers, family and editors",
                default_title_fr: "Remerciements",
                default_title_en: "Acknowledgments",
                template_fr: "REMERCIEMENTS\n\n[Prenez un moment pour remercier les personnes qui vous ont aidé à concevoir, écrire, corriger et publier ce roman (famille, amis, relecteurs, bêta-lecteurs, éditeurs, etc.).]",
                template_en: "ACKNOWLEDGMENTS\n\n[Take a moment to thank the people who helped you design, write, edit, and publish this book (family, friends, editors, beta readers, etc.).]"
            },
            "biographie_auteur": {
                emoji: "🧑‍💻",
                category: "finales",
                title_fr: "Biographie de l'auteur",
                title_en: "Author Biography",
                desc_fr: "Présentation de l'auteur et de ses œuvres",
                desc_en: "Brief presentation of the author and works",
                default_title_fr: "Biographie de l'Auteur",
                default_title_en: "About the Author",
                template_fr: "À PROPOS DE L'AUTEUR\n\n[Écrivez une brève notice biographique. Présentez votre parcours, vos autres œuvres, vos passions et comment les lecteurs peuvent vous suivre ou vous contacter.]",
                template_en: "ABOUT THE AUTHOR\n\n[Write a brief biographical note. Present your background, other works, passions, and how readers can follow or contact you.]"
            },
            "notes_auteur": {
                emoji: "📝",
                category: "finales",
                title_fr: "Notes de l'auteur",
                title_en: "Author Notes",
                desc_fr: "Explications, sources documentaires ou historiques",
                desc_en: "Explanations, documentary or historical sources",
                default_title_fr: "Notes de l'Auteur",
                default_title_en: "Author Notes",
                template_fr: "NOTES DE L'AUTEUR\n\n[Fournissez ici des explications complémentaires, des sources historiques ou de recherche, ou des détails sur les choix artistiques effectués durant l'écriture.]",
                template_en: "AUTHOR NOTES\n\n[Provide additional explanations, historical or research sources, or details about artistic choices made during writing.]"
            },
            "glossaire": {
                emoji: "🔤",
                category: "finales",
                title_fr: "Glossaire",
                title_en: "Glossary",
                desc_fr: "Pour les univers imaginaires, fantasy, SF ou historiques",
                desc_en: "For fictional, fantasy, sci-fi or historical lore",
                default_title_fr: "Glossaire",
                default_title_en: "Glossary",
                template_fr: "GLOSSAIRE\n\nTerme 1 : Définition ou explication du terme dans votre univers.\nTerme 2 : Définition ou explication...",
                template_en: "GLOSSARY\n\nTerm 1: Definition or explanation of the term in your universe.\nTerm 2: Definition or explanation..."
            },
            "annexes": {
                emoji: "🗺️",
                category: "finales",
                title_fr: "Annexes",
                title_en: "Appendices",
                desc_fr: "Cartes, arbres généalogiques, chronologie",
                desc_en: "Maps, family trees, detailed chronologies",
                default_title_fr: "Annexes",
                default_title_en: "Appendices",
                template_fr: "ANNEXES\n\n[Ajoutez ici des éléments complémentaires pour enrichir votre œuvre : chronologies détaillées, arbres généalogiques décrits, listes de dynasties ou descriptions de documents fictifs.]",
                template_en: "APPENDICES\n\n[Add supplementary elements to enrich your work here: detailed timelines, family trees, list of dynasties, or fictional document descriptions.]"
            },
            "index": {
                emoji: "🔍",
                category: "finales",
                title_fr: "Index",
                title_en: "Index",
                desc_fr: "Index alphabétique (rare en pure fiction)",
                desc_en: "Alphabetical index of terms (rare in pure fiction)",
                default_title_fr: "Index",
                default_title_en: "Index",
                template_fr: "INDEX\n\n[Index alphabétique des notions clés ou des personnages importants.]",
                template_en: "INDEX\n\n[Alphabetical index of key terms or important characters.]"
            },
            "teaser": {
                emoji: "🔥",
                category: "finales",
                title_fr: "Teaser / Extrait du prochain tome",
                title_en: "Teaser / Next Volume Extract",
                desc_fr: "Extrait exclusif pour fidéliser vos lecteurs",
                desc_en: "Exclusive extract to hook your readers",
                default_title_fr: "Teaser - Prochain Tome",
                default_title_en: "Teaser - Next Book",
                template_fr: "EXTRAIT EXCLUSIF DU TOME SUIVANT\n\n[Insérez ici les premières lignes ou un chapitre d'accroche de votre prochain roman pour donner envie aux lecteurs de lire la suite de votre série.]",
                template_en: "EXCLUSIVE EXTRACT FROM NEXT VOLUME\n\n[Insert the first lines or hook chapter of your next novel here to entice readers to follow your series.]"
            }
        };

        let activeChapterCategory = "liminaires";

        window.openChapterTypeModal = function openChapterTypeModal() {
            const modal = document.getElementById('chapter-type-modal');
            modal.classList.remove('hidden');

            // Make sure the close buttons are visible again in case they were hidden by createNewProject
            modal.removeAttribute('data-uncancelable');
            const closeBtns = modal.querySelectorAll('button[onclick="closeChapterTypeModal()"]');
            closeBtns.forEach(btn => btn.style.display = '');

            selectChapterCategory('liminaires');
        }

        window.closeChapterTypeModal = function closeChapterTypeModal() {
            document.getElementById('chapter-type-modal').classList.add('hidden');
        }

        function selectChapterCategory(category) {
            activeChapterCategory = category;

            // Highlight active tab
            const categories = ['liminaires', 'corps', 'finales'];
            categories.forEach(cat => {
                const tab = document.getElementById(`tab-category-${cat}`);
                if (cat === category) {
                    tab.className = "flex-1 py-1.5 rounded-md font-semibold transition-all bg-white text-slate-800 shadow-xs";
                } else {
                    tab.className = "flex-1 py-1.5 rounded-md font-semibold transition-all text-slate-500 hover:text-slate-800";
                }
            });

            // Render the grid of cards
            const grid = document.getElementById('chapter-cards-grid');
            grid.innerHTML = "";

            Object.keys(CHAPTER_TYPES).forEach(key => {
                const item = CHAPTER_TYPES[key];
                if (item.category !== category) return;

                const title = window.activeLang === 'fr' ? item.title_fr : item.title_en;
                const desc = window.activeLang === 'fr' ? item.desc_fr : item.desc_en;

                const card = document.createElement('div');
                card.className = "flex items-start space-x-3 p-3 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg cursor-pointer transition-all";
                card.onclick = () => createSpecialChapter(key);

                card.innerHTML = `
                    <span class="text-2xl shrink-0">${item.emoji}</span>
                    <div class="min-w-0">
                        <h4 class="text-xs font-bold text-slate-800">${title}</h4>
                        <p class="text-[10px] text-slate-500 mt-0.5 leading-tight">${desc}</p>
                    </div>
                `;
                grid.appendChild(card);
            });
        }

        window.createSpecialChapter = async function createSpecialChapter(subType) {
            const item = CHAPTER_TYPES[subType];
            if (!item) return;

            const isFr = (window.activeLang === 'fr');

            // Generate customized Title
            let defaultTitle = isFr ? item.default_title_fr : item.default_title_en;
            if (subType === "chapitre_standard" || subType === "chapitre_ouverture" || subType === "chapter") {
                const count = projectData.manuscript.filter(c => c.subType === "chapitre_standard" || c.subType === "chapitre_ouverture" || c.subType === "chapter").length + 1;
                defaultTitle = `${defaultTitle} ${count}`;
            }

            const newChap = {
                id: generateId("chap"),
                type: "chapter",
                subType: subType,
                title: defaultTitle,
                children: []
            };

            // Create initial scene containing formatted content template
            const defaultSceneTitle = isFr ? item.default_title_fr : item.default_title_en;
            const contentTemplate = isFr ? item.template_fr : item.template_en;

            const newScene = {
                id: generateId("scene"),
                type: "scene",
                title: defaultSceneTitle,
                content: contentTemplate
            };

            newChap.children.push(newScene);
            projectData.manuscript.push(newChap);

            renderTree();
            selectScene(newScene.id);
            await persistProject();
            const chapterTypeModal = document.getElementById('chapter-type-modal');
            const shouldReload = chapterTypeModal && chapterTypeModal.getAttribute('data-uncancelable') === 'true';

            closeChapterTypeModal();

            if (shouldReload) {
                window.location.reload();
            }
        }

        function addNewChapter() {
            openChapterTypeModal();
        }

        function addNewScene() {
            let parentChapId = null;

            // Use currently selected chapter if scene/chapter is selected
            if (activeNodeType === "chapter") {
                parentChapId = activeNodeId;
            } else if (activeNodeType === "scene") {
                // Find parent chapter
                for (const chap of projectData.manuscript) {
                    if (chap.children.some(s => s.id === activeNodeId)) {
                        parentChapId = chap.id;
                        break;
                    }
                }
            }

            // Fallback to last chapter
            if (!parentChapId && projectData.manuscript.length > 0) {
                parentChapId = projectData.manuscript[projectData.manuscript.length - 1].id;
            }

            if (!parentChapId) {
                // Create a chapter first if none exists
                addNewChapter();
                return;
            }

            const chap = findNodeById(parentChapId);
            const num = chap.children.length + 1;
            const newTitle = `${translations["new_scene_title"] || "New Scene"} ${num}`;
            const newScene = {
                id: generateId("scene"),
                type: "scene",
                title: newTitle,
                content: ""
            };
            chap.children.push(newScene);

            renderTree();
            selectScene(newScene.id);
            persistProject();
        }

        function showAssetMenu() {
            const dropdown = document.getElementById('asset-menu-dropdown');
            dropdown.classList.toggle('hidden');
        }

        function addNewCharacter() {
            document.getElementById('asset-menu-dropdown').classList.add('hidden');
            const num = projectData.characters.length + 1;
            const newChar = {
                id: generateId("char"),
                type: "personnage",
                name: `${translations["new_character_title"] || "New Character"} ${num}`,
                aliases: [],
                role: "Major Character",
                description: "",
                traits: [],
                appearance: "",
                notes: "",
                relations: [],
                linked_scenes: []
            };
            projectData.characters.push(newChar);

            renderTree();
            selectCharacter(newChar.id);
            persistProject();
        }

        function addNewNote() {
            document.getElementById('asset-menu-dropdown').classList.add('hidden');
            const num = projectData.story_notes.length + 1;
            const newNote = {
                id: generateId("note"),
                title: `${translations["new_note_title"] || "New Note"} ${num}`,
                type: "Location",
                content: ""
            };
            projectData.story_notes.push(newNote);

            renderTree();
            selectNote(newNote.id);
            persistProject();
        }


        // DELETING & RENAMING NODES
        async function deleteItem(id, type) {
            const confirmMsg = translations["confirm_delete"] || "Are you sure you want to delete this item?";
            if (!(await showConfirm(confirmMsg))) return;

            if (type === "chapter" || type === "scene") {
                deleteManuscriptNode(id, projectData.manuscript);
            } else if (type === "character") {
                projectData.characters = projectData.characters.filter(c => c.id !== id);
            } else if (type === "note") {
                projectData.story_notes = projectData.story_notes.filter(n => n.id !== id);
            }

            // Clean up active state if deleted item was selected
            if (activeNodeId === id) {
                activeNodeId = null;
                activeNodeType = null;
            }

            renderTree();
            loadFirstAvailableScene();
            persistProject();
        }

        function deleteManuscriptNode(id, list) {
            for (let i = 0; i < list.length; i++) {
                if (list[i].id === id) {
                    // Clean related plot cards if deleting a scene
                    if (list[i].type === "scene") {
                        projectData.plot.cards = projectData.plot.cards.filter(card => card.scene_id !== id);
                    }
                    list.splice(i, 1);
                    return true;
                }
                if (list[i].children) {
                    const deleted = deleteManuscriptNode(id, list[i].children);
                    if (deleted) return true;
                }
            }
            return false;
        }

        function renameItem(id, type) {
            const item = (type === "character") ? projectData.characters.find(c => c.id === id) :
                         (type === "note") ? projectData.story_notes.find(n => n.id === id) : findNodeById(id);

            if (!item) return;
            const nameField = (type === "character") ? "name" : "title";

            const newName = prompt("Rename / Renommer :", item[nameField]);
            if (newName && newName.trim()) {
                item[nameField] = newName.trim();
                renderTree();
                refreshActiveWorkspace();
                persistProject();
            }
        }

        function toggleExportDropdown(event) {
            event.stopPropagation();
            const menu = document.getElementById('export-dropdown-menu');
            if (menu) {
                menu.classList.toggle('hidden');
            }
        }

        // EXPORT THE ENTIRE NOVEL
        async function exportDraft(format = 'txt') {
            try {
                // Hide menu immediately
                const menu = document.getElementById('export-dropdown-menu');
                if (menu) {
                    menu.classList.add('hidden');
                }

                // Post save first to ensure we export latest
                await persistProject();

                try {
                    const bytes = await window.api_invoke('export_draft', { format });
                    const blob = new Blob([new Uint8Array(bytes)]);
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;

                    const cleanTitle = (projectData.settings.title || "roman").replace(/\s+/g, '_');
                    a.download = `${cleanTitle}_draft.${format}`;

                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                } catch (exportErr) {
                    alert("Export failed: " + exportErr);
                }
            } catch (err) {
                console.error("Export error:", err);
            }
        }

        function showGemmaInstalledModal() {
            const modal = document.getElementById('gemma-installed-modal');
            if (modal) {
                modal.classList.remove('hidden');
            }
        }

        // LANGUAGE CHANGE HANDLER
        async function changeLanguage(lang) {
            projectData.settings.lang = lang;
            localStorage.setItem('app-lang', lang);
            await loadLocale(lang);
            renderTree();
            updateRightSidebar();
            persistProject();
        }

        async function populateGemmaModels() {
            const selectEl = document.getElementById('settings-ai-model-input');
            if (!selectEl) return;

            selectEl.innerHTML = "";
            const activeModel = projectData.settings.ai_model || "llama3";

            try {
                const data = await window.api_invoke('ai_models');
                if (data.status === "success" && data.models && data.models.length > 0) {
                    data.models.forEach(modelName => {
                        const opt = document.createElement('option');
                        opt.value = modelName;
                        opt.textContent = modelName;
                        selectEl.appendChild(opt);
                    });

                    if (data.models.includes(activeModel)) {
                        selectEl.value = activeModel;
                    } else {
                        selectEl.value = data.models[0];
                    }
                    return;
                }
            } catch (err) {
                console.error("Failed to fetch Gemma models:", err);
            }

            const offlineText = window.activeLang === 'fr' ? " (Simulé / Hors ligne)" : " (Simulated / Offline)";
            const standardModels = [
                { value: "llama3", label: "Llama 3" },
                { value: "llama3.1", label: "Llama 3.1" },
                { value: "gemma2", label: "Gemma 2" },
                { value: "mistral", label: "Mistral" },
                { value: "phi3", label: "Phi 3" }
            ];

            standardModels.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.value;
                opt.textContent = m.label + offlineText;
                selectEl.appendChild(opt);
            });

            selectEl.value = activeModel;
        }

        // MODAL MANAGEMENT: SETTINGS
        async function openSettingsModal() {
            document.getElementById('settings-title-input').value = projectData.settings.title;
            document.getElementById('settings-goal-input').value = projectData.settings.overall_goal;
            document.getElementById('settings-lock-input').checked = !!projectData.settings.locked;
            document.getElementById('settings-disable-ads-input').checked = !!projectData.settings.disable_ads;

            // Set Layout/Typography values
            if (!projectData.settings.editor_layout) {
                projectData.settings.editor_layout = {
                    font_family: "Georgia, serif",
                    font_size: "12pt",
                    line_spacing: "1.6",
                    text_align: "left"
                };
            }
            const layout = projectData.settings.editor_layout;
            document.getElementById('settings-layout-font').value = layout.font_family || "Georgia, serif";
            document.getElementById('settings-layout-size').value = layout.font_size || "12pt";
            document.getElementById('settings-layout-spacing').value = layout.line_spacing || "1.6";
            document.getElementById('settings-layout-align').value = layout.text_align || "left";

            // Set AI values
            const aiTemp = (projectData.settings.ai_temperature !== undefined) ? projectData.settings.ai_temperature : 0.7;
            document.getElementById('settings-ai-temp-input').value = aiTemp;
            document.getElementById('settings-ai-temp-display').innerText = parseFloat(aiTemp).toFixed(1);

            await populateGemmaModels();

            document.getElementById('settings-ai-context-input').checked = (projectData.settings.inject_lore_context !== undefined) ? !!projectData.settings.inject_lore_context : true;

            // Set Backup / Auto-Save values
            if (!projectData.settings.backup_config) {
                projectData.settings.backup_config = {
                    folder_path: localStorage.getItem('backup-local-path') || '',
                    frequency: "daily"
                };
            }
            document.getElementById('settings-backup-path').value = projectData.settings.backup_config.folder_path || '';
            document.getElementById('settings-backup-frequency').value = projectData.settings.backup_config.frequency || 'daily';

            document.getElementById('settings-modal').classList.remove('hidden');
        }

        // CLOSE NOVEL SETTINGS MODAL
        function closeSettingsModal() {
            document.getElementById('settings-modal').classList.add('hidden');
        }

        // SAVE NOVEL SETTINGS
        async function saveProjectSettings() {
            const oldTitle = projectData.settings.title;
            const newTitle = document.getElementById('settings-title-input').value.trim();
            projectData.settings.title = newTitle || oldTitle;
            projectData.settings.overall_goal = parseInt(document.getElementById('settings-goal-input').value) || 50000;
            projectData.settings.locked = document.getElementById('settings-lock-input').checked;
            projectData.settings.disable_ads = document.getElementById('settings-disable-ads-input').checked;

            // Read Layout/Typography values
            if (!projectData.settings.editor_layout) {
                projectData.settings.editor_layout = {};
            }
            projectData.settings.editor_layout.font_family = document.getElementById('settings-layout-font').value;
            projectData.settings.editor_layout.font_size = document.getElementById('settings-layout-size').value;
            projectData.settings.editor_layout.line_spacing = document.getElementById('settings-layout-spacing').value;
            projectData.settings.editor_layout.text_align = document.getElementById('settings-layout-align').value;

            // Read AI values
            projectData.settings.ai_temperature = parseFloat(document.getElementById('settings-ai-temp-input').value);
            projectData.settings.ai_model = document.getElementById('settings-ai-model-input').value.trim() || "llama3";
            projectData.settings.inject_lore_context = document.getElementById('settings-ai-context-input').checked;

            // Read Backup / Auto-Save values
            if (!projectData.settings.backup_config) {
                projectData.settings.backup_config = {};
            }
            const backupPath = document.getElementById('settings-backup-path').value.trim();
            const backupFreq = document.getElementById('settings-backup-frequency').value;
            projectData.settings.backup_config.folder_path = backupPath;
            projectData.settings.backup_config.frequency = backupFreq;

            if (backupPath) {
                localStorage.setItem('backup-local-path', backupPath);
            }

            closeSettingsModal();
            renderTree();
            applyEditorLayoutSettings();
            updateRightSidebar();
            await persistProject();

            // Apply locking restrictions frontend
            applyLockState();

            // Reload list to update titles in selector
            await loadProjectsList();
        }

        window.triggerDirectoryPicker = async function() {
            try {
                const res = await fetch('/api/backups/choose_directory', {
                    method: 'POST'
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === "success" || data.status === "headless_fallback") {
                        if (data.folder_path) {
                            const input = document.getElementById('settings-backup-path');
                            if (input) {
                                input.value = data.folder_path;
                                // Save path immediately
                                localStorage.setItem('backup-local-path', data.folder_path);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to trigger directory picker:", err);
            }
        };

        // DELETE CURRENT NOVEL
        async function deleteCurrentProject() {
            const select = document.getElementById('project-select');
            const filename = select.value;

            if (filename === "le_comte_de_monte_cristo.json" || filename === "le_cid_corneille.json") {
                alert(translations["error_delete_default"] || "Default example projects cannot be deleted.");
                return;
            }

            const confirmMsg = translations["confirm_delete_novel"] || "Are you sure you want to permanently delete this novel?";
            if (!(await showConfirm(confirmMsg))) return;

            try {
                isSavingDisabled = true;
                projectData = null; // Prevent auto-save from overriding the newly switched project
                if (autoSaveTimer) clearTimeout(autoSaveTimer);

                await window.api_invoke('delete_project', { filename });
                closeSettingsModal();
                activeNodeId = null;
                activeNodeType = null;
                await loadProjectsList();
                await loadProject();
            } catch (err) {
                alert("Failed to delete project.");
                console.error("Error deleting project:", err);
            } finally {
                isSavingDisabled = false;
            }
        }

        // MODAL MANAGEMENT: ABOUT
        function openAboutModal() {
            document.getElementById('about-modal').classList.remove('hidden');
        }
        function closeAboutModal() {
            document.getElementById('about-modal').classList.add('hidden');
        }

        window.checkUpdatesOnStartup = async function checkUpdatesOnStartup() {
            try {
                const data = await window.api_invoke("check_updates");

                const updateContainer = document.getElementById('update-container');
                const aboutText = document.querySelector('[data-i18n="about_text"]');

                // Update version text
                if (aboutText && data.current_version) {
                    let text = formatTranslation('about_text');
                    aboutText.innerHTML = text.replace('v1.0', 'v' + data.current_version);
                }

                if (data.update_available) {
                    updateContainer.classList.remove('hidden');
                    updateContainer.classList.add('bg-blue-50', 'border-blue-200');
                    updateContainer.innerHTML = `
                        <div class="font-bold text-blue-800 mb-2">🎉 ${formatTranslation('update_available_title')} (v${data.latest_version})</div>
                        <a href="${data.download_url}" target="_blank" class="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-sm transition-colors text-xs font-semibold mb-2 w-full">
                            ⬇️ ${formatTranslation('update_download_btn')}
                        </a>
                        <a href="${data.release_page}" target="_blank" class="text-blue-600 hover:underline text-xs block">
                            ${formatTranslation('update_release_notes')}
                        </a>
                    `;
                    // Show about modal automatically on startup if update is available
                    openAboutModal();
                } else {
                    updateContainer.classList.remove('hidden');
                    updateContainer.classList.add('bg-green-50', 'border-green-200');
                    updateContainer.innerHTML = `
                        <div class="text-green-700 font-semibold text-sm">✅ ${formatTranslation('update_up_to_date')}</div>
                    `;
                }
            } catch (e) {
                console.error("Error checking for updates:", e);
            }
        }


        // --- ANNOTATIONS SYSTEM ---
        let activeAnnotationSpan = null;
        let annotationTooltipTimeout = null;

        document.addEventListener('mouseover', function(e) {
            const span = e.target.closest('.annotation-highlight');
            const tooltip = document.getElementById('annotation-tooltip');

            if (span && tooltip) {
                if (annotationTooltipTimeout) {
                    clearTimeout(annotationTooltipTimeout);
                    annotationTooltipTimeout = null;
                }

                activeAnnotationSpan = span;
                const rect = span.getBoundingClientRect();

                // Use cached annotations from renderTree if available, else fallback
                let allAnnotationsIds = [];
                if (window.globalAnnotationsCache) {
                    allAnnotationsIds = window.globalAnnotationsCache.map(a => a.id);
                } else if (projectData && projectData.manuscript) {
                    projectData.manuscript.forEach(chap => {
                        if (chap.children) {
                            chap.children.forEach(scene => {
                                if (scene.content) {
                                    const tempDiv = document.createElement('div');
                                    tempDiv.innerHTML = scene.content;
                                    const spans = tempDiv.querySelectorAll('.annotation-highlight');
                                    spans.forEach(s => {
                                        let annoId = s.getAttribute('data-annotation-id');
                                        if (annoId) {
                                            allAnnotationsIds.push(annoId);
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
                const currentAnnoId = span.getAttribute('data-annotation-id');
                const annoIndex = allAnnotationsIds.indexOf(currentAnnoId) + 1;
                const totalAnnos = allAnnotationsIds.length;

                const tooltipTitle = document.getElementById('annotation-tooltip-title');
                if (tooltipTitle && annoIndex > 0) {
                    tooltipTitle.innerHTML = `<span>✍️</span> <span>Annotation ${annoIndex}/${totalAnnos}</span>`;
                } else if (tooltipTitle) {
                    tooltipTitle.innerHTML = `<span>✍️</span> <span data-i18n="annotation_title">Annotation</span>`;
                }

                // Show tooltip and position it below the span
                tooltip.classList.remove('hidden');
                tooltip.style.opacity = '1';

                // Position calculation (with scroll offsets)
                const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

                tooltip.style.left = (rect.left + scrollLeft + rect.width / 2 - tooltip.offsetWidth / 2) + 'px';
                tooltip.style.top = (rect.bottom + scrollTop + 6) + 'px';

                // Set textarea content
                const textarea = document.getElementById('annotation-textarea');
                if (textarea) {
                    textarea.value = span.getAttribute('data-annotation') || '';
                }
            } else if (e.target.closest('#annotation-tooltip')) {
                if (annotationTooltipTimeout) {
                    clearTimeout(annotationTooltipTimeout);
                    annotationTooltipTimeout = null;
                }
            }
        });

        document.addEventListener('mouseout', function(e) {
            const span = e.target.closest('.annotation-highlight');
            const tooltip = e.target.closest('#annotation-tooltip');

            if (span || tooltip) {
                // Delay hiding to allow moving mouse between span and tooltip
                if (annotationTooltipTimeout) clearTimeout(annotationTooltipTimeout);
                annotationTooltipTimeout = setTimeout(function() {
                    closeAnnotationTooltip();
                }, 300);
            }
        });

        window.closeAnnotationTooltip = function() {
            const tooltip = document.getElementById('annotation-tooltip');
            if (tooltip) {
                tooltip.style.opacity = '0';
                setTimeout(() => {
                    if (tooltip.style.opacity === '0') {
                        tooltip.classList.add('hidden');
                    }
                }, 200);
            }
            activeAnnotationSpan = null;
        };

        window.saveAnnotation = function() {
            const textarea = document.getElementById('annotation-textarea');
            if (activeAnnotationSpan && textarea) {
                activeAnnotationSpan.setAttribute('data-annotation', textarea.value.trim());

                // Trigger editor input to save to projectData / database
                const editor = document.getElementById('editor-content');
                if (editor) {
                    onCombinedEditorInput(null, null);
                }
                closeAnnotationTooltip();
                renderTree();
            }
        };

        window.deleteAnnotation = function() {
            if (activeAnnotationSpan) {
                // Unwrap the span, keeping its HTML contents (like <br> tags) intact
                while (activeAnnotationSpan.firstChild) {
                    activeAnnotationSpan.parentNode.insertBefore(activeAnnotationSpan.firstChild, activeAnnotationSpan);
                }
                activeAnnotationSpan.parentNode.removeChild(activeAnnotationSpan);

                // Trigger editor input to save to projectData / database
                const editor = document.getElementById('editor-content');
                if (editor) {
                    onCombinedEditorInput(null, null);
                }
                closeAnnotationTooltip();
                renderTree();
            }
        };

        window.toggleAnnotationSize = function(e) {
            if (e) {
                e.stopPropagation();
                e.preventDefault();
            }
            const tooltip = document.getElementById('annotation-tooltip');
            const textarea = document.getElementById('annotation-textarea');
            if (tooltip && textarea) {
                const isLarge = tooltip.classList.contains('w-[450px]');
                if (isLarge) {
                    tooltip.classList.remove('w-[450px]');
                    tooltip.classList.add('w-72');
                    textarea.style.height = '80px';
                } else {
                    tooltip.classList.remove('w-72');
                    tooltip.classList.add('w-[450px]');
                    textarea.style.height = '180px';
                }
            }
        };

        // --- RELECTURE MODAL CONTROL LOGIC ---
        let activeRelectureCategory = "repetitions";
        let activeRelectureScope = "scene";

        function openRelectureModal() {
            if (!activeNodeId || activeNodeType !== "scene") {
                alert(window.activeLang === 'fr' ? "Veuillez sélectionner une scène du manuscrit pour ouvrir l'Atelier de Relecture." : "Please select a manuscript scene to open the Proofreading Workshop.");
                return;
            }

            // Show modal
            document.getElementById('relecture-modal').classList.remove('hidden');

            // Set active scene title
            const activeNode = findNodeById(activeNodeId);
            document.getElementById('relecture-active-scene-title').innerText = activeNode ? activeNode.title : "-";

            // Default scope and category
            activeRelectureScope = "scene";
            document.getElementById('relecture-scope-select').value = "scene";
            selectRelectureCategory(activeRelectureCategory || 'repetitions');

            // Run stats and repetitions calculations
            updateRelectureStatsAndPanes();
        }

        function closeRelectureModal() {
            document.getElementById('relecture-modal').classList.add('hidden');
        }

        function changeRelectureScope(scope) {
            activeRelectureScope = scope;
            // Hide synonym list when scope changes
            const container = document.getElementById('relecture-repetition-synonyms-container');
            if (container) container.classList.add('hidden');
            updateRelectureStatsAndPanes();
        }

        function getChapterText() {
            const chapter = findParentChapter(activeNodeId);
            if (!chapter || !chapter.children) return "";
            return chapter.children.map(scene => scene.content || "").join("\n\n");
        }
        // POMODORO TIMER MANAGEMENT
        function onTimerSlider(val) {
            timerDurationMinutes = val;
            timerSecondsLeft = val * 60;
            updateTimerDisplay();
        }

        function updateTimerDisplay() {
            const mins = Math.floor(timerSecondsLeft / 60);
            const secs = timerSecondsLeft % 60;
            document.getElementById('timer-display').innerText =
                `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        function toggleTimer() {
            const startBtn = document.getElementById('timer-start-btn');

            if (timerIsRunning) {
                // Pause timer
                clearInterval(timerIntervalId);
                timerIsRunning = false;
                startBtn.innerText = translations["start"] || "Start";
                startBtn.className = "flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-1.5 px-2 rounded-lg shadow-sm transition-all";
            } else {
                // Start timer
                timerIsRunning = true;
                startBtn.innerText = translations["pause"] || "Pause";
                startBtn.className = "flex-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-1.5 px-2 rounded-lg shadow-sm transition-all";

                timerIntervalId = setInterval(() => {
                    if (timerSecondsLeft > 0) {
                        timerSecondsLeft--;
                        updateTimerDisplay();
                    } else {
                        // Timer completed!
                        clearInterval(timerIntervalId);
                        timerIsRunning = false;
                        startBtn.innerText = translations["start"] || "Start";
                        startBtn.className = "flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-1.5 px-2 rounded-lg shadow-sm transition-all";
                        alert("Focus session completed! Take a short break! ☕");
                        resetTimer();
                    }
                }, 1000);
            }
        }

        function resetTimer() {
            clearInterval(timerIntervalId);
            timerIsRunning = false;
            timerSecondsLeft = timerDurationMinutes * 60;
            updateTimerDisplay();

            const startBtn = document.getElementById('timer-start-btn');
            startBtn.innerText = translations["start"] || "Start";
            startBtn.className = "flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-1.5 px-2 rounded-lg shadow-sm transition-all";
        }


        // PLOT GRID DYNAMIC RENDERING
        let currentEditingCard = null;

        function getScenesList() {
            const scenes = [];
            projectData.manuscript.forEach(chap => {
                chap.children.forEach(scene => {
                    scenes.push({
                        ...scene,
                        chapterTitle: chap.title,
                        chapterId: chap.id
                    });
                });
            });
            return scenes;
        }

        function renderPlotGrid() {
            const scenes = getScenesList();

            // Build headers (Column 1 is the Title Corner, then all Scenes)
            const headersRow = document.getElementById('plot-grid-headers');
            headersRow.innerHTML = `
                <th class="p-4 border border-slate-200/80 text-left bg-slate-100 font-bold text-slate-500 text-xs w-48" data-i18n="plot_lanes_scenes">Intrigues / Scènes</th>
                ${scenes.map((scene, index) => `
                    <th class="p-4 border border-slate-200/80 text-center bg-teal-50 text-teal-950 font-bold text-xs min-w-[180px] max-w-[200px]">
                        <div class="text-[10px] text-teal-700/70 uppercase tracking-wide truncate mb-1" title="${scene.chapterTitle || ''}">${scene.chapterTitle || ''}</div>
                        <div class="truncate" title="${scene.title}">${scene.title}</div>
                    </th>
                `).join('')}
            `;

            // Build body rows for each plotline
            const body = document.getElementById('plot-grid-body');
            body.innerHTML = "";

            projectData.plot.plotlines.forEach(plotline => {
                const tr = document.createElement('tr');

                // Plotline Title Cell
                let tdHtml = `
                    <td class="p-4 border border-slate-200/80 bg-purple-50/40 font-bold text-purple-950 text-sm align-middle">
                        <div class="font-georgia italic">${plotline.title}</div>
                    </td>
                `;

                // Render cell for each scene
                scenes.forEach(scene => {
                    const card = projectData.plot.cards.find(c => c.plotline_id === plotline.id && c.scene_id === scene.id);
                    const isLocked = !!(projectData && projectData.settings && projectData.settings.locked);

                    if (card) {
                        card.characters = card.characters || [];
                        let charactersHtml = "";
                        if (card.characters.length > 0) {
                            charactersHtml = `
                                <div class="flex flex-wrap gap-1 mt-1.5 pt-1 border-t border-indigo-100/40">
                                    ${card.characters.map(charId => {
                                        const ch = projectData.characters.find(c => c.id === charId);
                                        if (!ch) return "";
                                        return `
                                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-50 text-teal-800 border border-teal-100 max-w-[150px] truncate" title="${ch.name}">
                                                👤 ${ch.name}
                                            </span>
                                        `;
                                    }).join('')}
                                </div>
                            `;
                        }

                        tdHtml += `
                            <td class="p-3 border border-slate-200/80 align-top max-w-[200px]">
                                <div onclick="openPlotCardModal('${card.id}')" data-card-id="${card.id}" class="bg-indigo-50/50 hover:bg-indigo-50 border border-indigo-200 rounded-lg p-2.5 min-h-[96px] h-auto flex flex-col justify-between cursor-pointer shadow-xs transition-all select-none">
                                    <div>
                                        <div class="text-xs font-bold text-indigo-900 truncate mb-1" title="${card.title}">${card.title}</div>
                                        <div class="text-[11px] text-slate-500 line-clamp-3 leading-tight overflow-hidden">${card.content || "..."}</div>
                                    </div>
                                    ${charactersHtml}
                                </div>
                            </td>
                        `;
                    } else {
                        if (isLocked) {
                            tdHtml += `
                                <td class="p-3 border border-slate-200/80 align-middle max-w-[200px]">
                                    <div class="text-center text-slate-300 text-xs py-3">—</div>
                                </td>
                            `;
                        } else {
                            tdHtml += `
                                <td class="p-3 border border-slate-200/80 align-middle max-w-[200px]">
                                    <button onclick="addPlotCard('${plotline.id}', '${scene.id}')" class="w-full py-3 hover:bg-slate-50 border border-dashed border-slate-200 hover:border-slate-300 rounded-lg text-slate-400 hover:text-slate-600 text-xs font-medium transition-all" data-i18n="add_plot_card">
                                        + Ajouter carte
                                    </button>
                                </td>
                            `;
                        }
                    }
                });

                tr.innerHTML = tdHtml;
                body.appendChild(tr);
            });

            translateDOM();

            // Connect cards visually
            setTimeout(drawPlotConnections, 60);

            // Listen to grid scrolling or resizing to redraw connections
            const container = document.getElementById('plot-grid-table-container');
            if (container && !container.dataset.hasScrollListener) {
                container.dataset.hasScrollListener = "true";


                container.addEventListener('scroll', () => {
                    drawPlotConnections();
                });
                window.addEventListener('resize', () => {
                    if (activeNodeType === "plot_grid") {
                        drawPlotConnections();
                    }
                });
            }
        }

        function drawPlotConnections() {
            const canvas = document.getElementById('plot-grid-svg-canvas');
            const container = document.getElementById('plot-grid-table-container');
            if (!canvas || !container || activeNodeType !== "plot_grid" || activePlotSubView !== "grid") return;

            // Clear canvas
            canvas.innerHTML = "";

            // Ensure canvas dimensions match container scroll area
            const scrollWidth = container.scrollWidth;
            const scrollHeight = container.scrollHeight;
            canvas.setAttribute("width", scrollWidth);
            canvas.setAttribute("height", scrollHeight);
            canvas.style.width = scrollWidth + "px";
            canvas.style.height = scrollHeight + "px";

            const containerRect = container.getBoundingClientRect();

            // Setup marker definitions for arrowheads
            const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            defs.innerHTML = `
                <marker id="arrow" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#6366f1" />
                </marker>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#6366f1" flood-opacity="0.3" />
                </filter>
            `;
            canvas.appendChild(defs);

            const renderedCards = projectData.plot.cards || [];
            renderedCards.forEach(card => {
                const cardEl = container.querySelector(`[data-card-id="${card.id}"]`);
                if (!cardEl) return;

                const links = card.links || [];
                links.forEach(linkId => {
                    const targetCard = renderedCards.find(c => c.id === linkId);
                    if (!targetCard) return;

                    const targetEl = container.querySelector(`[data-card-id="${linkId}"]`);
                    if (!targetEl) return;

                    // Get positions relative to canvas/container
                    const rectA = cardEl.getBoundingClientRect();
                    const rectB = targetEl.getBoundingClientRect();

                    const x1 = rectA.left - containerRect.left + container.scrollLeft + rectA.width / 2;
                    const y1 = rectA.top - containerRect.top + container.scrollTop + rectA.height / 2;

                    const x2 = rectB.left - containerRect.left + container.scrollLeft + rectB.width / 2;
                    const y2 = rectB.top - containerRect.top + container.scrollTop + rectB.height / 2;

                    // Draw Bezier path
                    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

                    // Simple cubic bezier curve
                    const dx = Math.abs(x2 - x1);
                    const controlX1 = x1 + dx * 0.4 * (x2 > x1 ? 1 : -1);
                    const controlY1 = y1;
                    const controlX2 = x2 - dx * 0.4 * (x2 > x1 ? 1 : -1);
                    const controlY2 = y2;

                    const d = `M ${x1} ${y1} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${x2} ${y2}`;

                    path.setAttribute("d", d);
                    path.setAttribute("fill", "none");
                    path.setAttribute("stroke", "#6366f1");
                    path.setAttribute("stroke-width", "2");
                    path.setAttribute("stroke-dasharray", "4 4"); // dashed lines look beautiful and clean
                    path.setAttribute("marker-end", "url(#arrow)");
                    path.setAttribute("filter", "url(#glow)");
                    path.setAttribute("opacity", "0.75");

                    canvas.appendChild(path);
                });
            });
        }

        // SUB-VIEWS TOGGLING & TIMELINE RENDERING
        function setPlotSubView(subview) {
            activePlotSubView = subview;
            const gridTab = document.getElementById('plot-view-grid-tab');
            const timelineTab = document.getElementById('plot-view-timeline-tab');
            const gridContainer = document.getElementById('plot-grid-table-container');
            const timelineContainer = document.getElementById('plot-grid-timeline-container');

            if (subview === 'grid') {
                gridTab.classList.add('bg-white', 'text-slate-800', 'shadow-xs');
                gridTab.classList.remove('text-slate-600');
                timelineTab.classList.remove('bg-white', 'text-slate-800', 'shadow-xs');
                timelineTab.classList.add('text-slate-600');

                gridContainer.classList.remove('hidden');
                timelineContainer.classList.add('hidden');

                renderPlotGrid();

                if (gridContainer && !gridContainer.dataset.hasScrollListener) {
                    gridContainer.dataset.hasScrollListener = "true";
                    gridContainer.addEventListener('wheel', (e) => {
                        if (e.deltaY !== 0 && e.deltaX === 0) {
                            // Check if vertical scrolling is needed
                            const isAtTop = gridContainer.scrollTop === 0 && e.deltaY < 0;
                            const isAtBottom = gridContainer.scrollTop + gridContainer.clientHeight >= gridContainer.scrollHeight && e.deltaY > 0;

                            // Map to horizontal scroll if no vertical overflow, or at bounds
                            if (gridContainer.scrollHeight <= gridContainer.clientHeight || isAtTop || isAtBottom) {
                                const isAtLeft = gridContainer.scrollLeft === 0 && e.deltaY < 0;
                                const isAtRight = Math.ceil(gridContainer.scrollLeft + gridContainer.clientWidth) >= gridContainer.scrollWidth && e.deltaY > 0;

                                if (!isAtLeft && !isAtRight) {
                                    e.preventDefault();
                                    gridContainer.scrollLeft += e.deltaY;
                                }
                            }
                        }
                    }, { passive: false });
                }
            } else {
                timelineTab.classList.add('bg-white', 'text-slate-800', 'shadow-xs');
                timelineTab.classList.remove('text-slate-600');
                gridTab.classList.remove('bg-white', 'text-slate-800', 'shadow-xs');
                gridTab.classList.add('text-slate-600');

                gridContainer.classList.add('hidden');
                timelineContainer.classList.remove('hidden');

                renderPlotTimeline();
            }
        }

        function refreshPlotView() {
            if (activePlotSubView === "grid") {
                renderPlotGrid();
            } else {
                renderPlotTimeline();
            }
        }

        function renderPlotTimeline() {
            const flowContainer = document.getElementById('plot-timeline-flow');
            if (!flowContainer) return;

            flowContainer.innerHTML = "";

            const scenes = getScenesList();
            if (scenes.length === 0) {
                flowContainer.innerHTML = `
                    <div class="flex flex-col items-center justify-center p-12 bg-white rounded-xl border border-slate-200 text-center mx-auto">
                        <span class="text-4xl mb-2">📜</span>
                        <div class="text-slate-500 font-semibold" data-i18n="no_scenes_yet">Aucune scène disponible. Créez des chapitres et des scènes pour commencer !</div>
                    </div>
                `;
                return;
            }

            scenes.forEach((scene, index) => {
                const sceneCol = document.createElement('div');
                sceneCol.className = "flex flex-col items-center shrink-0 w-52";

                // 1. Scene header node (positioned at the top)
                let sceneHeaderHtml = `
                    <div class="px-4 py-2.5 bg-teal-600 text-white rounded-xl shadow-md text-xs font-bold text-center w-52 border border-teal-500/20 relative">
                        <div class="text-[9px] uppercase tracking-wider text-teal-100/80 truncate mb-1" title="${scene.chapterTitle || ''}">${scene.chapterTitle || ''}</div>
                        <div class="uppercase tracking-wider opacity-90">${window.activeLang === 'fr' ? 'Scène' : 'Scene'} ${index + 1}</div>
                        <div class="truncate text-sm font-georgia mt-0.5" title="${scene.title}">${scene.title}</div>
                        <div class="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-teal-600 text-white border-2 border-slate-100 rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-bold shadow-xs">↓</div>
                    </div>
                    <div class="w-0.5 h-10 bg-teal-300"></div>
                `;

                // 2. Stack of connected cards below the scene
                const cardsInScene = projectData.plot.cards.filter(c => c.scene_id === scene.id);
                let cardsStackHtml = `<div class="space-y-4 w-52">`;

                if (cardsInScene.length === 0) {
                    cardsStackHtml += `
                        <div class="bg-white border border-dashed border-slate-200 text-slate-400 rounded-xl p-4 text-center text-xs italic">
                            ${window.activeLang === 'fr' ? 'Aucune carte.' : 'No cards.'}
                        </div>
                    `;
                } else {
                    cardsInScene.forEach(card => {
                        const plotline = projectData.plot.plotlines.find(p => p.id === card.plotline_id);
                        const plotlineTitle = plotline ? plotline.title : '';

                        // Render characters
                        let charactersHtml = "";
                        card.characters = card.characters || [];
                        if (card.characters.length > 0) {
                            charactersHtml = `
                                <div class="flex flex-wrap gap-1 mt-2 pt-1.5 border-t border-slate-100/80">
                                    ${card.characters.map(charId => {
                                        const ch = projectData.characters.find(c => c.id === charId);
                                        if (!ch) return "";
                                        return `
                                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-50 text-teal-800 border border-teal-100 max-w-[150px] truncate" title="${ch.name}">
                                                👤 ${ch.name}
                                            </span>
                                        `;
                                    }).join('')}
                                </div>
                            `;
                        }

                        cardsStackHtml += `
                            <div onclick="openPlotCardModal('${card.id}')" data-timeline-card-id="${card.id}" class="bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl p-3 shadow-xs hover:shadow-md cursor-pointer transition-all flex flex-col justify-between min-h-[96px] h-auto relative group select-none">
                                <div>
                                    <div class="text-[9px] uppercase font-bold tracking-wider text-purple-600 mb-1">${plotlineTitle}</div>
                                    <div class="text-xs font-bold text-slate-800 line-clamp-2 mb-1 group-hover:text-indigo-600" title="${card.title}">${card.title}</div>
                                    <div class="text-[10px] text-slate-500 line-clamp-3 leading-snug overflow-hidden">${card.content || "..."}</div>
                                </div>
                                ${charactersHtml}
                            </div>
                        `;
                    });
                }

                cardsStackHtml += `</div>`;

                sceneCol.innerHTML = sceneHeaderHtml + cardsStackHtml;
                flowContainer.appendChild(sceneCol);
            });

            // Translate newly loaded DOM strings
            translateDOM();

            // Connect cards visually on the timeline view
            setTimeout(drawTimelineConnections, 60);

            // Connect scroll and resize listeners
            const timelineContainer = document.getElementById('plot-grid-timeline-container');
            if (timelineContainer && !timelineContainer.dataset.hasScrollListener) {
                timelineContainer.dataset.hasScrollListener = "true";
                timelineContainer.addEventListener('scroll', () => {
                    drawTimelineConnections();
                });

                window.addEventListener('resize', () => {
                    if (activeNodeType === "plot_grid" && activePlotSubView === "timeline") {
                        drawTimelineConnections();
                    }
                });
            }
        }

        function drawTimelineConnections() {
            const canvas = document.getElementById('plot-timeline-svg-canvas');
            const container = document.getElementById('plot-grid-timeline-container');
            if (!canvas || !container || activeNodeType !== "plot_grid" || activePlotSubView !== "timeline") return;

            // Clear canvas
            canvas.innerHTML = "";

            // Ensure canvas dimensions match scroll area
            const scrollWidth = container.scrollWidth;
            const scrollHeight = container.scrollHeight;
            canvas.setAttribute("width", scrollWidth);
            canvas.setAttribute("height", scrollHeight);
            canvas.style.width = scrollWidth + "px";
            canvas.style.height = scrollHeight + "px";

            const containerRect = container.getBoundingClientRect();

            // Marker definition
            const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            defs.innerHTML = `
                <marker id="timeline-arrow" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#6366f1" />
                </marker>
                <filter id="timeline-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#6366f1" flood-opacity="0.3" />
                </filter>
            `;
            canvas.appendChild(defs);

            const cards = projectData.plot.cards || [];
            cards.forEach(card => {
                const cardEl = container.querySelector(`[data-timeline-card-id="${card.id}"]`);
                if (!cardEl) return;

                const links = card.links || [];
                links.forEach(linkId => {
                    const targetCard = cards.find(c => c.id === linkId);
                    if (!targetCard) return;

                    const targetEl = container.querySelector(`[data-timeline-card-id="${linkId}"]`);
                    if (!targetEl) return;

                    // Get coordinates
                    const rectA = cardEl.getBoundingClientRect();
                    const rectB = targetEl.getBoundingClientRect();

                    const x1 = rectA.left - containerRect.left + container.scrollLeft + rectA.width / 2;
                    const y1 = rectA.top - containerRect.top + container.scrollTop + rectA.height / 2;

                    const x2 = rectB.left - containerRect.left + container.scrollLeft + rectB.width / 2;
                    const y2 = rectB.top - containerRect.top + container.scrollTop + rectB.height / 2;

                    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

                    // Simple cubic bezier curve
                    const dx = Math.abs(x2 - x1);
                    const controlX1 = x1 + dx * 0.4 * (x2 > x1 ? 1 : -1);
                    const controlY1 = y1;
                    const controlX2 = x2 - dx * 0.4 * (x2 > x1 ? 1 : -1);
                    const controlY2 = y2;

                    const d = `M ${x1} ${y1} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${x2} ${y2}`;

                    path.setAttribute("d", d);
                    path.setAttribute("fill", "none");
                    path.setAttribute("stroke", "#6366f1");
                    path.setAttribute("stroke-width", "2");
                    path.setAttribute("stroke-dasharray", "4 4");
                    path.setAttribute("marker-end", "url(#timeline-arrow)");
                    path.setAttribute("filter", "url(#timeline-glow)");
                    path.setAttribute("opacity", "0.75");

                    canvas.appendChild(path);
                });
            });
        }

        // PLOT CARDS INTERACTIONS
        function addPlotCard(plotlineId, sceneId) {
            const cardId = generateId("card");
            const newCard = {
                id: cardId,
                plotline_id: plotlineId,
                scene_id: sceneId,
                title: translations["new_scene_title"] ? `${translations["new_scene_title"]} Card` : "New Card",
                content: ""
            };
            projectData.plot.cards.push(newCard);
            refreshPlotView();
            openPlotCardModal(cardId);
        }

        function openPlotCardModal(cardId) {
            const card = projectData.plot.cards.find(c => c.id === cardId);
            if (!card) return;

            // Initialize fields defensively
            card.characters = card.characters || [];
            card.links = card.links || [];

            const isLocked = !!(projectData && projectData.settings && projectData.settings.locked);
            document.getElementById('plot-card-title-input').disabled = isLocked;
            document.getElementById('plot-card-desc-input').disabled = isLocked;

            const selectEl = document.getElementById('plot-card-connections-select');
            const addConnectionBtn = document.getElementById('plot-card-add-connection-btn');
            if (selectEl) selectEl.disabled = isLocked;
            if (addConnectionBtn) addConnectionBtn.style.display = isLocked ? 'none' : 'block';

            const saveBtn = document.querySelector('[onclick="savePlotCard()"]');
            if (saveBtn) saveBtn.style.display = isLocked ? 'none' : 'block';

            const deleteBtn = document.querySelector('[onclick="deletePlotCard()"]');
            if (deleteBtn) deleteBtn.style.display = isLocked ? 'none' : 'block';

            currentEditingCard = card;
            document.getElementById('plot-card-title-input').value = card.title;
            document.getElementById('plot-card-desc-input').value = card.content || "";

            // Populate characters and connections in the UI
            renderPlotCardModalCharacters();
            renderPlotCardModalConnections();

            document.getElementById('plot-card-modal').classList.remove('hidden');
        }

        function renderPlotCardModalCharacters() {
            const container = document.getElementById('plot-card-characters-container');
            if (!container) return;
            container.innerHTML = "";

            const isLocked = !!(projectData && projectData.settings && projectData.settings.locked);
            const chars = projectData.characters || [];
            if (chars.length === 0) {
                container.innerHTML = `<span class="text-slate-400 italic" data-i18n="no_characters_yet">${translations["no_characters_yet"] || "Aucun personnage créé"}</span>`;
                return;
            }

            chars.forEach(char => {
                const isSelected = currentEditingCard.characters.includes(char.id);
                const badge = document.createElement('div');
                badge.className = `px-2.5 py-1 rounded-full border cursor-pointer font-semibold transition-all flex items-center space-x-1 ${
                    isSelected
                    ? "bg-teal-50 text-teal-700 border-teal-300 hover:bg-teal-100"
                    : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                }`;
                badge.innerHTML = `
                    <span>👤</span>
                    <span>${char.name}</span>
                `;
                if (!isLocked) {
                    badge.onclick = () => {
                        if (isSelected) {
                            currentEditingCard.characters = currentEditingCard.characters.filter(id => id !== char.id);
                        } else {
                            currentEditingCard.characters.push(char.id);
                        }
                        renderPlotCardModalCharacters();
                    };
                }
                container.appendChild(badge);
            });
        }

        function renderPlotCardModalConnections() {
            const selectEl = document.getElementById('plot-card-connections-select');
            const container = document.getElementById('plot-card-connections-container');
            if (!selectEl || !container) return;

            selectEl.innerHTML = "";
            container.innerHTML = "";

            const isLocked = !!(projectData && projectData.settings && projectData.settings.locked);

            // Populate SELECT element with OTHER cards
            const otherCards = (projectData.plot.cards || []).filter(c => c.id !== currentEditingCard.id);
            if (otherCards.length === 0) {
                const opt = document.createElement('option');
                opt.value = "";
                opt.textContent = translations["no_cards_yet"] || "Aucune autre carte d'intrigue";
                selectEl.appendChild(opt);
            } else {
                // Add placeholder option
                const optPlaceholder = document.createElement('option');
                optPlaceholder.value = "";
                optPlaceholder.textContent = translations["link_select_placeholder"] || "Sélectionner une carte...";
                selectEl.appendChild(optPlaceholder);

                otherCards.forEach(c => {
                    // Do not suggest cards already connected
                    if (!currentEditingCard.links.includes(c.id)) {
                        const opt = document.createElement('option');
                        opt.value = c.id;
                        // Find plotline name and scene title for clean description
                        const pl = projectData.plot.plotlines.find(p => p.id === c.plotline_id);
                        const sc = getScenesList().find(s => s.id === c.scene_id);
                        const suffix = `${pl ? pl.title : ''} - ${sc ? sc.title : ''}`;
                        opt.textContent = `${c.title} (${suffix})`;
                        selectEl.appendChild(opt);
                    }
                });
            }

            // Populate CURRENT links
            if (currentEditingCard.links.length === 0) {
                container.innerHTML = `<span class="text-slate-400 italic text-[11px]">${window.activeLang === 'fr' ? 'Aucune connexion active.' : 'No active connections.'}</span>`;
                return;
            }

            currentEditingCard.links.forEach(linkId => {
                const connectedCard = projectData.plot.cards.find(c => c.id === linkId);
                if (!connectedCard) return;

                const badge = document.createElement('div');
                badge.className = "px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg flex items-center space-x-1 font-semibold";

                const pl = projectData.plot.plotlines.find(p => p.id === connectedCard.plotline_id);
                const plTitle = pl ? pl.title : '';

                badge.innerHTML = `
                    <span class="truncate max-w-[120px]" title="${connectedCard.title}">${connectedCard.title} [${plTitle}]</span>
                    ${!isLocked ? `
                        <button onclick="removeCardLink('${linkId}')" class="text-indigo-400 hover:text-indigo-600 font-bold ml-1 hover:bg-indigo-100 rounded-full w-4 h-4 flex items-center justify-center transition-colors">
                            &times;
                        </button>
                    ` : ""}
                `;
                container.appendChild(badge);
            });
        }

        function addCardLinkFromModal() {
            const selectEl = document.getElementById('plot-card-connections-select');
            if (!selectEl || !currentEditingCard) return;

            const targetCardId = selectEl.value;
            if (!targetCardId) return;

            currentEditingCard.links = currentEditingCard.links || [];
            if (!currentEditingCard.links.includes(targetCardId)) {
                currentEditingCard.links.push(targetCardId);
            }

            renderPlotCardModalConnections();
        }

        function removeCardLink(targetCardId) {
            if (!currentEditingCard) return;
            currentEditingCard.links = (currentEditingCard.links || []).filter(id => id !== targetCardId);
            renderPlotCardModalConnections();
        }

        function closePlotCardModal() {
            document.getElementById('plot-card-modal').classList.add('hidden');
            currentEditingCard = null;
        }

        function savePlotCard() {
            if (currentEditingCard) {
                currentEditingCard.title = document.getElementById('plot-card-title-input').value;
                currentEditingCard.content = document.getElementById('plot-card-desc-input').value;
                closePlotCardModal();
                refreshPlotView();
                persistProject();
            }
        }

        function deletePlotCard() {
            if (currentEditingCard) {
                projectData.plot.cards = projectData.plot.cards.filter(c => c.id !== currentEditingCard.id);
                closePlotCardModal();
                refreshPlotView();
                persistProject();
            }
        }
        // Right Sidebar Resizer Logic
        (function() {
            const rightSidebar = document.getElementById('right-sidebar');
            const resizeHandle = document.getElementById('sidebar-resize-handle');
            let isResizing = false;

            // Load saved sidebar width
            const savedWidth = localStorage.getItem('right-sidebar-width');
            if (savedWidth) {
                rightSidebar.style.width = savedWidth + 'px';
            }

            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                document.body.classList.add('select-none');
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const newWidth = window.innerWidth - e.clientX;
                // Enforce constraints: min 240px, max 700px
                if (newWidth >= 240 && newWidth <= 700) {
                    rightSidebar.style.width = newWidth + 'px';
                    localStorage.setItem('right-sidebar-width', newWidth);
                }
            });

            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.classList.remove('select-none');
                }
            });
        })();

        // WINDOW CONTROLS: QUIT & MINIMIZE / FULLSCREEN
        function minimizeApplication() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.log("Error attempting to enable full-screen:", err);
                });
            } else {
                document.exitFullscreen().catch(err => {
                    console.log("Error attempting to exit full-screen:", err);
                });
            }
        }

        async function quitApplication() {
            if (await showConfirm(window.activeLang === 'fr' ? "Voulez-vous quitter l'application ?" : "Do you want to quit the application?")) {
                try {
                    await fetch('/api/quit', { method: 'POST' });
                } catch(e) {}
                window.close();
            }
        }

        // Auto-fullscreen on first interaction for "pleine page" start
        document.addEventListener('click', function autoFullscreen() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {});
            }
            document.removeEventListener('click', autoFullscreen);
        }, { once: true });


// Restoration & Import Modals
window.openRestoreModal = function() {
    closeSettingsModal();
    const modal = document.getElementById('restore-modal');
    if (modal) {
        modal.classList.remove('hidden');
        loadBackupsList();
    }
};

window.closeRestoreModal = function() {
    const modal = document.getElementById('restore-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
};

window.loadBackupsList = async function() {
    const listContainer = document.getElementById('restore-backups-list');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="text-slate-400 text-xs italic p-2 text-center" data-i18n="loading">Chargement...</div>';

    try {
        // Read the currently inputted directory, fallback to local storage or project settings
        const inputField = document.getElementById('settings-backup-path');
        let currentPath = inputField ? inputField.value.trim() : "";
        if (!currentPath && projectData && projectData.settings && projectData.settings.backup_config) {
            currentPath = projectData.settings.backup_config.folder_path || "";
        }

        if (!currentPath) {
            listContainer.innerHTML = '<div class="text-slate-400 text-xs italic p-2 text-center">Aucune sauvegarde locale trouvée.</div>';
            return;
        }

        const backups = await window.api_invoke('backup_list', { folderPath: currentPath });

        if (!backups || backups.length === 0) {
            listContainer.innerHTML = '<div class="text-slate-400 text-xs italic p-2 text-center">Aucune sauvegarde locale trouvée.</div>';
            return;
        }

        listContainer.innerHTML = '';
        backups.forEach(backup => {
            const date = new Date(backup.modified_unix * 1000).toLocaleString();
            const size = (backup.size_bytes / 1024).toFixed(1) + ' KB';

            const btn = document.createElement('div');
            btn.className = 'flex items-center justify-between p-2 hover:bg-slate-200/50 rounded cursor-pointer border-b border-slate-100 last:border-0';
            btn.innerHTML = `
                <div class="flex flex-col overflow-hidden">
                    <span class="text-xs font-semibold text-slate-700 truncate">${backup.filename}</span>
                    <span class="text-[10px] text-slate-400">${date} • ${size}</span>
                </div>
                <button onclick="restoreBackup('${backup.filename}', '${currentPath.replace(/\'/g, "\\'")}')" class="bg-amber-100 hover:bg-amber-200 text-amber-700 font-bold px-2 py-1 rounded text-xs ml-2 shrink-0 transition-colors">
                    Restaurer
                </button>
            `;
            listContainer.appendChild(btn);
        });

    } catch (err) {
        listContainer.innerHTML = '<div class="text-red-500 text-xs p-2 text-center">Erreur lors du chargement des sauvegardes.</div>';
    }
};

window.restoreBackup = async function(filename, path = "") {
    if (!(await showConfirm("Êtes-vous sûr de vouloir restaurer cette sauvegarde ? Cela écrasera toutes vos données actuelles."))) return;

    try {
        await window.api_invoke('backup_restore', { folderPath: path, filename: filename });
        window.location.reload();
    } catch (err) {
        alert("Erreur lors de la restauration : " + err);
    }
};

window.importDocument = async function() {
    const input = document.getElementById('import-document-input');
    if (!input || !input.files || input.files.length === 0) {
        alert("Veuillez sélectionner un fichier à importer.");
        return;
    }

    if (!(await showConfirm("Êtes-vous sûr de vouloir importer ce document ? Cela écrasera entièrement votre manuscrit actuel !"))) return;

    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    const btn = document.querySelector('button[onclick="importDocument()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Importation...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/import/document', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (data.success) {
            window.location.reload();
        } else {
            alert("Erreur lors de l'importation : " + data.error);
        }
    } catch (err) {
        alert("Erreur de connexion.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

        window.insertPageBreak = function insertPageBreak() {
            const sel = window.getSelection();
            if (sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const activeTa = range.startContainer.nodeType === 3 ? range.startContainer.parentNode.closest('.editor-scene-contenteditable') : range.startContainer.closest('.editor-scene-contenteditable');
                if (activeTa) {
                    const pageBreakHtml = '<hr class="page-break" style="page-break-after: always; border: 0; border-top: 2px dashed #cbd5e1; margin: 2rem 0; text-align: center; position: relative;" data-content="Saut de page" />';
                    document.execCommand('insertHTML', false, pageBreakHtml + '<br>');
                    onCombinedEditorInput(null, activeTa);
                    return;
                }
            }
            // Fallback if not focused
            const editors = document.querySelectorAll('.editor-scene-contenteditable');
            if (editors.length > 0) {
                const editor = editors[editors.length - 1]; // Append to last
                editor.focus();
                const pageBreakHtml = '<hr class="page-break" style="page-break-after: always; border: 0; border-top: 2px dashed #cbd5e1; margin: 2rem 0; text-align: center; position: relative;" data-content="Saut de page" />';
                document.execCommand('insertHTML', false, pageBreakHtml + '<br>');
                onCombinedEditorInput(null, editor);
            }
        };

        function applyPagination() {
            const existing = document.querySelectorAll('.dynamic-page-number');
            existing.forEach(e => e.remove());

            const wrapper = document.getElementById('editor-layout-wrapper');
            const scrollContainer = document.getElementById('editor-scroll-container');

            if (!wrapper || !scrollContainer.classList.contains('show-page-numbers')) return;

            // Approximate height of an A4 page text content in pixels
            const PAGE_HEIGHT = 1000;

            // Make sure the wrapper is positioned relatively
            wrapper.style.position = 'relative';

            const totalHeight = wrapper.scrollHeight;
            const numPages = Math.floor(totalHeight / PAGE_HEIGHT);

            for (let i = 1; i <= numPages; i++) {
                const pageIndicator = document.createElement('div');
                pageIndicator.className = 'dynamic-page-number';
                pageIndicator.style.position = 'absolute';
                pageIndicator.style.top = `${i * PAGE_HEIGHT}px`;
                pageIndicator.style.left = '0';
                pageIndicator.style.width = '100%';
                pageIndicator.style.borderTop = '1px dashed #e2e8f0';
                pageIndicator.style.textAlign = 'center';
                pageIndicator.style.paddingTop = '4px';
                pageIndicator.style.color = '#94a3b8';
                pageIndicator.style.fontSize = '0.75rem';
                pageIndicator.style.fontFamily = 'monospace';
                pageIndicator.style.pointerEvents = 'none';
                pageIndicator.style.zIndex = '10';
                pageIndicator.innerText = `— Page ${i} —`;

                wrapper.appendChild(pageIndicator);
            }
        }

        // Attach resize/input events to update pagination
        window.addEventListener('resize', () => {
            if (document.getElementById('editor-scroll-container') && document.getElementById('editor-scroll-container').classList.contains('show-page-numbers')) {
                applyPagination();
            }
        });

        window.togglePageNumbers = function togglePageNumbers() {
            const editorScroll = document.getElementById('editor-scroll-container');
            if (editorScroll) {
                editorScroll.classList.toggle('show-page-numbers');
                if (editorScroll.classList.contains('show-page-numbers')) {
                    applyPagination();
                } else {
                    const existing = document.querySelectorAll('.dynamic-page-number');
                    existing.forEach(e => e.remove());
                }
            }
        };

function closeGemmaMissingModal() {
    document.getElementById('gemma-missing-modal').classList.add('hidden');
}

function closeGemmaInstallingModal() {
    document.getElementById('gemma-installing-modal').classList.add('hidden');
}


// ============================================================
// Merged from linguistique.js (formatting, synonyms, relecture).
// See the top-of-file note in the git history for why this file
// is one classic (non-module) script instead of three ES
// modules: inline onclick="..." handlers and cross-file bare
// references (projectData, translations, activeSelection, ...)
// only resolve correctly when everything shares one global
// script scope, which ES modules deliberately do not provide.
// ============================================================

        function applySmartTypography(editor) {
            // No-op for contenteditable, handled via keydown handler to prevent cursor resetting
        }

        window.applySelectionFormatting = function applySelectionFormatting(type) {
            const editor = document.getElementById('editor-content');
            if (!editor) return;

            editor.focus();

            if (type === 'removeFormat') {
                document.execCommand('removeFormat', false, null);
            } else if (type === 'italic') {
                document.execCommand('italic', false, null);
            } else if (type === 'bold') {
                document.execCommand('bold', false, null);
            } else if (type === 'bold_italic') {
                document.execCommand('bold', false, null);
                document.execCommand('italic', false, null);
            } else if (type === 'smallcaps') {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const selectedText = range.toString();
                    if (selectedText.length > 0) {
                        const span = document.createElement('span');
                        span.style.fontVariant = 'small-caps';
                        span.appendChild(document.createTextNode(selectedText));

                        range.deleteContents();
                        range.insertNode(span);

                        // Select the span text
                        const newRange = document.createRange();
                        newRange.selectNodeContents(span);
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                    }
                }
            } else if (type === 'dialogue') {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const selectedText = range.toString().trim();
                    if (selectedText.length > 0) {
                        const dialogueNode = document.createTextNode(`— «\u00A0${selectedText}\u00A0»`);
                        range.deleteContents();
                        range.insertNode(dialogueNode);

                        // Select the dialogue text
                        const newRange = document.createRange();
                        newRange.selectNodeContents(dialogueNode);
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                    }
                }
            } else if (type === 'annotation') {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const selectedText = range.toString();
                    if (selectedText.length > 0) {
                        const span = document.createElement('span');
                        span.className = 'annotation-highlight border-b-2 border-dashed border-indigo-500 cursor-help relative inline';
                        const defaultText = window.activeLang === 'fr' ? "Saisissez votre note d'annotation ici..." : "Enter your annotation note here...";
                        span.setAttribute('data-annotation', defaultText);
                        span.setAttribute('data-annotation-id', 'anno-' + Date.now() + '-' + Math.floor(Math.random() * 1000));

                        // Use extractContents to preserve HTML elements like <br> and other formatting tags
                        const extracted = range.extractContents();
                        span.appendChild(extracted);

                        range.insertNode(span);

                        // Select the span text
                        const newRange = document.createRange();
                        newRange.selectNodeContents(span);
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                    }
                }
            }

            // Trigger updates and persistence
            onEditorInput('content', editor.innerHTML);

            // Hide selection menu

        }

        window.toggleSynonymsDropdown = function toggleSynonymsDropdown(event) {
            event.stopPropagation();
            const menu = document.getElementById('synonyms-dropdown-menu');
            if (!menu) return;

            const isHidden = menu.classList.contains('hidden');

            // Hide rewrite dropdown if open
            const rewriteMenu = document.getElementById('ai-rewrite-dropdown-menu');
            if (rewriteMenu) rewriteMenu.classList.add('hidden');

            if (isHidden) {
                menu.classList.remove('hidden');
                loadSynonymsForSelection();
            } else {
                menu.classList.add('hidden');
            }
        }

        async function loadSynonymsForSelection() {
            const menu = document.getElementById('synonyms-dropdown-menu');
            if (!menu) return;

            const selectedText = activeSelection.text.trim();
            if (!selectedText) {
                menu.innerHTML = `<div class="text-[10px] text-slate-400 p-2 italic">${window.activeLang === 'fr' ? 'Sélectionner un mot' : 'Select a word'}</div>`;
                return;
            }

            menu.innerHTML = `<div class="text-[10px] text-slate-400 p-2 italic">${window.activeLang === 'fr' ? 'Recherche...' : 'Searching...'}</div>`;

            try {
                {
                    const synonyms = await window.api_invoke('get_synonyms', { word: selectedText, lang: window.activeLang }) || [];

                    if (synonyms.length === 0) {
                        menu.innerHTML = `<div class="text-[10px] text-slate-400 p-2 italic">${window.activeLang === 'fr' ? 'Aucun synonyme' : 'No synonyms found'}</div>`;
                    } else {
                        menu.innerHTML = synonyms.map(syn => `
                            <button onclick="applySynonymReplacement('${escapeHtml(syn)}')" class="w-full text-left px-2.5 py-1.5 hover:bg-slate-700 text-slate-100 hover:text-white bg-transparent text-xs font-semibold rounded-md transition-colors block truncate">
                                ${escapeHtml(syn)}
                            </button>
                        `).join('');
                    }
                }
            } catch (err) {
                console.error("Synonyms load error:", err);
                menu.innerHTML = `<div class="text-[10px] text-red-400 p-2 italic">${window.activeLang === 'fr' ? 'Erreur connexion' : 'Network error'}</div>`;
            }
        }

        window.applySynonymReplacement = function applySynonymReplacement(synonym) {
            const editor = document.getElementById('editor-content');
            if (!editor) return;

            editor.focus();
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();

                const node = document.createTextNode(synonym);
                range.insertNode(node);

                range.setStartAfter(node);
                range.setEndAfter(node);
                selection.removeAllRanges();
                selection.addRange(range);
            }

            // Trigger updates and persistence
            onEditorInput('content', editor.innerHTML);

            // Close dropdown and menu


            const synonymsMenu = document.getElementById('synonyms-dropdown-menu');
            if (synonymsMenu) synonymsMenu.classList.add('hidden');
        }


        const STOPWORDS = {
            fr: new Set(["dans", "pour", "avec", "mais", "dans", "elle", "elles", "vous", "nous", "leur", "leurs", "cette", "cettes", "ceux", "celles", "notre", "votre", "leurs", "donc", "alors", "plus", "moins", "très", "tout", "tous", "toute", "toutes", "sans", "comme", "mais", "puis", "quand", "si", "bien", "fait", "faire", "dire", "avoir", "être", "étiez", "était", "étaient", "sommes", "êtes", "sont", "suis", "es", "est", "avez", "avons", "ont", "avais", "avait", "avaient", "quel", "quelle", "quelles", "quels", "ceci", "cela", "celui", "celle", "ceux", "dont", "avec", "sans", "sous", "vers", "chez"]),
            en: new Set(["with", "from", "they", "them", "their", "will", "would", "about", "there", "their", "these", "those", "this", "that", "then", "than", "thence", "when", "where", "what", "which", "while", "here", "have", "been", "were", "was", "is", "are", "am", "had", "has", "does", "done", "doing", "make", "made", "some", "more", "most", "many", "much", "very", "also", "just", "like", "even", "only", "well", "down", "under", "over", "into", "your", "them", "their", "theirs"])
        };

        function countWords(text) {
            if (!text) return 0;
            const clean = text.trim().replace(/[./,!?;:\"'()\[\]{}«»\-\—]/g, " ");
            const words = clean.split(/\s+/).filter(w => w.length > 0);
            return words.length;
        }

        function calculateLexicalRichness(text) {
            if (!text) return 0;
            const clean = text.trim().toLowerCase().replace(/[./,!?;:\"'()\[\]{}«»\-\—]/g, " ");
            const words = clean.split(/\s+/).filter(w => w.length > 0);
            if (words.length === 0) return 0;
            const uniqueWords = new Set(words);
            return Math.round((uniqueWords.size / words.length) * 100);
        }

        function countParagraphs(text) {
            if (!text) return 0;
            return text.split('\n').filter(p => p.trim().length > 0).length;
        }

        function calculateDialogueRatio(text) {
            if (!text) return 0;
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) return 0;
            let dialogueCount = 0;
            lines.forEach(l => {
                if (l.startsWith('-') || l.startsWith('—') || l.startsWith('«') || l.startsWith('"') || l.startsWith('“')) {
                    dialogueCount++;
                }
            });
            return Math.round((dialogueCount / lines.length) * 100);
        }

        function getSceneRepetitions(text, lang) {
            if (!text) return [];
            const clean = text.trim().toLowerCase().replace(/[./,!?;:\"'()\[\]{}«»\-\—\n\r]/g, " ");
            const words = clean.split(/\s+/).filter(w => w.length > 3);
            const counts = {};
            const langKey = lang === "fr" ? "fr" : "en";
            const stopset = STOPWORDS[langKey] || new Set();

            words.forEach(w => {
                if (!stopset.has(w)) {
                    counts[w] = (counts[w] || 0) + 1;
                }
            });

            const reps = [];
            for (const [word, count] of Object.entries(counts)) {
                if (count >= 2) {
                    reps.push({ word, count });
                }
            }
            // Sort by count descending
            reps.sort((a, b) => b.count - a.count);
            return reps;
        }

        async function selectRepetitionWord(word) {
            const container = document.getElementById('relecture-repetition-synonyms-container');
            const wordSpan = document.getElementById('relecture-selected-rep-word');
            const listContainer = document.getElementById('relecture-rep-synonyms-list');

            if (!container || !wordSpan || !listContainer) return;

            wordSpan.innerText = word;
            container.classList.remove('hidden');
            listContainer.innerHTML = `<span class="text-xs text-slate-400 italic">Recherche de synonymes... / Searching...</span>`;

            try {
                const synonyms = await window.api_invoke('get_synonyms', { word: word, lang: window.activeLang }) || [];

                listContainer.innerHTML = "";

                if (synonyms.length === 0) {
                    listContainer.innerHTML = `<span class="text-xs text-slate-400 italic">Aucun synonyme trouvé / No synonyms found</span>`;
                } else {
                    synonyms.forEach(syn => {
                        const btn = document.createElement('button');
                        btn.className = "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded border border-indigo-200 transition-all mb-1 mr-1";
                        btn.innerText = syn;
                        btn.onclick = () => replaceRepetition(word, syn);
                        listContainer.appendChild(btn);
                    });
                }
            } catch (err) {
                listContainer.innerHTML = `<span class="text-xs text-red-500">Erreur lors de la recherche / Error searching</span>`;
            }
        }

        function replaceRepetition(oldWord, newWord) {
            const escapedWord = oldWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp("(?<=^|[^a-zA-Z0-9àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ])" + escapedWord + "(?=$|[^a-zA-Z0-9àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ])", "gi");

            if (activeRelectureScope === "scene") {
                if (!activeNodeId || activeNodeType !== "scene") return;
                const editor = document.getElementById('editor-content');
                if (!editor) return;

                let content = editor.innerHTML;
                content = content.replace(regex, newWord);
                editor.innerHTML = content;
                onCombinedEditorInput(editor.innerHTML);
            } else {
                // Replace in all scenes of the parent chapter
                const chapter = findParentChapter(activeNodeId);
                if (chapter && chapter.children) {
                    chapter.children.forEach(scene => {
                        if (scene.content) {
                            scene.content = scene.content.replace(regex, newWord);
                        }
                    });
                    refreshActiveWorkspace();
                    persistProject();
                }
            }

            // Hide synonym box and refresh stats and panes
            document.getElementById('relecture-repetition-synonyms-container').classList.add('hidden');
            updateRelectureStatsAndPanes();
        }

        function updatePacingStats(text) {
            const shortEl = document.getElementById('relecture-pacing-short');
            const mediumEl = document.getElementById('relecture-pacing-medium');
            const longEl = document.getElementById('relecture-pacing-long');
            if (!shortEl || !mediumEl || !longEl) return;

            if (!text) {
                shortEl.innerText = "0";
                mediumEl.innerText = "0";
                longEl.innerText = "0";
                return;
            }

            const sentences = text.split(/[.?!]+/).map(s => s.trim()).filter(s => s.length > 0);
            let shortCount = 0;
            let mediumCount = 0;
            let longCount = 0;

            sentences.forEach(s => {
                const words = s.split(/\s+/).filter(w => w.length > 0).length;
                if (words < 10) {
                    shortCount++;
                } else if (words <= 25) {
                    mediumCount++;
                } else {
                    longCount++;
                }
            });

            shortEl.innerText = shortCount;
            mediumEl.innerText = mediumCount;
            longEl.innerText = longCount;
        }

        function selectRelectureCategory(cat) {
            const isAiEnabled = (localStorage.getItem('ai-enabled') !== 'false');
            if (!isAiEnabled && (cat === 'style' || cat === 'coherence' || cat === 'worldbuilding')) {
                return;
            }

            activeRelectureCategory = cat;

            // Highlight active button
            const buttons = ["repetitions", "rythme", "style", "coherence", "worldbuilding"];
            buttons.forEach(b => {
                const btn = document.getElementById(`relecture-btn-${b}`);
                if (btn) {
                    if (b === cat) {
                        btn.className = "w-full text-left px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-all flex items-center space-x-2";
                    } else {
                        btn.className = "w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all flex items-center space-x-2";
                    }
                }
            });

            // Show/hide panes
            const repetitionsPane = document.getElementById('relecture-pane-repetitions');
            const rythmePane = document.getElementById('relecture-pane-rythme');
            const aiPane = document.getElementById('relecture-pane-ai');

            if (cat === "repetitions") {
                repetitionsPane.classList.remove('hidden');
                rythmePane.classList.add('hidden');
                aiPane.classList.add('hidden');
            } else if (cat === "rythme") {
                repetitionsPane.classList.add('hidden');
                rythmePane.classList.remove('hidden');
                aiPane.classList.add('hidden');
            } else {
                repetitionsPane.classList.add('hidden');
                rythmePane.classList.add('hidden');
                aiPane.classList.remove('hidden');

                // Update AI Title based on selected AI category
                const titleEl = document.getElementById('relecture-ai-title');
                if (titleEl) {
                    if (cat === "style") titleEl.innerText = "Style & Prose (IA)";
                    else if (cat === "coherence") titleEl.innerText = "Cohérence (IA)";
                    else if (cat === "worldbuilding") titleEl.innerText = "Worldbuilding & Lore (IA)";
                }

                const feedbackEl = document.getElementById('relecture-ai-feedback');
                if (feedbackEl) {
                    if (cat === "style") {
                        feedbackEl.innerText = window.activeLang === 'fr' ? "Pour lancer l'analyse intelligente de style et prose, cliquez sur le bouton ci-dessus." : "To run the style and prose smart analysis, click the button above.";
                    } else if (cat === "coherence") {
                        feedbackEl.innerText = window.activeLang === 'fr' ? "Pour lancer l'analyse intelligente de cohérence narrative, cliquez sur le bouton ci-dessus." : "To run the narrative coherence smart analysis, click the button above.";
                    } else if (cat === "worldbuilding") {
                        feedbackEl.innerText = window.activeLang === 'fr' ? "Pour lancer l'analyse intelligente de worldbuilding (anachronismes et incohérences de lore), cliquez sur le bouton ci-dessus." : "To run the smart worldbuilding analysis (anachronisms and lore inconsistencies), click the button above.";
                    }
                }
            }
        }

        function autoCorrectTypography() {
            const correctText = (txt) => {
                if (window.activeLang === 'fr') {
                    txt = txt.replace(/([^ \u00A0])([?!:;])/g, '$1 $2');
                    txt = txt.replace(/"([^"]+)"/g, '« $1 »');
                    txt = txt.replace(/\.\.\./g, '…');
                } else {
                    txt = txt.replace(/"([^"]+)"/g, '“$1”');
                    txt = txt.replace(/'([^']+)'/g, '‘$1’');
                    txt = txt.replace(/\.\.\./g, '…');
                }
                return txt;
            };

            if (activeRelectureScope === "scene") {
                if (!activeNodeId || activeNodeType !== "scene") return;
                const editor = document.getElementById('editor-content');
                if (!editor) return;

                // Walk only text nodes to avoid corrupting HTML tags and attributes
                const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
                let node;
                const nodesToCorrect = [];
                while (node = walker.nextNode()) {
                    nodesToCorrect.push(node);
                }
                nodesToCorrect.forEach(textNode => {
                    textNode.nodeValue = correctText(textNode.nodeValue);
                });

                onCombinedEditorInput(editor.innerHTML);
            } else {
                const chapter = findParentChapter(activeNodeId);
                if (chapter && chapter.children) {
                    chapter.children.forEach(scene => {
                        if (scene.content) {
                            scene.content = correctText(scene.content);
                        }
                    });
                    refreshActiveWorkspace();
                    persistProject();
                }
            }

            updateRelectureStatsAndPanes();
        }

        function updateRelectureStatsAndPanes() {
            let text = "";
            if (activeRelectureScope === "scene") {
                const editor = document.getElementById('editor-content');
                text = editor ? editor.innerText : "";
            } else {
                text = getChapterText();
            }

            const wordCount = countWords(text);
            const richness = calculateLexicalRichness(text);
            const paraCount = countParagraphs(text);
            const dialogue = calculateDialogueRatio(text);

            document.getElementById('relecture-stat-words').innerText = wordCount;
            document.getElementById('relecture-stat-richness').innerText = richness + "%";
            document.getElementById('relecture-stat-paragraphs').innerText = paraCount;
            document.getElementById('relecture-stat-dialogue').innerText = dialogue + "%";

            const reps = getSceneRepetitions(text, window.activeLang);
            const repsListContainer = document.getElementById('relecture-repetitions-list');
            if (repsListContainer) {
                repsListContainer.innerHTML = "";
                if (reps.length === 0) {
                    repsListContainer.innerHTML = `<span class="text-xs text-slate-400 italic">Aucune répétition détectée / No repetitions detected</span>`;
                } else {
                    reps.forEach(item => {
                        const btn = document.createElement('button');
                        btn.className = "bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold px-2 py-1 rounded border border-rose-200 transition-all flex items-center space-x-1 mb-1 mr-1";
                        btn.innerHTML = `<span>${item.word}</span> <span class="bg-rose-200/60 px-1 rounded text-[10px]">${item.count}</span>`;
                        btn.onclick = () => selectRepetitionWord(item.word);
                        repsListContainer.appendChild(btn);
                    });
                }
            }

            updatePacingStats(text);
        }


// ============================================================
// Merged from ia.js (contextual AI tools, chat, relecture AI,
// character extraction, local Gemma install flow).
// ============================================================
        // CONTEXTUAL AI TOOLS (Describe, Rewrite, Expand)
        let activeSelection = { start: 0, end: 0, text: "" };
        let lastAiToolCall = { tool: "", style: "", text: "" };

                window.handleTextSelection = function handleTextSelection(e) {
            const editor = document.getElementById('editor-content');
            if (!editor) return;

            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                const text = selection.toString().trim();
                if (text.length > 0) {
                    activeSelection = { text: selection.toString() };
                }
            }
        }



        function closeAiPreview() {
            document.getElementById('ai-preview-card').classList.add('hidden');
        }
        window.closeAiPreview = closeAiPreview;

        window.toggleRewriteDropdown = function toggleRewriteDropdown(event) {
            event.stopPropagation();
            const menu = document.getElementById('ai-rewrite-dropdown-menu');
            if (menu) {
                menu.classList.toggle('hidden');
            }
        }
        window.triggerContextAI = async function triggerContextAI(tool, style = "") {
                        const rewriteMenu = document.getElementById('ai-rewrite-dropdown-menu');
            const povMenu = document.getElementById('ai-pov-dropdown-menu');
            const card = document.getElementById('ai-preview-card');
                        if (rewriteMenu) rewriteMenu.classList.add('hidden');
            if (povMenu) povMenu.classList.add('hidden');
            if (!card) return;

            // Save last call params
            lastAiToolCall = { tool, style, text: activeSelection.text };

            // Position card near selection menu
            card.style.left = '50%';
            card.style.top = '50%';
            card.style.transform = 'translate(-50%, -50%)';

            card.classList.remove('hidden');

            // Setup loading state
            document.getElementById('ai-preview-loading').classList.remove('hidden');
            document.getElementById('ai-preview-result-container').classList.add('hidden');
            document.getElementById('ai-preview-actions').classList.add('hidden');

            // Set Title
            let titleText = "Assistant IA";
            if (tool === "describe") {
                titleText = formatTranslation("ai_describe") || "Décrire";
            } else if (tool === "rewrite") {
                const styleName = style.charAt(0).toUpperCase() + style.slice(1);
                titleText = `${formatTranslation("ai_rewrite") || "Réécrire"} (${styleName})`;
            } else if (tool === "pov") {
                let povName = style;
                if (style === "first_person") povName = "1ère p.";
                if (style === "third_person") povName = "3ème p.";
                if (style === "other_witness") povName = "Témoin";
                titleText = `POV (${povName})`;
            } else if (tool === "expand") {
                titleText = formatTranslation("ai_expand") || "Développer";
            } else if (tool === "show_dont_tell") {
                titleText = formatTranslation("ai_show_dont_tell") || "Show, Don't Tell";
            } else if (tool === "sensory") {
                titleText = formatTranslation("ai_sensory") || "Détails Sensoriels";
            }
            document.getElementById('ai-preview-tool-title').innerText = titleText;

            try {
                const data = await window.api_invoke('ai_tool', {
                    tool: tool,
                    style: style,
                    text: activeSelection.text,
                    lang: window.activeLang
                });

                document.getElementById('ai-preview-loading').classList.add('hidden');

                {
                    const resultContainer = document.getElementById('ai-preview-result-container');
                    resultContainer.innerText = data.message;
                    resultContainer.classList.remove('hidden');
                    document.getElementById('ai-preview-actions').classList.remove('hidden');
                }
            } catch (err) {
                console.error("AI Context error:", err);
                document.getElementById('ai-preview-loading').classList.add('hidden');
                alert("Failed to connect to AI service.");
                closeAiPreview();
            }
        }

        function regenerateAI() {
            if (lastAiToolCall.text) {
                triggerContextAI(lastAiToolCall.tool, lastAiToolCall.style);
            }
        }
        window.regenerateAI = regenerateAI;

        window.applyAiSuggestion = function applyAiSuggestion() {
            const editor = document.getElementById('editor-content');
            const resultContainer = document.getElementById('ai-preview-result-container');
            if (!editor || !resultContainer) return;

            editor.focus();
            const suggestion = resultContainer.innerText;

            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();

                // Escape and convert newlines to <br> to preserve formatting in suggestions
                const tempDiv = document.createElement('div');
                tempDiv.innerText = suggestion;
                const formattedHtml = tempDiv.innerHTML.replace(/\n/g, '<br>');

                const fragment = range.createContextualFragment(formattedHtml);
                const lastNode = fragment.lastChild;
                range.insertNode(fragment);

                if (lastNode) {
                    range.setStartAfter(lastNode);
                    range.setEndAfter(lastNode);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }

            // Trigger updates and persistence
            onEditorInput('content', editor.innerHTML);
            closeAiPreview();
        }

        async function runAiRelecture() {
            const feedbackEl = document.getElementById('relecture-ai-feedback');
            if (!feedbackEl) return;

            let text = "";
            if (activeRelectureScope === "scene") {
                const editor = document.getElementById('editor-content');
                text = editor ? editor.innerText : "";
            } else {
                text = getChapterText();
            }

            if (!text || !text.trim()) {
                feedbackEl.innerText = translations["error_empty_text_analysis"] || "Empty or missing text to analyze.";
                return;
            }

            feedbackEl.innerText = translations["ai_analysis_in_progress"] || "AI analysis in progress... Please wait.";

            try {
                let loreContext = "";
                if (activeRelectureCategory === "worldbuilding") {
                    loreContext = projectData.characters.map(c =>
                        `Nom: ${c.name}\nApparence: ${c.appearance}\nTraits: ${c.traits.join(', ')}\nNotes: ${c.notes}\n`
                    ).join('\n');
                }

                try {
                    const data = await window.api_invoke('ai_relecture', {
                        category: activeRelectureCategory, // "style", "coherence" or "worldbuilding"
                        text: text,
                        lang: window.activeLang
                    });
                    feedbackEl.innerText = data.feedback;
                } catch (aiErr) {
                    feedbackEl.innerText = translations["error_ai_feedback"] || "Error: Could not retrieve feedback from AI.";
                }
            } catch (err) {
                feedbackEl.innerText = translations["error_network_connection"] || "Network connection error.";
            }
        }

        // AI Chat history state
        let chatMessages = [];

        function updateChatWelcomeMessage() {
            const welcomeText = translations["chat_welcome"] || "Bonjour ! Je suis votre assistant Écriture. Posez-moi des questions sur vos personnages, l'intrigue ou demandez-moi des idées pour votre scène en cours.";
            if (chatMessages.length === 0) {
                chatMessages.push({ role: "assistant", content: welcomeText });
            } else if (chatMessages.length === 1 && chatMessages[0].role === "assistant") {
                chatMessages[0].content = welcomeText;
            }
            renderChat();
        }

        function clearChat() {
            const welcomeText = translations["chat_welcome"] || "Bonjour ! Je suis votre assistant Écriture. Posez-moi des questions sur vos personnages, l'intrigue ou demandez-moi des idées pour votre scène en cours.";
            chatMessages = [
                { role: "assistant", content: welcomeText }
            ];
            renderChat();
        }

        function renderChat() {
            const container = document.getElementById('chat-messages');
            if (!container) return;
            container.innerHTML = "";

            chatMessages.forEach(msg => {
                const bubble = document.createElement('div');
                if (msg.role === "user") {
                    bubble.className = "bg-indigo-50 text-indigo-950 p-2.5 rounded-lg border border-indigo-100 ml-6 self-end shadow-2xs max-w-[85%]";
                } else {
                    bubble.className = "bg-slate-50 text-slate-800 p-2.5 rounded-lg border border-slate-100 mr-6 self-start shadow-2xs max-w-[85%] whitespace-pre-line";
                }
                bubble.innerText = msg.content;
                container.appendChild(bubble);
            });

            container.scrollTop = container.scrollHeight;
        }

        async function sendChatMessage() {
            const input = document.getElementById('chat-input');
            const content = input.value.trim();
            if (!content) return;

            input.value = "";

            chatMessages.push({ role: "user", content });
            renderChat();

            const loadingIndex = chatMessages.length;
            chatMessages.push({ role: "assistant", content: "..." });
            renderChat();

            try {
                const data = await window.api_invoke('ai_chat', {
                    messages: chatMessages.slice(0, loadingIndex),
                    lang: window.activeLang
                });
                chatMessages[loadingIndex] = { role: "assistant", content: data.message };
            } catch (err) {
                chatMessages[loadingIndex] = { role: "assistant", content: translations["error_network_connection"] || "Error: Network connection failed." };
            }

            renderChat();
        }

        // LORE EXTRACTION
        async function extractLoreFromScene() {
            const editor = document.getElementById('editor-content');
            const text = editor ? editor.innerText : "";
            if (!text || !text.trim()) {
                alert(translations["text_is_empty"] || "Text is empty.");
                return;
            }

            const btn = document.querySelector('button[onclick="extractLoreFromScene()"]');
            const originalContent = btn.innerHTML;
            btn.innerHTML = `⏳ ${translations["analyzing"] || "Analyzing and generating..."}`;
            btn.disabled = true;

            try {
                {
                    const data = await window.api_invoke('ai_extract_characters', { text: text, lang: window.activeLang });
                    if (data.status === "success" && data.characters && data.characters.length > 0) {
                        let newChars = 0;
                        data.characters.forEach(extractedChar => {
                            // Check if char exists
                            let exists = projectData.characters.find(c =>
                                c.name.toLowerCase() === extractedChar.name.toLowerCase() ||
                                (c.aliases && c.aliases.map(a => a.toLowerCase()).includes(extractedChar.name.toLowerCase()))
                            );

                            if (!exists) {
                                const newChar = {
                                    id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                    name: extractedChar.name,
                                    type: "personnage",
                                    description: extractedChar.notes || "",
                                    role: "",
                                    aliases: [],
                                    traits: extractedChar.traits || [],
                                    appearance: extractedChar.appearance || "",
                                    relations: [],
                                    linked_scenes: [],
                                    notes: extractedChar.notes || ""
                                };
                                projectData.characters.push(newChar);
                                newChars++;
                            } else {
                                // Update existing char conditionally
                                if (!exists.appearance && extractedChar.appearance) exists.appearance = extractedChar.appearance;
                                if (extractedChar.traits) {
                                    extractedChar.traits.forEach(t => {
                                        if (!exists.traits.includes(t)) exists.traits.push(t);
                                    });
                                }
                            }
                        });

                        triggerAutoSave();
                        renderTree();
                        alert(formatTranslation("chars_extracted_success", { count: newChars }) || `${newChars} character(s) extracted and added successfully!`);
                    } else {
                        alert(translations["no_characters_detected"] || "No characters detected.");
                    }
                }
            } catch (err) {
                alert(translations["network_error"] || "Network error.");
            } finally {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        }
        window.extractLoreFromScene = extractLoreFromScene;

        // CHARACTER INTERVIEW
        let interviewCharId = null;
        let interviewMessages = [];

        function openInterviewModal(charId) {
            const char = projectData.characters.find(c => c.id === charId);
            if (!char) return;

            interviewCharId = charId;
            interviewMessages = [];

            document.getElementById('interview-character-name').innerText = char.name;

            // Initial system prompt to set personality
            const sysPrompt = `Tu dois incarner le personnage suivant et répondre exactement comme lui. Ne sors JAMAIS de ton personnage.\n` +
                `Nom: ${char.name}\n` +
                `Apparence: ${char.appearance}\n` +
                `Traits: ${char.traits.join(', ')}\n` +
                `Notes: ${char.notes}\n` +
                `Description: ${char.description}\n`;

            interviewMessages.push({ role: "system", content: sysPrompt });

            const firstMsg = window.activeLang === 'fr' ?
                `*Vous vous asseyez en face de ${char.name}.* Bonjour, pouvons-nous discuter ?` :
                `*You sit across from ${char.name}.* Hello, can we talk?`;

            interviewMessages.push({ role: "user", content: firstMsg });

            document.getElementById('interview-modal').classList.remove('hidden');
            document.getElementById('interview-chat-messages').innerHTML = "";
            document.getElementById('interview-chat-input').value = "";

            // Trigger first AI response
            _sendInterviewRequest();
        }
        window.openInterviewModal = openInterviewModal;

        function closeInterviewModal() {
            document.getElementById('interview-modal').classList.add('hidden');
            interviewCharId = null;
            interviewMessages = [];
        }
        window.closeInterviewModal = closeInterviewModal;

        function renderInterviewChat() {
            const container = document.getElementById('interview-chat-messages');
            container.innerHTML = "";

            interviewMessages.forEach(msg => {
                if (msg.role === "system") return; // hide system prompts

                const div = document.createElement('div');
                if (msg.role === "user") {
                    div.className = "bg-indigo-600 text-white p-2.5 rounded-lg border border-indigo-700 self-end ml-6 shadow-2xs";
                    div.innerText = msg.content;
                } else if (msg.role === "assistant") {
                    div.className = "bg-white text-slate-700 p-2.5 rounded-lg border border-slate-200 self-start mr-6 shadow-2xs";
                    div.innerText = msg.content;
                }
                container.appendChild(div);
            });
            container.scrollTop = container.scrollHeight;
        }

        async function _sendInterviewRequest() {
            renderInterviewChat();

            // Add loading
            const loadingIdx = interviewMessages.length;
            interviewMessages.push({ role: "assistant", content: "..." });
            renderInterviewChat();

            try {
                const data = await window.api_invoke('ai_chat', {
                    messages: interviewMessages.slice(0, loadingIdx),
                    lang: window.activeLang
                });
                interviewMessages[loadingIdx].content = data.message;
            } catch (e) {
                interviewMessages[loadingIdx].content = "Error.";
            }
            renderInterviewChat();
        }

        function sendInterviewMessage() {
            const input = document.getElementById('interview-chat-input');
            const content = input.value.trim();
            if (!content) return;

            input.value = "";
            interviewMessages.push({ role: "user", content: content });

            _sendInterviewRequest();
        }
        window.sendInterviewMessage = sendInterviewMessage;



        // POV DROPDOWN
        function togglePovDropdown(event) {
            event.stopPropagation();
            const menu = document.getElementById('ai-pov-dropdown-menu');
            if (menu) {
                menu.classList.toggle('hidden');
            }
        }
        window.togglePovDropdown = togglePovDropdown;

        // BRAINSTORM MODAL
        function openBrainstormModal() {
            document.getElementById('brainstorm-modal').classList.remove('hidden');
            selectBrainstormTab('complications');
        }
        window.openBrainstormModal = openBrainstormModal;

        function closeBrainstormModal() {
            document.getElementById('brainstorm-modal').classList.add('hidden');
            document.getElementById('complications-result').classList.add('hidden');
            document.getElementById('names-result').classList.add('hidden');
        }
        window.closeBrainstormModal = closeBrainstormModal;

        function selectBrainstormTab(tab) {
            document.getElementById('brainstorm-pane-complications').classList.add('hidden');
            document.getElementById('brainstorm-pane-names').classList.add('hidden');

            document.getElementById('tab-brainstorm-complications').className = "flex-1 py-1.5 rounded-md font-semibold transition-all text-slate-500 hover:text-slate-800";
            document.getElementById('tab-brainstorm-names').className = "flex-1 py-1.5 rounded-md font-semibold transition-all text-slate-500 hover:text-slate-800";

            if (tab === 'complications') {
                document.getElementById('brainstorm-pane-complications').classList.remove('hidden');
                document.getElementById('tab-brainstorm-complications').className = "flex-1 py-1.5 rounded-md font-semibold transition-all bg-white text-slate-800 shadow-xs";
            } else {
                document.getElementById('brainstorm-pane-names').classList.remove('hidden');
                document.getElementById('tab-brainstorm-names').className = "flex-1 py-1.5 rounded-md font-semibold transition-all bg-white text-slate-800 shadow-xs";
            }
        }
        window.selectBrainstormTab = selectBrainstormTab;

        async function generateComplications() {
            const editor = document.getElementById('editor-content');
            const text = editor ? editor.innerText.trim() : "";

            if (!text) {
                alert(formatTranslation("error_empty_scene") || "The current scene is empty. Add text to generate complications.");
                return;
            }

            const resultContainer = document.getElementById('complications-result');
            resultContainer.innerText = `⏳ ${translations["analyzing"] || "Analyzing and generating..."}`;
            resultContainer.classList.remove('hidden');

            try {
                const data = await window.api_invoke('ai_tool', {
                    tool: 'complications',
                    style: '',
                    text: text,
                    lang: window.activeLang
                });
                resultContainer.innerText = data.message;
            } catch (err) {
                console.error("AI Complications error:", err);
                resultContainer.innerText = translations["error_ai_service_connect"] || "Error: Failed to connect to AI service.";
            }
        }
        window.generateComplications = generateComplications;

        async function generateNames() {
            const styleInput = document.getElementById('names-style-input').value.trim();
            if (!styleInput) {
                alert(translations["enter_style_alert"] || "Please enter a style or linguistic roots.");
                return;
            }

            const resultContainer = document.getElementById('names-result');
            resultContainer.innerText = `⏳ ${translations["generating"] || "Generating..."}`;
            resultContainer.classList.remove('hidden');

            try {
                const data = await window.api_invoke('ai_tool', {
                    tool: 'names',
                    style: styleInput,
                    text: "", // Text is not needed for names generation
                    lang: window.activeLang
                });
                resultContainer.innerText = data.message;
            } catch (err) {
                console.error("AI Names error:", err);
                resultContainer.innerText = translations["error_ai_service_connect"] || "Error: Failed to connect to AI service.";
            }
        }
        window.generateNames = generateNames;
