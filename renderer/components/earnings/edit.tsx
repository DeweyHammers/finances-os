"use client";

import { UseFormRegister } from "react-hook-form";
import { ResourceEditModal } from "../shared/ResourceEditModal";
import { EarningFormFields } from "./EarningFormFields";

export const EarningEdit = (props: any) => {
  return (
    <ResourceEditModal {...props} title="UpWork Earning" resource="Earning">
      {(register: UseFormRegister<any>) => (
        <EarningFormFields register={register} />
      )}
    </ResourceEditModal>
  );
};
