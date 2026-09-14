"use client";

/**
 * PayeeEdit — Refine edit-modal wrapper for the Payee resource.
 *
 * Primary way to rename a payee (existing transactions FK on the same id and
 * follow along automatically). Chrome from ResourceEditModal; fields shared
 * with PayeeCreate via PayeeFormFields.
 */

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { PayeeFormFields } from "./PayeeFormFields";

interface PayeeEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const PayeeEdit = ({ modalProps }: PayeeEditProps) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="Payee">
      <PayeeFormFields formProps={modalProps} />
    </ResourceEditModal>
  );
};
