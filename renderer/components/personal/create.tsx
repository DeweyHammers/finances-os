"use client";

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { PersonalFormFields } from "./PersonalFormFields";

interface PersonalCreateProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const PersonalCreate = ({ modalProps }: PersonalCreateProps) => {
  return (
    <ResourceCreateModal modalProps={modalProps} title="Personal Bill">
      <PersonalFormFields formProps={modalProps} />
    </ResourceCreateModal>
  );
};
