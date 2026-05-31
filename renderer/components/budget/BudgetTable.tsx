"use client";

import { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  IconButton,
  Button,
  Collapse,
} from "@mui/material";
import { ConfirmDeleteDialog } from "../shared/ConfirmDeleteDialog";
import { EditSubsectionModal } from "./EditSubsectionModal";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useUpdate, useDelete } from "@refinedev/core";
import { AvailableCell } from "./AvailableCell";
import { formatMoney } from "../../lib/cents";
import { getCycleColor } from "../../lib/cycle-utils";
import { resolveItemDisplay } from "../../lib/budget-display";

export interface BudgetItem {
  id: string;
  groupId: string;
  subsectionId?: string | null;
  name: string;
  sortOrder: number;
  sourceType: string;
  sourceBillId?: string | null;
  sourcePersonalName?: string | null;
  customAmountCents?: number | null;
  customCycle?: string | null;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
}

export interface BudgetSubsection {
  id: string;
  groupId: string;
  name: string;
  sortOrder: number;
  items: BudgetItem[];
}

export interface BudgetGroup {
  id: string;
  name: string;
  sortOrder: number;
  items: BudgetItem[];
  subsections: BudgetSubsection[];
}

export interface BillRef {
  id: string;
  name: string;
  amount: number;
  dueDate: number;
  withdrawalCycle: string;
}

export interface PersonalRef {
  name: string;
  amount?: number;
  withdrawalCycle: string;
}

interface BudgetTableProps {
  groups: BudgetGroup[];
  bills?: BillRef[];
  personals?: PersonalRef[];
  onAvailableClick: (item: BudgetItem, anchor: HTMLElement) => void;
  onAddItem: (groupId: string) => void;
  onAddSubsection?: (group: { id: string; name: string }) => void;
  onEditItem?: (item: BudgetItem) => void;
}

const groupContainerId = (groupId: string) => `gc:${groupId}`;
const subsectionContainerId = (subsectionId: string) => `sc:${subsectionId}`;

type GroupRow =
  | { kind: "item"; id: string; sortOrder: number }
  | { kind: "subsection"; id: string; sortOrder: number };

const unifiedGroupRows = (g: BudgetGroup): GroupRow[] => {
  const rows: GroupRow[] = [
    ...g.items.map(
      (it): GroupRow => ({ kind: "item", id: it.id, sortOrder: it.sortOrder }),
    ),
    ...g.subsections.map(
      (s): GroupRow => ({
        kind: "subsection",
        id: s.id,
        sortOrder: s.sortOrder,
      }),
    ),
  ];
  return rows.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.kind === "item" ? -1 : 1;
  });
};

type ItemLoc =
  | { kind: "direct"; groupId: string }
  | { kind: "sub"; groupId: string; subsectionId: string };

const findItemLoc = (
  groups: BudgetGroup[],
  itemId: string,
): ItemLoc | null => {
  for (const g of groups) {
    if (g.items.some((it) => it.id === itemId))
      return { kind: "direct", groupId: g.id };
    for (const s of g.subsections) {
      if (s.items.some((it) => it.id === itemId))
        return { kind: "sub", groupId: g.id, subsectionId: s.id };
    }
  }
  return null;
};

const findSubsectionGroupId = (
  groups: BudgetGroup[],
  subsectionId: string,
): string | null => {
  for (const g of groups) {
    if (g.subsections.some((s) => s.id === subsectionId)) return g.id;
  }
  return null;
};

type OverContainer =
  | { kind: "direct"; groupId: string; overItemId?: string }
  | { kind: "sub"; groupId: string; subsectionId: string; overItemId?: string };

