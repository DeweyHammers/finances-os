# Plan: a phone-native UI for the Android app

Drafted 2026-10-29 after the first install of the Phase C APK on the user's
Galaxy S25 Ultra. The verdict: the data path works (income, bills, personal,
Overview, Statistics all read and write), but **the desktop layout squeezed
into 412 px is not a phone app**. DataGrid tables scroll sideways and cut
columns ("Du…"), header buttons are oversized, the hamburger drawer is the
only navigation, and forms are desktop modals. Also seen: the Plan shows its
"Add Group" button while the page is still loading.

This plan is the next piece of work after PR 20 (Phase C infrastructure)
merges. It is deliberately a separate PR: the infrastructure PR is large and
another chat is changing `main` in parallel, so keeping the UI work out of it
keeps the merge conflict small and the review honest.

## Status

**Approved 2026-10-29, ON HOLD** until the user's other in-flight changes
reach `main`; PR 20 then needs a merge of `main` before anything else. The
user's brief for the design: *use your best judgment to make it look clean on
a phone — the way Discord's mobile app looks different from its desktop app
instead of being the desktop app shrunk*. So the phone shell is designed as
its own app from the phone's conventions (bottom tabs, lists, sheets, one
primary action per screen, thumb-reach controls), not as a responsive
variant of the desktop pages; shared maths and data only. The three
decisions below are settled as recommended.

## Decisions to take first (user) — settled

1. **One renderer, two shells** (recommended) vs a second app. Recommended:
   keep ONE Next.js renderer, ONE data layer, the same hooks and `lib/`
   maths, and add a **phone shell** — a second set of page components under
   `renderer/components/phone/` with its own layout. Each `app/<Route>/page.tsx`
   wrapper renders the phone component in phone mode and the desktop one
   otherwise. Desktop output stays byte-identical (the user's standing rule:
   refactors never change desktop behaviour). A second app would double the
   bugs and the budget maths would drift.
2. **What "phone mode" means.** Recommended: `isNativeApp()` (the Capacitor
   app) OR a narrow viewport (below the existing `SIDER_BREAKPOINT`). The
   native app always gets the phone shell, and a browser at phone width gets
   it too, which is what makes it testable on the PC (`npm run android:browser`).
   Alternative: native only, so a narrow desktop window keeps the desktop UI.
3. **Scope of the first phone release.** The use case that drove the plan was
   *"see my budget at work and add transactions"*. Recommended order:
   Overview → Cash (ledger + Add transaction) → Plan → Bills/Personal/Yearly
   as simple lists → Settings → Statistics last. Everything not yet rebuilt
   keeps the current (desktop) component until its turn, so the app is never
   missing a page.

## The phone shell

- **Navigation: a bottom tab bar**, not a drawer. Four tabs: Overview, Plan,
  Cash, More (Bills, Personal, Yearly costs, Payees, Statistics, Income,
  Settings as a plain list). MUI `BottomNavigation`, 56 px, safe-area aware.
  The top bar shrinks to a title row with a back arrow on sub-pages (Cash →
  account ledger, More → Bills). The Android back button already pops the
  WebView history, which matches.
- **A floating "+" button on Cash** (the account list and the ledger) opens
  Add transaction as a **full-screen sheet** with the keyboard-friendly order
  amount → payee → category → memo → date; outflow/inflow as a toggle, not two
  fields. That is the one flow that has to be fast on a phone.
- **Lists instead of tables.** Bills, Personal, Yearly costs, Payees and the
  ledger become `List` rows (name left, amount right, one secondary line:
  "Due 15th", "Every pay week", payee + category). Tap = edit sheet, long
  press or an overflow menu = delete with confirm. No DataGrid, no horizontal
  scroll, no pagination (lists are short; search box stays where it exists).
- **Forms as full-screen dialogs** (`Dialog fullScreen` with a top app bar:
  Cancel · title · Save). The existing form field components
  (`TransactionFormFields`, bill/personal/yearly fields) are reused as-is;
  only the container changes.
