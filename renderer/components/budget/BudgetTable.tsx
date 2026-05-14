"use client";

import { useState, useMemo } from "react";
import {
  Box,
  Typography,
  IconButton,
  Button,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
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
import { getOrdinal } from "../../lib/date-utils";
import { getCycleColor } from "../../lib/cycle-utils";

export interface BudgetItem {
  id: string;
  groupId: string;
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

export interface BudgetGroup {
  id: string;
  name: string;
  sortOrder: number;
  items: BudgetItem[];
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
  withdrawalCycle: string;
}

interface BudgetTableProps {
  groups: BudgetGroup[];
  bills?: BillRef[];
  personals?: PersonalRef[];
  onAvailableClick: (item: BudgetItem, anchor: HTMLElement) => void;
  onAddItem: (groupId: string) => void;
  onEditItem?: (item: BudgetItem) => void;
}

export const BudgetTable = ({
  groups,
  bills = [],
  personals = [],
  onAvailableClick,
  onAddItem,
  onEditItem,
}: BudgetTableProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { mutate: updateItem } = useUpdate();
  const { mutate: deleteItem } = useDelete();
  const { mutate: deleteGroup } = useDelete();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [pendingDeleteItem, setPendingDeleteItem] = useState<BudgetItem | null>(
    null,
  );
  const [pendingDeleteGroup, setPendingDeleteGroup] =
    useState<BudgetGroup | null>(null);

  const isOpen = (id: string) =>
    openGroups[id] === undefined ? true : openGroups[id];

  const allItemIds = useMemo(
    () => groups.flatMap((g) => g.items.map((it) => it.id)),
    [groups],
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const findItem = (id: string) => {
      for (const g of groups) {
        const it = g.items.find((i) => i.id === id);
        if (it) return { item: it, group: g };
      }
      return null;
    };

    const fromHit = findItem(active.id as string);
    const toHit = findItem(over.id as string);
    if (!fromHit || !toHit) return;

    const fromGroup = fromHit.group;
    const toGroup = toHit.group;

    if (fromGroup.id === toGroup.id) {
      const oldIndex = fromGroup.items.findIndex(
        (i) => i.id === active.id,
      );
      const newIndex = toGroup.items.findIndex((i) => i.id === over.id);
      const reordered = arrayMove(fromGroup.items, oldIndex, newIndex);
      reordered.forEach((it, idx) => {
        if (it.sortOrder !== idx) {
          updateItem({
            resource: "BudgetCategoryItem",
            id: it.id,
            values: { sortOrder: idx },
            successNotification: false,
          });
        }
      });
    } else {
      const newToGroupItems = [...toGroup.items];
      const insertIndex = toGroup.items.findIndex((i) => i.id === over.id);
      newToGroupItems.splice(insertIndex, 0, fromHit.item);
      newToGroupItems.forEach((it, idx) => {
        const patch: any = { sortOrder: idx };
        if (it.id === fromHit.item.id) patch.groupId = toGroup.id;
        updateItem({
          resource: "BudgetCategoryItem",
          id: it.id,
          values: patch,
          successNotification: false,
        });
      });
      const newFromGroupItems = fromGroup.items.filter(
        (i) => i.id !== fromHit.item.id,
      );
      newFromGroupItems.forEach((it, idx) => {
        if (it.sortOrder !== idx) {
          updateItem({
            resource: "BudgetCategoryItem",
            id: it.id,
            values: { sortOrder: idx },
            successNotification: false,
          });
        }
      });
    }
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

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={allItemIds}
            strategy={verticalListSortingStrategy}
          >
          {groups.map((group) => {
            const totals = group.items.reduce(
              (acc, it) => ({
                available: acc.available + it.availableCents,
              }),
              { available: 0 },
            );
            const open = isOpen(group.id);

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
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
                    {group.items.length === 0 && (
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
                  {group.items.map((item) => (
                    <BudgetItemRow
                      key={item.id}
                      item={item}
                      bills={bills}
                      personals={personals}
                      onAvailableClick={onAvailableClick}
                      onDelete={() => setPendingDeleteItem(item)}
                      onEdit={onEditItem}
                    />
                  ))}
                </Collapse>
              </Box>
            );
          })}
          </SortableContext>
        </DndContext>
      </Box>

      <Dialog
        open={!!pendingDeleteItem}
        onClose={() => setPendingDeleteItem(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 2,
              bgcolor: "background.paper",
              backgroundImage: "none",
              p: 1,
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: "1.2rem", pb: 1 }}>
          Remove Item?
        </DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <DialogContentText
            sx={{ color: "text.secondary", fontSize: "0.9rem" }}
          >
            Remove &quot;{pendingDeleteItem?.name}&quot; from the budget? This
            cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            onClick={() => setPendingDeleteItem(null)}
            size="small"
            sx={{
              fontWeight: 700,
              color: "text.secondary",
              textTransform: "none",
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={confirmDeleteItem}
            variant="contained"
            color="error"
            size="small"
            disableElevation
            sx={{
              px: 2,
              borderRadius: 1.5,
              fontWeight: 700,
              textTransform: "none",
              bgcolor: "error.main",
              "&:hover": { bgcolor: "error.dark" },
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!pendingDeleteGroup}
        onClose={() => setPendingDeleteGroup(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 2,
              bgcolor: "background.paper",
              backgroundImage: "none",
              p: 1,
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: "1.2rem", pb: 1 }}>
          Delete Group?
        </DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <DialogContentText
            sx={{ color: "text.secondary", fontSize: "0.9rem" }}
          >
            Delete group &quot;{pendingDeleteGroup?.name}&quot;? This cannot be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            onClick={() => setPendingDeleteGroup(null)}
            size="small"
            sx={{
              fontWeight: 700,
              color: "text.secondary",
              textTransform: "none",
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={confirmDeleteGroup}
            variant="contained"
            color="error"
            size="small"
            disableElevation
            sx={{
              px: 2,
              borderRadius: 1.5,
              fontWeight: 700,
              textTransform: "none",
              bgcolor: "error.main",
              "&:hover": { bgcolor: "error.dark" },
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
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
  if (item.sourceType === "BILL") {
    const bill = bills.find((b) => b.id === item.sourceBillId);
    if (bill) {
      return {
        displayName: `${bill.name} ($${Number(bill.amount).toFixed(2)} - ${bill.dueDate}${getOrdinal(bill.dueDate)})`,
        cycles: [bill.withdrawalCycle],
      };
    }
    return { displayName: item.name, cycles: [] };
  }
  if (item.sourceType === "PERSONAL_NAME") {
    return {
      displayName: item.sourcePersonalName || item.name,
      cycles: [],
    };
  }
  if (item.sourceType === "CUSTOM") {
    return {
      displayName: item.name,
      cycles: item.customCycle ? [item.customCycle] : [],
    };
  }
  return { displayName: item.name, cycles: [] };
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
