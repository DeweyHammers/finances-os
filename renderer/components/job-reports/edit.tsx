"use client";

import { FC } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { JobReportFormFields } from "./JobReportFormFields";

interface JobReportEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const JobReportEdit: FC<JobReportEditProps> = ({ modalProps }) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="Job Reported">
      <JobReportFormFields formProps={modalProps} />
    </ResourceEditModal>
  );
};
