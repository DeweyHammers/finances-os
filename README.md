# Freelance OS

A comprehensive financial operating system and desktop workstation built for freelancers to manage the complexities of self-employment, contract work, and personal finances in one unified interface.

## Core Features

### 💼 Contract & Client Management
- **Smart Contracts:** Manage both hourly and fixed-rate contracts with automated net/gross rate calculations.
- **Upwork Integration:** Built-in support for platform fees (e.g., 10%) and tax provision tracking.
- **Client CRM:** Centralized database linking clients to their respective active and historical contracts.
- **Planned Work Blocks:** Integrated calendar system to schedule and track contract hours.

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
