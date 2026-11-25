"use client";

/**
 * BillEdit — Refine edit-modal wrapper for the Bill resource.
 *
 * Thin shell: ResourceEditModal handles fetch-by-id + save chrome,
 * BillFormFields renders the same inputs used by BillCreate. Mounted per-row from BillList.
 *
 * Below the fields sits BillTemporaryAmounts ("$50 for 3 months", "$0 for a
 * free month"). Edit only: it needs the saved bill's id, and it saves by
 * itself rather than with "Update Bill" — see that component.
 */

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { BillFormFields } from "./BillFormFields";
import { BillTemporaryAmounts } from "./BillTemporaryAmounts";

interface BillEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const BillEdit = ({ modalProps }: BillEditProps) => {
  // The bill as it is SAVED (not the form's unsaved edits): the temporary
  // amounts belong to that record and compare against its regular amount.
  const record = modalProps.refineCore.query?.data?.data;
  return (
    <ResourceEditModal modalProps={modalProps} title="Bill">
      <BillFormFields formProps={modalProps} />
      {record?.id != null && (
        <BillTemporaryAmounts
          // A fresh section (and a fresh default start month) per bill.
          key={String(record.id)}
          billId={String(record.id)}
          regularAmount={Number(record.amount) || 0}
          dueDay={Number(record.dueDate) || 1}
        />
      )}
    </ResourceEditModal>
  );
};
