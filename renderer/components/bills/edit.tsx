"use client";

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { BillFormFields } from "./BillFormFields";

interface BillEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const BillEdit = ({ modalProps }: BillEditProps) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="Bill">
      <BillFormFields formProps={modalProps} isEdit />
    </ResourceEditModal>
  );
};