const resolveOver = (
  groups: BudgetGroup[],
  overId: string,
): OverContainer | null => {
  if (overId.startsWith("gc:")) {
    return { kind: "direct", groupId: overId.slice(3) };
  }
  if (overId.startsWith("sc:")) {
    const subsectionId = overId.slice(3);
    const gid = findSubsectionGroupId(groups, subsectionId);
    if (!gid) return null;
    return { kind: "sub", groupId: gid, subsectionId };
  }
  const itemLoc = findItemLoc(groups, overId);
  if (itemLoc) {
    if (itemLoc.kind === "direct")
      return { kind: "direct", groupId: itemLoc.groupId, overItemId: overId };
    return {
      kind: "sub",
      groupId: itemLoc.groupId,
      subsectionId: itemLoc.subsectionId,
      overItemId: overId,
    };
  }
  // Hovering over a subsection header at the group level — drop into that subsection
  const subGroupId = findSubsectionGroupId(groups, overId);
  if (subGroupId)
    return { kind: "sub", groupId: subGroupId, subsectionId: overId };
  return null;
};

const moveItemBetweenContainers = (
  groups: BudgetGroup[],
  itemId: string,
  target: OverContainer,
): BudgetGroup[] => {
  const fromLoc = findItemLoc(groups, itemId);
  if (!fromLoc) return groups;

  let movingItem: BudgetItem | null = null;
  const stripped = groups.map((g) => {
    if (g.id !== fromLoc.groupId) return g;
    if (fromLoc.kind === "direct") {
      const next: BudgetItem[] = [];
      g.items.forEach((it) => {
        if (it.id === itemId) movingItem = it;
        else next.push(it);
      });
      return { ...g, items: next };
    }
    return {
      ...g,
      subsections: g.subsections.map((s) => {
        if (s.id !== fromLoc.subsectionId) return s;
        const next: BudgetItem[] = [];
        s.items.forEach((it) => {
          if (it.id === itemId) movingItem = it;
          else next.push(it);
        });
        return { ...s, items: next };
      }),
    };
  });
  if (!movingItem) return groups;

  const placed: BudgetItem = {
    ...(movingItem as BudgetItem),
    groupId: target.groupId,
    subsectionId: target.kind === "sub" ? target.subsectionId : null,
  };

  return stripped.map((g) => {
    if (g.id !== target.groupId) return g;
    if (target.kind === "direct") {
      const overIdx = target.overItemId
        ? g.items.findIndex((it) => it.id === target.overItemId)
        : -1;
      const insertAt = overIdx >= 0 ? overIdx : g.items.length;
      const next = [...g.items];
      next.splice(insertAt, 0, placed);
      return { ...g, items: next };
    }
    return {
      ...g,
      subsections: g.subsections.map((s) => {
        if (s.id !== target.subsectionId) return s;
        const overIdx = target.overItemId
          ? s.items.findIndex((it) => it.id === target.overItemId)
          : -1;
        const insertAt = overIdx >= 0 ? overIdx : s.items.length;
        const next = [...s.items];
        next.splice(insertAt, 0, placed);
        return { ...s, items: next };
      }),
    };
  });
};