- **Overview on the phone:** the three summary tiles become one compact row
  (three small numbers), then the pay-week cards as a vertical list with the
  current week first and expanded, the others collapsed to a one-line summary
  (income · expenses · surplus). Optimize and the month picker stay; the
  surplus pill becomes a line of text.
- **Plan on the phone:** groups as collapsible sections, each item one row
  (name, assigned, available) with tap → assign sheet (the existing
  AssignMoneyPopover content, full screen). Ready to Assign stays sticky at
  the top. Drag-reorder is desktop-only. The ⚠ badge and Sync Plan keep
  working through the shared `evaluatePlanSync`.
- **Loading states: skeletons, never half a toolbar.** Fix the Plan's bug on
  both shells now: hide "Add Group" with the same `visibility: hidden` gate
  the Ready-to-Assign pill already uses while `isLoading`
  (BudgetPage.tsx toolbar). Phone pages render skeleton rows during load.
- **Typography and spacing** come down one step on the phone (h4 → h5 on
  titles, button `size="medium"`, 16 px gutters, 44 px tap targets). Dark
  theme unchanged. Status bar colour = the canvas colour (styles.xml), splash
  and icon from the logo (`@capacitor/assets`, Phase C step 9).

## What stays shared (no duplication)

Everything under `renderer/lib/` (pay periods, budget maths, optimize plan,
cents, dates), every Refine hook call pattern, the data layer, Settings'
content rows (`SettingsRows.tsx`), the form field components, `SandboxContext`,
`SyncStatusProvider`, `ConnectionStatus`. The phone shell is layout and
navigation only. A test per phone page pins that it reads the same numbers
as the desktop page for the same fixture (the generic-data tests, not the
gitignored real-data lock-ins).

## Phases

| # | Piece | Lands as |
| --- | --- | --- |
| 0 | Plan "Add Group" during load (both shells); `isPhoneShell()` + the route-wrapper switch; bottom tab bar + More page; phone top bar | PR "phone shell" |
| 1 | Cash: account list, ledger as a list, FAB + full-screen Add/Edit transaction | PR |
| 2 | Overview phone layout | PR |
| 3 | Plan phone layout + assign sheet | PR |
| 4 | Bills / Personal / Yearly / Payees as lists with sheets; Income page | PR |
| 5 | Settings page tightened for the phone (it is already a page there); Statistics | PR |
| 6 | Icon, splash, status bar; first signed release with the APK | with the release |

Each PR is checked at 412×915 in the browser check AND with a trial APK on
the phone before it merges. Desktop unchanged in every one (the existing
tests and the local lock-ins are the guard).

## Install friction (what the phone fought about)

Sideloading a debug-signed APK trips every protection Android has:
"unknown app source" per browser, Play Protect "unknown developer", and on a
Samsung the Auto Blocker. What helps, in order:

1. **A release-signed APK with the project's one keystore** (the four repo
   secrets from `docs/android-release.md`). The debug key changes per build
   and looks like malware to Play Protect; a stable key does not stop the
   first-install warning but stops the "harmful app" tier and lets updates
   install over the old version.
2. **Keep the same key forever.** Every later APK then installs as an update
   with one tap and no new prompts beyond Play Protect's scan.
3. **Play Store** is the only thing that removes the warnings entirely. It
   costs a one-time $25 developer fee and a review; out of scope while the
   budget is zero, noted here as the eventual answer.
4. The README's Android section should say plainly which prompts to expect
   (Install unknown apps → allow for the browser; Play Protect → "Install
   anyway"; Samsung Auto Blocker → off for the install, back on after).

## Merge order with the other chat's work

1. The other branch merges to `main` first (it is further along).
2. `android-app` merges `main` (`sync_with_base_branch`), conflicts resolved
   in this session (expected: CLAUDE.md, README, maybe Settings), tests green,
   PR 20 merges.
3. The phone-shell PRs above branch from the merged `main`.
