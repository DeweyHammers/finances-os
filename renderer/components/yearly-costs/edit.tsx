"use client";

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { YearlyCostFormFields } from "./YearlyCostFormFields";

interface YearlyCostEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const YearlyCostEdit: React.FC<YearlyCostEditProps> = ({
  modalProps,
}) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="Yearly Cost">
      <YearlyCostFormFields formProps={modalProps} />
    </ResourceEditModal>
  );
};
