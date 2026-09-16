
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
                const res = await fetch('/api/synonyms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ word: selectedText, lang: window.activeLang })
                });

                if (res.ok) {
                    const data = await res.json();
                    const synonyms = data.synonyms || [];

                    if (synonyms.length === 0) {
                        menu.innerHTML = `<div class="text-[10px] text-slate-400 p-2 italic">${window.activeLang === 'fr' ? 'Aucun synonyme' : 'No synonyms found'}</div>`;
                    } else {
                        menu.innerHTML = synonyms.map(syn => `
                            <button onclick="applySynonymReplacement('${escapeHtml(syn)}')" class="w-full text-left px-2.5 py-1.5 hover:bg-slate-700 text-slate-100 hover:text-white bg-transparent text-xs font-semibold rounded-md transition-colors block truncate">
                                ${escapeHtml(syn)}
                            </button>
                        `).join('');
                    }
                } else {
                    menu.innerHTML = `<div class="text-[10px] text-red-400 p-2 italic">${window.activeLang === 'fr' ? 'Erreur de chargement' : 'Loading error'}</div>`;
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
                const response = await fetch('/api/synonyms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ word: word, lang: window.activeLang })
                });
                const data = await response.json();

                listContainer.innerHTML = "";
                const synonyms = data.synonyms || [];

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
