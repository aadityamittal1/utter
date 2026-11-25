import type { ComponentType } from "react";
import type { Page } from "../lib/types";
import Home from "./Home";
import History from "./History";
import Dictionary from "./Dictionary";
import Snippets from "./Snippets";
import Styles from "./Styles";
import Transforms from "./Transforms";
import Notes from "./Notes";
import Insights from "./Insights";
import Settings from "./settings/Settings";

/** Later tasks replace the page files; this map stays stable. */
export const PAGE_COMPONENTS: Record<Page, ComponentType> = {
  home: Home,
  history: History,
  dictionary: Dictionary,
  snippets: Snippets,
  styles: Styles,
  transforms: Transforms,
  notes: Notes,
  insights: Insights,
  settings: Settings,
};
