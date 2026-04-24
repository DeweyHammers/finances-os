# Finances OS

A comprehensive financial operating system and desktop workstation built for freelancers to manage the complexities of self-employment, contract work, and personal finances in one unified interface.

## Core Features

### 💼 Contract & Client Management

- **Smart Contracts:** Manage both hourly and fixed-rate contracts with automated net/gross rate calculations.
- **Upwork Integration:** Built-in support for platform fees (e.g., 10%) and tax provision tracking.
- **Client CRM:** Centralized database linking clients to their respective active and historical contracts.

### 💰 Comprehensive Financial Tracking

- **Income & Earnings:** Track every dollar from various sources including contract pay, W2 income, and EDD payments.
- **Withdrawal Management:** Organize funds into specific withdrawal cycles (Weekly, Bi-weekly, Monthly) or quarterly buckets (Q1-Q4).
- **Expense Optimization:** Dedicated tracking for deductible business expenses to simplify tax season.
- **Tax Provisions:** Automated calculation of tax holdings based on configurable percentages.

### 📅 Advanced Budgeting & Planning

- **Bill Tracking:** Manage recurring monthly bills and personal expenses with automated status tracking.
- **Yearly Cost Planning:** Forecast and prepare for annual expenses distributed across the calendar year.
- **EDD Dashboard:** Monitor unemployment benefits, remaining balances, and weekly reporting status.
- **Cash Flow Analysis:** Real-time dashboards for income gap analysis and bidding strategy planning.

### 🛠 Technical Architecture

- **Desktop Core:** Built on **Nextron** (Electron + Next.js) for a high-performance, native desktop experience.
- **UI Framework:** Leverages **Refine** and **Material UI (MUI)** for a data-heavy, professional interface.
- **Data Layer:** Powered by **Prisma** with a local **SQLite/LibSQL** database for speed and offline-first reliability.
- **Type Safety:** Full TypeScript implementation with **Zod** schema validation and **React Hook Form**.

## Project Structure

- `/main`: Electron main process and system-level integrations.
- `/renderer`: Next.js frontend application containing all UI components and business logic.
- `/prisma`: Database schema and migration management.
- `/lib`: Shared utilities for date formatting, payment cycles, and financial calculations.

## 🚀 Desktop Experience & Automation

To provide a seamless, OS-like experience on Windows, the project includes several custom automation scripts:

### Instant Launch Sequence
The application is launched via `launch-dev.bat`, which orchestrates a high-performance startup:
1. **Booster Splash:** Launches an independent, lightweight Electron splash screen (`resources/pre-splash.cjs`) instantly for immediate visual feedback.
2. **Environment Cleanup:** Proactively clears lingering Node/Electron processes and releases locked ports to ensure a fresh session.
3. **Terminal Hider:** Starts a background PowerShell worker (`hide-terminal.ps1`) that automatically hides all terminal and console windows associated with the project, keeping the workspace clean.

### Startup Handshake
The splash screen and main application communicate through a robust **Signal-File Handshake**:
- The splash screen creates a "heartbeat" file in the system temp directory and monitors it.
- Once the main application and Next.js dev server are fully initialized and ready to show, the main process deletes the signal file.
- The splash screen detects the deletion and self-destructs instantly, providing a smooth transition to the main dashboard.
- **Manual Override:** The splash screen is clickable; if for any reason it hangs during development, a single click will dismiss it.

