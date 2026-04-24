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

## 🛠 Technical Architecture

- **Desktop Core:** Built on **Nextron** (Electron + Next.js) for a high-performance, native desktop experience.
- **Backend:** Self-contained **Express API** running within the Electron main process (Port 5858).
- **UI Framework:** Leverages **Refine** and **Material UI (MUI)** for a data-heavy, professional interface.
- **Data Layer:** Powered by **Prisma** with a local **SQLite** database.
- **Production Storage:** Data is stored in your Windows user profile at `%APPDATA%\finances-os\database.db`, ensuring your data survives application updates.

## 🚀 Running the App

### Production Mode (Recommended)
The app is now optimized for a standalone native experience.

1. **Build the Application:**
   ```bash
   npm run build
   ```
2. **Launch:**
   - Run the executable directly from: `dist\win-unpacked\Finances OS.exe`
   - Use the Desktop shortcut created via the setup script.

3. **Shortcut Setup (Bypassing Windows Smart App Control):**
   Windows 11 may block local unsigned executables. To bypass this safely while using production files, run:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File setup-desktop-icon.ps1
   ```
   This script creates shortcuts that use the **signed Electron host** to load your production code, which Windows trusts.

### Development Mode
For making changes and testing:
```bash
npm run dev
```

## 📂 Project Structure

- `/main`: Electron main process and built-in Express API server.
- `/renderer`: Next.js frontend application containing all UI components.
- `/shared`: Shared logic (Prisma client, constants) used by both Main and Renderer processes.
- `/prisma`: Database schema and migration management.
- `/resources`: Application icons and platform-specific assets.