export const BudgetTable = ({
  groups: propGroups,
  bills = [],
  personals = [],
  onAvailableClick,
  onAddItem,
  onAddSubsection,
  onEditItem,
}: BudgetTableProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { mutate: updateItem } = useUpdate();
  const { mutate: updateSubsection } = useUpdate();
  const { mutate: deleteItem } = useDelete();
  const { mutate: deleteGroup } = useDelete();
  const { mutate: deleteSubsection } = useDelete();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [openSubsections, setOpenSubsections] = useState<
    Record<string, boolean>
  >({});
  const [pendingDeleteItem, setPendingDeleteItem] = useState<BudgetItem | null>(
    null,
  );
  const [pendingDeleteGroup, setPendingDeleteGroup] =
    useState<BudgetGroup | null>(null);
  const [pendingDeleteSubsection, setPendingDeleteSubsection] =
    useState<BudgetSubsection | null>(null);
  const [editSubsection, setEditSubsection] =
    useState<BudgetSubsection | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [groups, setGroups] = useState<BudgetGroup[]>(propGroups);
  const propsRef = useRef(propGroups);

  useEffect(() => {
    if (propsRef.current !== propGroups) {
      propsRef.current = propGroups;
      if (activeId === null) {
        setGroups(propGroups);
      }
    }
  }, [propGroups, activeId]);

  const isOpen = (id: string) =>
    openGroups[id] === undefined ? true : openGroups[id];
  const isOpenSub = (id: string) =>
    openSubsections[id] === undefined ? true : openSubsections[id];

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  };

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;
    if (activeIdStr === overIdStr) return;

    setGroups((prev) => {
      // Only handle item drags in onDragOver (subsection drags handled in onDragEnd).
      const fromLoc = findItemLoc(prev, activeIdStr);
      if (!fromLoc) return prev;

      const target = resolveOver(prev, overIdStr);
      if (!target) return prev;

      const sameContainer =
        (fromLoc.kind === "direct" &&
          target.kind === "direct" &&
          fromLoc.groupId === target.groupId) ||
        (fromLoc.kind === "sub" &&
          target.kind === "sub" &&
          fromLoc.subsectionId === target.subsectionId);

      if (sameContainer) return prev;

      return moveItemBetweenContainers(prev, activeIdStr, target);
    });
  };

  const persistChanges = (
    original: BudgetGroup[],
    final: BudgetGroup[],
  ) => {
    const origItems = new Map<string, BudgetItem>();
    const origSubs = new Map<string, BudgetSubsection>();
    original.forEach((g) => {
      g.items.forEach((it) => origItems.set(it.id, it));
      g.subsections.forEach((s) => {
        origSubs.set(s.id, s);
        s.items.forEach((it) => origItems.set(it.id, it));
      });
    });

    final.forEach((g) => {
      const rows = unifiedGroupRows(g);
      rows.forEach((row, rowIdx) => {
        if (row.kind === "item") {
          const orig = origItems.get(row.id);
          if (!orig) return;
          const changedGroup = orig.groupId !== g.id;
          const changedSub = (orig.subsectionId ?? null) !== null;
          const changedSort = orig.sortOrder !== rowIdx;
          if (changedGroup || changedSub || changedSort) {
            updateItem({
              resource: "BudgetCategoryItem",
              id: row.id,
              values: {
                groupId: g.id,
                subsectionId: null,
                sortOrder: rowIdx,
              },
              successNotification: false,
            });
          }
        } else {
          const sub = g.subsections.find((s) => s.id === row.id);
          if (!sub) return;
          const origSub = origSubs.get(row.id);
          if (origSub && origSub.sortOrder !== rowIdx) {
            updateSubsection({
              resource: "BudgetCategorySubsection",
              id: row.id,
              values: { sortOrder: rowIdx },
              successNotification: false,
            });
          }
          sub.items.forEach((it, subIdx) => {
            const orig = origItems.get(it.id);
            if (!orig) return;
            const changedGroup = orig.groupId !== g.id;
            const changedSub = (orig.subsectionId ?? null) !== sub.id;
            const changedSort = orig.sortOrder !== subIdx;
            if (changedGroup || changedSub || changedSort) {
              updateItem({
                resource: "BudgetCategoryItem",
                id: it.id,
                values: {
                  groupId: g.id,
                  subsectionId: sub.id,
                  sortOrder: subIdx,
                },
                successNotification: false,
              });
            }
          });
        }
      });
    });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) {
      setGroups(propsRef.current);
      return;
    }
    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    setGroups((prev) => {
      let next = prev;

      // Subsection drag: reorder rows at group level.
      const subGroupId = findSubsectionGroupId(prev, activeIdStr);
      if (subGroupId) {
        next = prev.map((g) => {
          if (g.id !== subGroupId) return g;
          const rows = unifiedGroupRows(g);
          const oldIdx = rows.findIndex((r) => r.id === activeIdStr);
          const newIdx = rows.findIndex((r) => r.id === overIdStr);
          if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return g;
          const reordered = arrayMove(rows, oldIdx, newIdx);
          // Rebuild group with renumbered sortOrders for both items and subsections.
          const itemsById = new Map(g.items.map((it) => [it.id, it]));
          const subsById = new Map(g.subsections.map((s) => [s.id, s]));
          const newItems: BudgetItem[] = [];
          const newSubs: BudgetSubsection[] = [];
          reordered.forEach((r, idx) => {
            if (r.kind === "item") {
              const it = itemsById.get(r.id);
              if (it) newItems.push({ ...it, sortOrder: idx });
            } else {
              const s = subsById.get(r.id);
              if (s) newSubs.push({ ...s, sortOrder: idx });
            }
          });
          return { ...g, items: newItems, subsections: newSubs };
        });
        persistChanges(propsRef.current, next);
        return next;
      }

      // Item drag: cross-container moves were applied in onDragOver.
      // Here, finalize within-container ordering if dropping on another item.
      const fromLoc = findItemLoc(prev, activeIdStr);
      if (!fromLoc) return prev;
      const target = resolveOver(prev, overIdStr);
      if (!target) {
        persistChanges(propsRef.current, prev);
        return prev;
      }

      const sameContainer =
        (fromLoc.kind === "direct" &&
          target.kind === "direct" &&
          fromLoc.groupId === target.groupId) ||
        (fromLoc.kind === "sub" &&
          target.kind === "sub" &&
          fromLoc.subsectionId === target.subsectionId);

      if (sameContainer && target.overItemId) {
        next = prev.map((g) => {
          if (g.id !== target.groupId) return g;
          if (target.kind === "direct") {
            const oldIdx = g.items.findIndex((i) => i.id === activeIdStr);
            const newIdx = g.items.findIndex(
              (i) => i.id === target.overItemId,
            );
            if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return g;
            return { ...g, items: arrayMove(g.items, oldIdx, newIdx) };
          }
          return {
            ...g,
            subsections: g.subsections.map((s) => {
              if (s.id !== target.subsectionId) return s;
              const oldIdx = s.items.findIndex((i) => i.id === activeIdStr);
              const newIdx = s.items.findIndex(
                (i) => i.id === target.overItemId,
              );
              if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return s;
              return { ...s, items: arrayMove(s.items, oldIdx, newIdx) };
            }),
          };
        });
      }

      persistChanges(propsRef.current, next);
      return next;
    });
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setGroups(propsRef.current);
  };

  const confirmDeleteItem = () => {
    if (!pendingDeleteItem) return;
    deleteItem({
      resource: "BudgetCategoryItem",
      id: pendingDeleteItem.id,
      successNotification: false,
    });
    setPendingDeleteItem(null);
  };

  const confirmDeleteGroup = () => {
    if (!pendingDeleteGroup) return;
    deleteGroup({
      resource: "BudgetCategoryGroup",
      id: pendingDeleteGroup.id,
      successNotification: false,
    });
    setPendingDeleteGroup(null);
  };

  const confirmDeleteSubsection = () => {
    if (!pendingDeleteSubsection) return;
    deleteSubsection({
      resource: "BudgetCategorySubsection",
      id: pendingDeleteSubsection.id,
      successNotification: false,
    });
    setPendingDeleteSubsection(null);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 130px 80px",
          alignItems: "center",
          gap: 2,
          px: 2,
          py: 1,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      >
        <Typography
          variant="caption"
          sx={{ fontWeight: 800, color: "text.secondary", letterSpacing: 1 }}
        >
          CATEGORY
        </Typography>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 800,
            color: "text.secondary",
            letterSpacing: 1,
            textAlign: "right",
            pr: 1.25,
          }}
        >
          AVAILABLE
        </Typography>
        <Box />
      </Box>

      <Box
        sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {groups.map((group) => {
            const allGroupItems = [
              ...group.items,
              ...group.subsections.flatMap((s) => s.items),
            ];
            const totals = allGroupItems.reduce(
              (acc, it) => ({ available: acc.available + it.availableCents }),
              { available: 0 },
            );
            const open = isOpen(group.id);
            const groupHasContent =
              allGroupItems.length > 0 || group.subsections.length > 0;

            const rows = unifiedGroupRows(group);
            const rowIds = rows.map((r) => r.id);

            return (
              <Box key={group.id} sx={{ mb: 1 }}>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr 130px 80px",
                    alignItems: "center",
                    gap: 2,
                    px: 2,
                    py: 1.25,
                    bgcolor: "rgba(255,255,255,0.02)",
                    borderRadius: 1,
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    setOpenGroups((s) => ({ ...s, [group.id]: !open }))
                  }
                >
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    {open ? (
                      <ExpandLessIcon
                        sx={{ color: "text.secondary", fontSize: "1.1rem" }}
                      />
                    ) : (
                      <ExpandMoreIcon
                        sx={{ color: "text.secondary", fontSize: "1.1rem" }}
                      />
                    )}
                    <Typography
                      sx={{
                        fontWeight: 800,
                        color: "white",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        fontSize: "0.95rem",
                      }}
                    >
                      {group.name}
                    </Typography>
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddItem(group.id);
                      }}
                      size="small"
                      aria-label="Add item"
                      sx={{
                        ml: 1,
                        color: "primary.light",
                        bgcolor: "rgba(129, 140, 248, 0.08)",
                        "&:hover": { bgcolor: "rgba(129, 140, 248, 0.15)" },
                        width: 26,
                        height: 26,
                      }}
                    >
                      <AddIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    {onAddSubsection && (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddSubsection({
                            id: group.id,
                            name: group.name,
                          });
                        }}
                        size="small"
                        startIcon={<AddIcon sx={{ fontSize: 13 }} />}
                        aria-label="Add subsection"
                        sx={{
                          ml: 0.5,
                          color: "text.secondary",
                          fontSize: "0.65rem",
                          fontWeight: 800,
                          letterSpacing: 0.6,
                          textTransform: "uppercase",
                          borderRadius: 999,
                          border: "1px dashed",
                          borderColor: "rgba(148, 163, 184, 0.28)",
                          bgcolor: "transparent",
                          px: 1,
                          py: 0,
                          minWidth: 0,
                          height: 22,
                          lineHeight: 1,
                          "& .MuiButton-startIcon": {
                            mr: 0.4,
                            ml: -0.25,
                          },
                          "&:hover": {
                            color: "primary.light",
                            borderColor: "primary.light",
                            borderStyle: "solid",
                            bgcolor: "rgba(129, 140, 248, 0.08)",
                          },
                        }}
                      >
                        Subsection
                      </Button>
                    )}
                  </Box>
                  <Typography
                    sx={{
                      fontWeight: 800,
                      color: "text.secondary",
                      textAlign: "right",
                      pr: 1.25,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatMoney(totals.available)}
                  </Typography>
                  <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                    {!groupHasContent && (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteGroup(group);
                        }}
                        sx={{ color: "error.light" }}
                      >
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                  </Box>
                </Box>

                <Collapse in={open}>
                  <SortableContext
                    items={rowIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <GroupDroppable groupId={group.id}>
                      {rows.map((row) => {
                        if (row.kind === "item") {
                          const item = group.items.find(
                            (it) => it.id === row.id,
                          );
                          if (!item) return null;
                          return (
                            <BudgetItemRow
                              key={item.id}
                              item={item}
                              bills={bills}
                              personals={personals}
                              onAvailableClick={onAvailableClick}
                              onDelete={() => setPendingDeleteItem(item)}
                              onEdit={onEditItem}
                            />
                          );
                        }
                        const sub = group.subsections.find(
                          (s) => s.id === row.id,
                        );
                        if (!sub) return null;
                        return (
                          <SubsectionBlock
                            key={sub.id}
                            subsection={sub}
                            bills={bills}
                            personals={personals}
                            open={isOpenSub(sub.id)}
                            onToggle={() =>
                              setOpenSubsections((s) => ({
                                ...s,
                                [sub.id]: !isOpenSub(sub.id),
                              }))
                            }
                            onAvailableClick={onAvailableClick}
                            onDeleteItem={(item) =>
                              setPendingDeleteItem(item)
                            }
                            onDeleteSubsection={() =>
                              setPendingDeleteSubsection(sub)
                            }
                            onEditSubsection={() => setEditSubsection(sub)}
                            onEditItem={onEditItem}
                          />
                        );
                      })}
                    </GroupDroppable>
                  </SortableContext>
                </Collapse>
              </Box>
            );
          })}
        </DndContext>
      </Box>

      <ConfirmDeleteDialog
        open={!!pendingDeleteItem}
        title="Remove Item?"
        description={`Remove "${pendingDeleteItem?.name}" from the budget? This cannot be undone.`}
        onConfirm={confirmDeleteItem}
        onClose={() => setPendingDeleteItem(null)}
      />

      <ConfirmDeleteDialog
        open={!!pendingDeleteGroup}
        title="Delete Group?"
        description={`Delete group "${pendingDeleteGroup?.name}"? This cannot be undone.`}
        onConfirm={confirmDeleteGroup}
        onClose={() => setPendingDeleteGroup(null)}
      />

      <ConfirmDeleteDialog
        open={!!pendingDeleteSubsection}
        title="Delete Subsection?"
        description={`Delete subsection "${pendingDeleteSubsection?.name}"? This cannot be undone.`}
        onConfirm={confirmDeleteSubsection}
        onClose={() => setPendingDeleteSubsection(null)}
      />

      <EditSubsectionModal
        open={!!editSubsection}
        subsection={editSubsection}
        onClose={() => setEditSubsection(null)}
      />
    </Box>
  );
};

