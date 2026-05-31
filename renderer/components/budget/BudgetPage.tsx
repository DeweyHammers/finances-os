"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  Button,
  Snackbar,
  Alert,
  Paper,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useList, useCreate, useUpdate } from "@refinedev/core";
import { ReadyToAssignPill } from "./ReadyToAssignPill";
import {
  BudgetTable,
  BudgetGroup,
  BudgetItem,
  BudgetSubsection,
} from "./BudgetTable";
import { AddGroupModal } from "./AddGroupModal";
import { AddItemModal } from "./AddItemModal";
import { AddSubsectionModal } from "./AddSubsectionModal";
import { EditItemModal } from "./EditItemModal";
import {
  MoveMoneyPopover,
  MoveMoneyOption,
} from "./MoveMoneyPopover";
import {
  AssignMoneyPopover,
  AssignTargetOption,
} from "./AssignMoneyPopover";
import {
  computeActivity,
  computeAvailable,
  computeReadyToAssign,
  monthStart,
  resolveAutoAssignAmount,
} from "../../lib/budget-utils";
import { resolveItemDisplay } from "../../lib/budget-display";
import { usePaymentCycle } from "../../lib/usePaymentCycle";

const startOfThisMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export const BudgetPage = () => {
  const month = useMemo(() => startOfThisMonth(), []);
  const { cycles: paymentCycles } = usePaymentCycle();
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [addItemGroupId, setAddItemGroupId] = useState<string | null>(null);
  const [addSubsectionGroup, setAddSubsectionGroup] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editItem, setEditItem] = useState<BudgetItem | null>(null);
  const [moveAnchor, setMoveAnchor] = useState<{
    item: BudgetItem;
    el: HTMLElement;
  } | null>(null);
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // While a multi-step move is in flight (decrement source then increment
  // destination), the derived Ready-to-Assign value would briefly flash to a
  // positive amount between those two writes. We snapshot the pre-move RTA
  // and hold it for a short window to keep the pill visually stable.
  const [rtaHold, setRtaHold] = useState<number | null>(null);
  const rtaHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (rtaHoldTimerRef.current) clearTimeout(rtaHoldTimerRef.current);
    };
  }, []);

  const { query: groupsQuery } = useList({
    resource: "BudgetCategoryGroup",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: itemsQuery } = useList({
    resource: "BudgetCategoryItem",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: subsectionsQuery } = useList({
    resource: "BudgetCategorySubsection",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: monthsQuery } = useList({
    resource: "BudgetMonth",
    pagination: { mode: "off" },
  });
  const { query: txnsQuery } = useList({
    resource: "AccountTransaction",
    pagination: { mode: "off" },
  });
  const { query: billsQuery } = useList({
    resource: "Bill",
    pagination: { mode: "off" },
  });
  const { query: personalsQuery } = useList({
    resource: "Personal",
    pagination: { mode: "off" },
  });

  const { mutate: createBudgetMonth } = useCreate();
  const { mutate: updateBudgetMonth } = useUpdate();

  const allGroups = (groupsQuery.data?.data as any[]) || [];
  const allItems = (itemsQuery.data?.data as any[]) || [];
  const allSubsections = (subsectionsQuery.data?.data as any[]) || [];
  const allMonths = (monthsQuery.data?.data as any[]) || [];
  const allTxns = (txnsQuery.data?.data as any[]) || [];
  const bills = (billsQuery.data?.data as any[]) || [];
  const personals = (personalsQuery.data?.data as any[]) || [];

  const monthIso = month.toISOString();

  const getAssignment = (itemId: string, m: Date) => {
    const key = m.toISOString();
    return allMonths.find(
      (a) => a.categoryItemId === itemId && a.month === key,
    );
  };

  const computeAvailableChain = (itemId: string, target: Date): number => {
    let cumulative = 0;
    const earliest = (() => {
      const dates = allMonths
        .filter((m) => m.categoryItemId === itemId)
        .map((m) => new Date(m.month));
      if (dates.length === 0) return target;
      const min = dates.reduce((a, b) => (a < b ? a : b));
      return min < target ? min : target;
    })();
    let cursor = monthStart(earliest);
    while (cursor.getTime() <= target.getTime()) {
      const a =
        allMonths.find(
          (m) =>
            m.categoryItemId === itemId &&
            new Date(m.month).getTime() === cursor.getTime(),
        )?.assignedCents || 0;
      const act = computeActivity(allTxns, itemId, cursor);
      cumulative = computeAvailable({
        priorAvailable: cumulative,
        assignedCents: a,
        activityCents: act,
      });
      cursor = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth() + 1,
          1,
        ),
      );
    }
    return cumulative;
  };

  const groups: BudgetGroup[] = useMemo(() => {
    const toItem = (i: any): BudgetItem => {
      const assigned = getAssignment(i.id, month)?.assignedCents || 0;
      const activity = computeActivity(allTxns, i.id, month);
      const available = computeAvailableChain(i.id, month);
      const { liveName } = resolveItemDisplay(
        {
          name: i.name,
          sourceType: i.sourceType,
          sourceBillId: i.sourceBillId,
          sourcePersonalName: i.sourcePersonalName,
          customCycle: i.customCycle,
        },
        bills,
        personals,
      );
      return {
        id: i.id,
        groupId: i.groupId,
        subsectionId: i.subsectionId ?? null,
        name: liveName,
        sortOrder: i.sortOrder,
        sourceType: i.sourceType,
        sourceBillId: i.sourceBillId,
        sourcePersonalName: i.sourcePersonalName,
        customAmountCents: i.customAmountCents,
        customCycle: i.customCycle,
        assignedCents: assigned,
        activityCents: activity,
        availableCents: available,
      };
    };

    return allGroups
      .map((g): BudgetGroup => {
        const groupItems = allItems
          .filter((i) => i.groupId === g.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const directItems = groupItems
          .filter((i) => !i.subsectionId)
          .map(toItem);

        const subsections: BudgetSubsection[] = allSubsections
          .filter((s) => s.groupId === g.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => ({
            id: s.id,
            groupId: s.groupId,
            name: s.name,
            sortOrder: s.sortOrder,
            items: groupItems
              .filter((i) => i.subsectionId === s.id)
              .map(toItem),
          }));

        return {
          id: g.id,
          name: g.name,
          sortOrder: g.sortOrder,
          items: directItems,
          subsections,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [
    allGroups,
    allItems,
    allSubsections,
    allMonths,
    allTxns,
    bills,
    personals,
    monthIso,
  ]);

  const allFlatItems = groups.flatMap((g) => [
    ...g.items,
    ...g.subsections.flatMap((s) => s.items),
  ]);

  const readyToAssign = useMemo(
    () =>
      computeReadyToAssign({
        transactions: allTxns,
        assignments: allMonths,
      }),
    [allTxns, allMonths],
  );

  const upsertAssignment = (itemId: string, newCents: number) => {
    const existing = getAssignment(itemId, month);
    if (existing) {
      updateBudgetMonth(
        {
          resource: "BudgetMonth",
          id: existing.id,
          values: { assignedCents: newCents },
          successNotification: false,
        },
      );
    } else {
      createBudgetMonth(
        {
          resource: "BudgetMonth",
          values: {
            month: monthIso,
            categoryItemId: itemId,
            assignedCents: newCents,
          },
          successNotification: false,
        },
      );
    }
  };

  const handleAutoAssign = (cycle: string) => {
    let count = 0;
    let totalCents = 0;
    allFlatItems.forEach((it) => {
      const target = resolveAutoAssignAmount({
        item: {
          id: it.id,
          sourceType: it.sourceType as "BILL" | "PERSONAL_NAME" | "CUSTOM",
          sourceBillId: it.sourceBillId,
          sourcePersonalName: it.sourcePersonalName,
          customAmountCents: it.customAmountCents,
          customCycle: it.customCycle,
        },
        cycle,
        bills,
        personals,
      });
      if (target > 0) {
        const current = it.assignedCents;
        upsertAssignment(it.id, current + target);
        count++;
        totalCents += target;
      }
    });
    setToast(
      `Assigned ${(totalCents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })} across ${count} items for ${cycle}`,
    );
  };

  const handleMoveMoney = (params: {
    sourceItemId: string;
    destItemId: string | null;
    amountCents: number;
  }) => {
    const src = allFlatItems.find((i) => i.id === params.sourceItemId);
    if (!src) {
      setMoveAnchor(null);
      return;
    }
    // Snapshot the RTA before the two-step write so the pill stays stable
    // (avoids the green "Ready to Assign" flash between the decrement and
    // increment when moving between categories).
    if (params.destItemId) {
      setRtaHold(readyToAssign);
      if (rtaHoldTimerRef.current) clearTimeout(rtaHoldTimerRef.current);
      rtaHoldTimerRef.current = setTimeout(() => setRtaHold(null), 700);
    }
    upsertAssignment(src.id, src.assignedCents - params.amountCents);
    if (params.destItemId) {
      const dst = allFlatItems.find((i) => i.id === params.destItemId);
      if (dst)
        upsertAssignment(dst.id, dst.assignedCents + params.amountCents);
    }
    // When destItemId is null, money flows back into Ready to Assign by virtue
    // of the source's reduced assignment (RTA = uncategorized inflows - assignments).
    setMoveAnchor(null);
  };

  const moveOptions: MoveMoneyOption[] = useMemo(() => {
    const buildName = (it: BudgetItem) =>
      resolveItemDisplay(
        {
          name: it.name,
          sourceType: it.sourceType,
          sourceBillId: it.sourceBillId,
          sourcePersonalName: it.sourcePersonalName,
          customCycle: it.customCycle,
        },
        bills,
        personals,
      ).displayName;
    const result: MoveMoneyOption[] = [];
    groups.forEach((g) => {
      // Interleave direct items and subsections at the group level by sortOrder
      // so the popover lists them in the same order the Plan shows.
      type Row =
        | { kind: "item"; item: BudgetItem; sortOrder: number }
        | { kind: "sub"; sub: BudgetSubsection; sortOrder: number };
      const rows: Row[] = [
        ...g.items.map((item) => ({
          kind: "item" as const,
          item,
          sortOrder: item.sortOrder,
        })),
        ...g.subsections.map((sub) => ({
          kind: "sub" as const,
          sub,
          sortOrder: sub.sortOrder,
        })),
      ];
      rows.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.kind === "item" ? -1 : 1;
      });
      rows.forEach((row) => {
        if (row.kind === "item") {
          result.push({
            itemId: row.item.id,
            itemName: buildName(row.item),
            availableCents: row.item.availableCents,
            groupId: g.id,
            groupName: g.name,
          });
        } else {
          row.sub.items.forEach((it) => {
            result.push({
              itemId: it.id,
              itemName: buildName(it),
              availableCents: it.availableCents,
              groupId: g.id,
              groupName: `${g.name} / ${row.sub.name}`,
            });
          });
        }
      });
    });
    return result;
  }, [groups, bills, personals]);

  const assignOptions: AssignTargetOption[] = moveOptions;

  const handleManualAssign = (params: {
    itemId: string;
    amountCents: number;
  }) => {
    const item = allFlatItems.find((i) => i.id === params.itemId);
    if (!item) return;
    upsertAssignment(item.id, item.assignedCents + params.amountCents);
    setAssignAnchor(null);
    setToast(
      `Assigned ${(params.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })} to ${item.name}`,
    );
  };

  const isLoading =
    groupsQuery.isLoading ||
    itemsQuery.isLoading ||
    subsectionsQuery.isLoading ||
    monthsQuery.isLoading ||
    txnsQuery.isLoading;

  return (
    <Box
      sx={{
        height: "100%",
        p: 4,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Box />
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <ReadyToAssignPill
            cents={rtaHold ?? readyToAssign}
            onAssignClick={(el) => setAssignAnchor(el)}
          />
        </Box>
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}
        >
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setAddGroupOpen(true)}
            sx={{ fontWeight: 700, borderRadius: 2 }}
          >
            Add Group
          </Button>
        </Box>
      </Box>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
          <CircularProgress />
        </Box>
      ) : groups.length === 0 ? (
        <Paper
          sx={{
            py: 8,
            textAlign: "center",
            bgcolor: "rgba(15, 23, 42, 0.3)",
            border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: 3,
          }}
        >
          <Typography sx={{ color: "text.secondary", mb: 2 }}>
            No category groups yet.
          </Typography>
          <Button
            variant="contained"
            disableElevation
            startIcon={<AddIcon />}
            onClick={() => setAddGroupOpen(true)}
            sx={{ fontWeight: 800, borderRadius: 2 }}
          >
            Create your first group
          </Button>
        </Paper>
      ) : (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, md: 3 },
            borderRadius: 4,
            bgcolor: "rgba(30, 41, 59, 0.5)",
            border: "1px solid rgba(129, 140, 248, 0.1)",
            overflow: "hidden",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <BudgetTable
            groups={groups}
            bills={bills}
            personals={personals}
            onAvailableClick={(item, el) => setMoveAnchor({ item, el })}
            onAddItem={(groupId) => setAddItemGroupId(groupId)}
            onAddSubsection={(group) => setAddSubsectionGroup(group)}
            onEditItem={(item) => setEditItem(item)}
          />
        </Paper>
      )}

      <AddGroupModal
        open={addGroupOpen}
        onClose={() => setAddGroupOpen(false)}
        nextSortOrder={allGroups.length}
      />
      <AddItemModal
        open={!!addItemGroupId}
        groupId={addItemGroupId}
        nextSortOrder={
          addItemGroupId
            ? allItems.filter((i) => i.groupId === addItemGroupId).length
            : 0
        }
        onClose={() => setAddItemGroupId(null)}
      />
      <AddSubsectionModal
        open={!!addSubsectionGroup}
        groupId={addSubsectionGroup?.id ?? null}
        groupName={addSubsectionGroup?.name}
        nextSortOrder={
          addSubsectionGroup
            ? allSubsections.filter(
                (s) => s.groupId === addSubsectionGroup.id,
              ).length
            : 0
        }
        onClose={() => setAddSubsectionGroup(null)}
      />
      <EditItemModal
        open={!!editItem}
        item={editItem}
        onClose={() => setEditItem(null)}
      />
      <MoveMoneyPopover
        open={!!moveAnchor}
        anchorEl={moveAnchor?.el || null}
        sourceItemId={moveAnchor?.item.id || ""}
        sourceName={moveAnchor?.item.name || ""}
        sourceAvailableCents={moveAnchor?.item.availableCents || 0}
        options={moveOptions}
        onClose={() => setMoveAnchor(null)}
        onMove={handleMoveMoney}
      />
      <AssignMoneyPopover
        open={!!assignAnchor}
        anchorEl={assignAnchor}
        options={assignOptions}
        cycles={paymentCycles}
        onClose={() => setAssignAnchor(null)}
        onManualAssign={handleManualAssign}
        onAutoAssign={handleAutoAssign}
      />
      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setToast(null)}
        >
          {toast}
        </Alert>
      </Snackbar>
    </Box>
  );
};
