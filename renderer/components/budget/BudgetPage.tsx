"use client";

import { useState, useMemo } from "react";
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
} from "./BudgetTable";
import { AddGroupModal } from "./AddGroupModal";
import { AddItemModal } from "./AddItemModal";
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

const startOfThisMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export const BudgetPage = () => {
  const month = useMemo(() => startOfThisMonth(), []);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [addItemGroupId, setAddItemGroupId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<BudgetItem | null>(null);
  const [moveAnchor, setMoveAnchor] = useState<{
    item: BudgetItem;
    el: HTMLElement;
  } | null>(null);
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
    return allGroups
      .map((g): BudgetGroup => {
        const items = allItems
          .filter((i) => i.groupId === g.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i): BudgetItem => {
            const assigned = getAssignment(i.id, month)?.assignedCents || 0;
            const activity = computeActivity(allTxns, i.id, month);
            const available = computeAvailableChain(i.id, month);
            return {
              id: i.id,
              groupId: i.groupId,
              name: i.name,
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
          });
        return {
          id: g.id,
          name: g.name,
          sortOrder: g.sortOrder,
          items,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [allGroups, allItems, allMonths, allTxns, monthIso]);

  const allFlatItems = groups.flatMap((g) => g.items);

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

  const moveOptions: MoveMoneyOption[] = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.map((it) => ({
          itemId: it.id,
          itemName: it.name,
          availableCents: it.availableCents,
          groupId: g.id,
          groupName: g.name,
        })),
      ),
    [groups],
  );

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
            cents={readyToAssign}
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
