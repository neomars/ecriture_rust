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
                const injectLore = (projectData.settings.inject_lore_context !== undefined) ? projectData.settings.inject_lore_context : true;
                const sceneId = (activeNodeType === "scene") ? activeNodeId : null;
                const response = await fetch('/api/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: tool,
                        style: style,
                        text: activeSelection.text,
                        temperature: (projectData.settings.ai_temperature !== undefined) ? projectData.settings.ai_temperature : 0.7,
                        model: projectData.settings.ai_model || "llama3",
                        inject_lore_context: injectLore,
                        scene_id: sceneId,
                        lang: window.activeLang
                    })
                });

                const data = await response.json();
                document.getElementById('ai-preview-loading').classList.add('hidden');

                if (response.ok) {
                    const resultContainer = document.getElementById('ai-preview-result-container');
                    resultContainer.innerText = data.message;
                    resultContainer.classList.remove('hidden');
                    document.getElementById('ai-preview-actions').classList.remove('hidden');
                } else {
                    alert((translations["error_ai_context"] || "AI error: Failed to generate") + ": " + (data.error || ""));
                    closeAiPreview();
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

                const response = await fetch('/api/relecture/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        category: activeRelectureCategory, // "style", "coherence" or "worldbuilding"
                        text: text,
                        temperature: (projectData.settings.ai_temperature !== undefined) ? projectData.settings.ai_temperature : 0.7,
                        model: projectData.settings.ai_model || "llama3",
                        lang: window.activeLang,
                        lore_context: loreContext
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    feedbackEl.innerText = data.feedback;
                } else {
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
                const injectLore = (projectData.settings.inject_lore_context !== undefined) ? projectData.settings.inject_lore_context : true;
                const sceneId = (activeNodeType === "scene") ? activeNodeId : null;
                const res = await fetch('/api/ai/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: chatMessages.slice(0, loadingIndex),
                        temperature: (projectData.settings.ai_temperature !== undefined) ? projectData.settings.ai_temperature : 0.7,
                        model: projectData.settings.ai_model || "llama3",
                        inject_lore_context: injectLore,
                        scene_id: sceneId,
                        lang: window.activeLang
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    chatMessages[loadingIndex] = { role: "assistant", content: data.message };
                } else {
                    chatMessages[loadingIndex] = { role: "assistant", content: translations["error_ai_chat"] || "Error: Could not retrieve response from AI." };
                }
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
                const res = await fetch('/api/ai/extract_characters', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: text,
                        temperature: 0.1,
                        model: projectData.settings.ai_model || "llama3",
                        lang: window.activeLang
                    })
                });

                if (res.ok) {
                    const data = await res.json();
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
                } else {
                    alert(translations["extraction_error"] || "Extraction error.");
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
                const res = await fetch('/api/ai/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: interviewMessages.slice(0, loadingIdx),
                        temperature: 0.8,
                        model: projectData.settings.ai_model || "llama3",
                        inject_lore_context: false, // We already injected it in system prompt
                        lang: window.activeLang
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    interviewMessages[loadingIdx].content = data.message;
                } else {
                    interviewMessages[loadingIdx].content = window.activeLang === 'fr' ? "Le personnage ne répond pas." : "Character doesn't reply.";
                }
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
                const injectLore = (projectData && projectData.settings && projectData.settings.inject_lore_context !== undefined) ? projectData.settings.inject_lore_context : true;
                const sceneId = (activeNodeType === "scene") ? activeNodeId : null;
                const response = await fetch('/api/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: 'complications',
                        text: text,
                        temperature: (projectData && projectData.settings && projectData.settings.ai_temperature !== undefined) ? projectData.settings.ai_temperature : 0.7,
                        model: (projectData && projectData.settings) ? projectData.settings.ai_model : "llama3",
                        inject_lore_context: injectLore,
                        scene_id: sceneId,
                        lang: window.activeLang
                    })
                });

                const data = await response.json();
                if (response.ok) {
                    resultContainer.innerText = data.message;
                } else {
                    resultContainer.innerText = (translations["error_ai_complications"] || "Error: Failed to generate complications.") + (data.error ? " " + data.error : "");
                }
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
                const response = await fetch('/api/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: 'names',
                        style: styleInput,
                        text: "", // Text is not needed for names generation
                        temperature: (projectData && projectData.settings && projectData.settings.ai_temperature !== undefined) ? projectData.settings.ai_temperature : 0.7,
                        model: (projectData && projectData.settings) ? projectData.settings.ai_model : "llama3",
                        inject_lore_context: false,
                        lang: window.activeLang
                    })
                });

                const data = await response.json();
                if (response.ok) {
                    resultContainer.innerText = data.message;
                } else {
                    resultContainer.innerText = (translations["error_ai_names"] || "Error: Failed to generate names.") + (data.error ? " " + data.error : "");
                }
            } catch (err) {
                console.error("AI Names error:", err);
                resultContainer.innerText = translations["error_ai_service_connect"] || "Error: Failed to connect to AI service.";
            }
        }
        window.generateNames = generateNames;
