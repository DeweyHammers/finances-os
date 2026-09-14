"use client";

/**
 * PersonalEdit — Refine edit-modal wrapper for the Personal resource.
 *
 * ResourceEditModal fetches the record by id and handles save chrome. Fields
 * are shared with PersonalCreate via PersonalFormFields.
 */

import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { FieldValues } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { PersonalFormFields } from "./PersonalFormFields";

interface PersonalEditProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
}

export const PersonalEdit = ({ modalProps }: PersonalEditProps) => {
  return (
    <ResourceEditModal modalProps={modalProps} title="Personal Bill">
      <PersonalFormFields formProps={modalProps} />
    </ResourceEditModal>
  );
};