interface GroupDroppableProps {
  groupId: string;
  children: React.ReactNode;
}

const GroupDroppable = ({ groupId, children }: GroupDroppableProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: groupContainerId(groupId),
  });
  return (
    <Box
      ref={setNodeRef}
      sx={{
        minHeight: 28,
        bgcolor: isOver ? "rgba(129, 140, 248, 0.04)" : "transparent",
        borderRadius: 1,
        transition: "background-color 120ms",
      }}
    >
      {children}
    </Box>
  );
};

interface SubsectionBlockProps {
  subsection: BudgetSubsection;
  bills: BillRef[];
  personals: PersonalRef[];
  open: boolean;
  onToggle: () => void;
  onAvailableClick: (item: BudgetItem, anchor: HTMLElement) => void;
  onDeleteItem: (item: BudgetItem) => void;
  onDeleteSubsection: () => void;
  onEditSubsection: () => void;
  onEditItem?: (item: BudgetItem) => void;
}

const SubsectionBlock = ({
  subsection,
  bills,
  personals,
  open,
  onToggle,
  onAvailableClick,
  onDeleteItem,
  onDeleteSubsection,
  onEditSubsection,
  onEditItem,
}: SubsectionBlockProps) => {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: subsection.id });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: subsectionContainerId(subsection.id),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const itemIds = subsection.items.map((it) => it.id);
  const subTotal = subsection.items.reduce(
    (acc, it) => acc + it.availableCents,
    0,
  );

  return (
    <Box ref={setSortableRef} style={style} sx={{ mt: 0.5 }}>
      <Box
        onClick={onToggle}
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 130px 80px",
          alignItems: "center",
          gap: 2,
          px: 2,
          py: 0.75,
          ml: 2,
          borderLeft: "2px solid rgba(129, 140, 248, 0.25)",
          bgcolor: "rgba(129, 140, 248, 0.04)",
          borderRadius: 1,
          cursor: "pointer",
          "&:hover .subsection-actions, &:hover .subsection-handle": {
            opacity: 1,
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box
            {...attributes}
            {...listeners}
            className="subsection-handle"
            onClick={(e) => e.stopPropagation()}
            sx={{
              cursor: "grab",
              opacity: 0,
              transition: "opacity 120ms",
              color: "text.secondary",
              display: "flex",
            }}
          >
            <DragIndicatorIcon sx={{ fontSize: 16 }} />
          </Box>
          {open ? (
            <ExpandLessIcon
              sx={{ color: "text.secondary", fontSize: "1rem" }}
            />
          ) : (
            <ExpandMoreIcon
              sx={{ color: "text.secondary", fontSize: "1rem" }}
            />
          )}
          <Typography
            sx={{
              fontWeight: 700,
              color: "primary.light",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              fontSize: "0.7rem",
            }}
          >
            {subsection.name}
          </Typography>
        </Box>
        <Typography
          sx={{
            fontWeight: 700,
            color: "text.secondary",
            textAlign: "right",
            pr: 1.25,
            fontVariantNumeric: "tabular-nums",
            fontSize: "0.8rem",
          }}
        >
          {formatMoney(subTotal)}
        </Typography>
        <Box
          className="subsection-actions"
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 0.25,
            opacity: 0,
            transition: "opacity 120ms",
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onEditSubsection();
            }}
            sx={{ color: "primary.light" }}
          >
            <EditIcon sx={{ fontSize: 14 }} />
          </IconButton>
          {subsection.items.length === 0 && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSubsection();
              }}
              sx={{ color: "error.light" }}
            >
              <DeleteIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}
        </Box>
      </Box>
      <SortableContext
        items={open ? itemIds : []}
        strategy={verticalListSortingStrategy}
      >
        <Box
          ref={setDroppableRef}
          sx={{
            ml: 2,
            minHeight: open && subsection.items.length === 0 ? 32 : 0,
            bgcolor:
              isOver && open && subsection.items.length === 0
                ? "rgba(129, 140, 248, 0.1)"
                : "transparent",
            borderRadius: 1,
            transition: "background-color 120ms",
          }}
        >
          {open &&
            subsection.items.map((item) => (
              <BudgetItemRow
                key={item.id}
                item={item}
                bills={bills}
                personals={personals}
                onAvailableClick={onAvailableClick}
                onDelete={() => onDeleteItem(item)}
                onEdit={onEditItem}
              />
            ))}
        </Box>
      </SortableContext>
    </Box>
  );
};

