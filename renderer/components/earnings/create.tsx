"use client";

import { UseFormRegister } from "react-hook-form";
import { ResourceCreateModal } from "../shared/ResourceCreateModal";
import { EarningFormFields } from "./EarningFormFields";

export const EarningCreate = (props: any) => {
  console.log(props);
  return (
    <ResourceCreateModal {...props} title="UpWork Earning" resource="Earning">
      {(register: UseFormRegister<any>) => (
        <EarningFormFields register={register} />
      )}
    </ResourceCreateModal>
  );
};
