"use client";

/**
 * BillCreate — Refine create-modal wrapper for the Bill resource.
 *
 * Thin shell: ResourceCreateModal supplies the dialog/save/cancel chrome,
 * BillFormFields renders the actual inputs. Mounted by BillList's toolbar.
 */

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { BillFormFields } from "./BillFormFields";

interface BillCreateProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const BillCreate = ({ modalProps }: BillCreateProps) => {
  return (
    <ResourceCreateModal modalProps={modalProps} title="Bill">
      <BillFormFields formProps={modalProps} />
    </ResourceCreateModal>
  );
};