interface BudgetItemRowProps {
  item: BudgetItem;
  bills: BillRef[];
  personals: PersonalRef[];
  onAvailableClick: (item: BudgetItem, anchor: HTMLElement) => void;
  onDelete: () => void;
  onEdit?: (item: BudgetItem) => void;
}

const formatItemDisplay = (
  item: BudgetItem,
  bills: BillRef[],
  personals: PersonalRef[],
): { displayName: string; cycles: string[] } => {
  const { displayName, cycles } = resolveItemDisplay(item, bills, personals);
  return { displayName, cycles };
};

const BudgetItemRow = ({
  item,
  bills,
  personals,
  onAvailableClick,
  onDelete,
  onEdit,
}: BudgetItemRowProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const { displayName, cycles } = formatItemDisplay(item, bills, personals);

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 130px 80px",
        alignItems: "center",
        gap: 2,
        px: 2,
        py: 1,
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        "&:hover .item-handle, &:hover .item-actions": { opacity: 1 },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Box
          {...attributes}
          {...listeners}
          className="item-handle"
          sx={{
            cursor: "grab",
            opacity: 0,
            transition: "opacity 120ms",
            color: "text.secondary",
            display: "flex",
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
          {cycles.map((c) => {
            const color = getCycleColor(c);
            return (
              <Box
                key={c}
                sx={{
                  px: 0.85,
                  py: 0.15,
                  borderRadius: "6px",
                  fontSize: "0.7rem",
                  fontWeight: 900,
                  color,
                  bgcolor: `${color}18`,
                  border: `1px solid ${color}30`,
                  letterSpacing: 0.5,
                }}
              >
                {c}
              </Box>
            );
          })}
        </Box>
        <Typography
          sx={{
            fontWeight: 600,
            color: "white",
            fontSize: "0.95rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <AvailableCell
          cents={item.availableCents}
          onClick={(anchor) => onAvailableClick(item, anchor)}
        />
      </Box>
      <Box
        className="item-actions"
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 0.25,
          opacity: 0,
          transition: "opacity 120ms",
        }}
      >
        {onEdit && (
          <IconButton
            size="small"
            sx={{ color: "primary.light" }}
            onClick={() => onEdit(item)}
          >
            <EditIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
        <IconButton
          size="small"
          sx={{ color: "error.light" }}
          onClick={onDelete}
        >
          <DeleteIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Box>
  );
};
