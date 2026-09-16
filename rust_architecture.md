# Rust Architecture Description

## Overview
This document outlines the data model, user interface, and features of the "Écriture" project. The purpose is to provide an AI with sufficient context to reconstruct the project in Rust, using a framework like Tauri for the frontend and a Rust backend.

## 1. Data Model
The application uses a JSON-based file format to store novels. The data is managed centrally and contains settings, manuscript content, plot data, characters, and notes.

### Core Structure
- **Settings (`settings`)**
  - `title`: String
  - `daily_goal`: Integer
  - `overall_goal`: Integer
  - `overall_written`: Integer
  - `daily_written`: Integer
  - `lang`: String

- **Manuscript (`manuscript`)**
  - A hierarchical list of chapters.
  - **Chapter**
    - `id`: String (e.g., "chap_X_YYYY")
    - `type`: "chapter"
    - `title`: String
    - `summary`: String
    - `children`: List of Scenes
  - **Scene**
    - `id`: String (e.g., "scene_X_YYYY")
    - `type`: "scene"
    - `title`: String
    - `content`: String (HTML/Rich text)

- **Plot (`plot`)**
  - `plotlines`: List of `{ id, title }`
  - `cards`: List of `{ id, plotline_id, scene_id, title, content }`

- **Characters (`characters`)**
  - List of objects:
    - `id`: String
    - `name`: String
    - `role`: String
    - `description`: String

- **Story Notes (`story_notes`)**
  - List of objects:
    - `id`: String
    - `title`: String
    - `type`: String
    - `content`: String

- **Key Events (`key_events`)**
  - List of objects:
    - `id`: String
    - `title`: String
    - `description`: String
    - `chapter_id`: String
    - `characters`: List of strings (character IDs)

## 2. Features & Functionalities
The Rust backend should support the following functionalities (many of which correspond to REST endpoints in the current Python implementation):

- **Project Management:**
  - Create, load, save, list, and delete projects.
  - Active project tracking (via a config file or similar mechanism).
  - Regular auto-saves when typing.

- **Editor & Formatting:**
  - Continuous scrollable document editor.
  - Rich text formatting (Bold, Italic, Small Caps) utilizing HTML contenteditable properties.
  - Visual page breaks simulation and dynamic pagination.
  - Real-time word counting (ignoring HTML tags).

- **AI Assistant:**
  - Contextual AI rewriting, expanding, POV shifts, and description generation.
  - Local AI integration (currently using Hugging Face/Transformers).
  - Streaming responses (SSE or Tauri events).
  - AI status checking and model downloading/management.

- **Export & Import:**
  - Export document to multiple formats: DOCX, PDF, EPUB, MOBI, ODT, TXT.
  - Import external documents.

- **Linguistic Tools:**
  - Synonym lookup using local SQLite database (for French/English) and integration with NLP tools (NLTK/SpaCy currently).

- **Backup System:**
  - Create and restore local ZIP backups.
  - Choose backup directory.

## 3. User Interface (Frontend)
The frontend is currently a Single Page Application built with HTML5, Tailwind CSS, and Vanilla JavaScript, intended to be served within a native window (Pywebview currently, to be replaced by Tauri in Rust).

- **Layout:**
  - **Top Bar:** Settings, Goals/Stats tracker, Language toggle, Export button.
  - **Left Sidebar:** Navigation tree for Manuscript (Chapters/Scenes), Characters, Plot Grid, and Notes.
  - **Center Workspace:** Main continuous text editor with a fixed toolbar containing formatting and AI context actions.
  - **Right Sidebar (Optional/Collapsible):** AI Chat Assistant.

- **Modals & Dialogs:**
  - Project Settings (Title, goals, model selection).
  - Character and Note creation/editing forms.
  - AI installation progress/modals.

- **Interactivity:**
  - Native browser `document.execCommand` for text formatting.
  - Dynamic chunked DOM rendering for large novels.
  - Plot Grid with drag/drop or visual connections (timeline view).
