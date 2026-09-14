"use client";

import { addTools, type ManageState } from "@/actions/manage";
import { StackEditor } from "./StackEditor";

/**
 * The Add tool surface, reusing the same editor as the claim flow — searching
 * the network, or creating a tool that isn't in it yet from a name and a URL.
 */
export function ManageStack({
  slug,
  companyName,
  companyDomain,
  existingCredits,
}: {
  slug: string;
  companyName: string;
  companyDomain: string;
  existingCredits: number;
}) {
  const action = async (
    _state: ManageState,
    formData: FormData,
  ): Promise<ManageState> => addTools(slug, _state, formData);

  return (
    <StackEditor
      action={action}
      companyName={companyName}
      companyDomain={companyDomain}
      existingCredits={existingCredits}
      requiredCredits={0}
      suggestionsFor={slug}
      submitLabel="Add to our stack"
    />
  );
}
