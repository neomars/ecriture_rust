import { invoke } from "@tauri-apps/api/core";

// @ts-ignore
window.__TAURI__ = { core: { invoke } };
