import { z } from "zod"

export const ACCOUNT_DESCRIPTION =
  'The label of the credential pair to use, or "default" for the unlabeled one; left out, the unlabeled pair, else the only label.'

export const accountArg = z.string().optional().describe(ACCOUNT_DESCRIPTION)
