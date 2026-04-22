"use client";

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { YearlyCostFormFields } from "./YearlyCostFormFields";

interface YearlyCostCreateProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const YearlyCostCreate: React.FC<YearlyCostCreateProps> = ({
  modalProps,
}) => {
  return (
    <ResourceCreateModal modalProps={modalProps} title="Yearly Cost">
      <YearlyCostFormFields formProps={modalProps} />
    </ResourceCreateModal>
  );
};
