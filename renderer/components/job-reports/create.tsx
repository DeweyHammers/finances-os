"use client";

import { FC } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { JobReportFormFields } from "./JobReportFormFields";

interface JobReportCreateProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const JobReportCreate: FC<JobReportCreateProps> = ({ modalProps }) => {
  return (
    <ResourceCreateModal modalProps={modalProps} title="Job Reported">
      <JobReportFormFields formProps={modalProps} />
    </ResourceCreateModal>
  );
};
