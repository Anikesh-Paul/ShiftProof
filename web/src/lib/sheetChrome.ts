import { createContext, useContext, type Dispatch, type SetStateAction } from "react";

export const SheetChromeContext = createContext<
  Dispatch<SetStateAction<boolean>>
>(() => undefined);

/** Scoreboard sheet mode: inert the chrome so Log out cannot steal the task. */
export function useSheetChromeInert() {
  return useContext(SheetChromeContext);
}
