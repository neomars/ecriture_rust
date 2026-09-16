const { invoke } = window.__TAURI__.core;

window.api_invoke = async function(command, args = {}) {
    try {
        console.log("Invoking", command, args);
        return await invoke(command, args);
    } catch (e) {
        console.error("Tauri invoke error:", e);
        throw e;
    }
}
