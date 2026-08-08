# Tarik OS: Habits Module UX Specification

This document outlines the user experience, information architecture, and visual design for the new **Habits** section within the Tarik OS frontend. It translates the principles of *Atomic Habits* and the Atoms app into the existing command-center aesthetic, focusing on identity-driven action, system design, and trajectory tracking rather than gamified streaks.

## 1. Design Principles & Aesthetic Fit

The existing Tarik OS interface is characterized by a dark, dense, desktop-first command-center aesthetic. It uses a near-black background, charcoal dividers, monospaced typography for data, and vivid color-coded navigation (cyan, orange, violet). 

The Habits module must fit this environment. It should feel like an "operating system" for personal growth—disciplined, analytical, and highly functional. It rejects the soft, bubbly, mobile-first design of consumer habit trackers (like Atoms) in favor of a serious, dashboard-style interface.

### Key Adaptations from *Atomic Habits* / Atoms:
*   **Identity First:** Habits are not just checklists; they are "votes" for a chosen identity.
*   **System > Goal:** Focus on the cue, the minimum action, and friction reduction.
*   **Trajectory Tracking:** Separate leading indicators (actions) from lagging indicators (outcomes).
*   **Contextual Lessons:** Short, actionable insights presented as "Field Notes" rather than a separate learning tab.

## 2. Information Architecture

The Habits module (accessible via a new left-rail navigation button) is divided into three primary vertical panels, matching the existing Tarik OS layout structure:

### Left Panel: The Identity & System Console
*   **Active Pillars:** A list of 3-5 active life pillars (e.g., AI Career, Python Skills, Health).
*   **Identity Statement:** A clear statement of who the user is becoming in each pillar.
*   **System Design (The "Atom"):** For the selected pillar, the specific habit loop is defined:
    *   *Cue:* When and where it happens (Implementation Intention) or the preceding action (Habit Stack).
    *   *Minimum Action:* The 2-minute version.
    *   *Standard Action:* The ideal daily practice.
*   **Friction Log:** A quick-entry field to log what made the habit difficult today, prompting future redesign.

### Center Panel: The Daily Vote (Tracker)
*   **Today's Votes:** A focused, distraction-free view of the day's minimum and standard actions across all active pillars.
*   **Completion Interaction:** Instead of a mobile "press and hold," completion is logged via a crisp, satisfying toggle or terminal-style command input (e.g., `[ ] -> [X]`).
*   **Completion Levels:** Options to log "Minimum," "Standard," "Beyond," or "Intentionally Skipped."
*   **Agent Nudges:** Context-aware prompts from the AI agent (e.g., Zola) based on calendar data or time of day (e.g., "Calendar shows a 30m gap. Good time for the Python minimum action?").

### Right Panel: Trajectory & Field Notes
*   **Trajectory Graph:** A visual representation of consistency over the last 30 days, emphasizing the return to practice after a miss (never miss twice) rather than unbroken streaks.
*   **Lagging Indicators:** A space to record delayed outcomes (e.g., "Shipped Hakivo update") alongside the daily inputs.
*   **Field Notes (Daily Lessons):** A small, rotating text block featuring a concise, relevant principle from *Atomic Habits* or the Personal Agent Habit System, contextualized to the user's current progress or recent friction logs.

## 3. Interaction Model

### Guided Habit Creation (The Protocol Builder)
When adding a new habit, the system uses a conversational, terminal-style flow:
1.  *Agent:* "What identity are you voting for?" (e.g., "I am an AI Product Manager.")
2.  *Agent:* "What is the standard daily action?"
3.  *Agent:* "What is the 2-minute minimum version for low-energy days?"
4.  *Agent:* "What is the cue? Will this be time/location-based or stacked on an existing habit?"

### Daily Review & Recovery
At the end of the day, the agent initiates a brief review:
*   "Which identity votes happened today?"
*   If a habit was missed: "Let's run a friction check. Was the cue unclear, the action too large, or the context wrong?" The UI then highlights the System Design panel for immediate adjustment.

## 4. Visual Design Specifications

*   **Colors:** Inherit the existing Tarik OS palette. Use the vibrant accents (cyan, orange) to indicate active/completed states, and muted grays for incomplete or skipped items.
*   **Typography:** Use the existing monospaced font for data points, cues, and code-like entries. Use the primary sans-serif for identity statements and field notes.
*   **Layout:** Strict grid alignment, thin borders, and high information density. Avoid rounded, floating cards; use sharp, docked panels.
*   **Data Visualization:** Use simple, terminal-style sparklines or blocky heatmaps (like GitHub contribution graphs) for the Trajectory view, fitting the developer-centric aesthetic.

## 5. Privacy & Auto-Detection Rules
*   **Work/Project Habits:** Can be auto-detected via GitHub commits, calendar events, or shipped code, but always require user confirmation (e.g., "Detected commit to Tarik OS. Log as today's Python vote? [Y/N]").
*   **Personal/Health Habits:** Strictly self-reported. The agent will not infer relationship quality or health status from external data.

## Next Steps for Implementation
1.  Create React components for the three main panels (Identity Console, Daily Vote, Trajectory).
2.  Integrate the habit data schema with the existing Tarik OS backend.
3.  Implement the conversational Protocol Builder flow via the existing agent interface.
