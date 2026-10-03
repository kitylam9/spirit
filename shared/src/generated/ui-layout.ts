/* Generated from schemas/ui-layout.schema.json by shared/scripts/gen-types.mjs. Do not edit. */

export type Node = {
  [k: string]: unknown;
} & {
  type:
    | "Panel"
    | "Stack"
    | "Text"
    | "Stat"
    | "Bar"
    | "Button"
    | "Choice"
    | "Dialog"
    | "TextInput"
    | "Inventory"
    | "Map"
    | "Image"
    | "Toast"
    | "Divider";
  id?: string;
  props?: Props;
  /**
   * @maxItems 20
   */
  children?: Node[];
};
export type Text = string;
export type Bind = string;

/**
 * A declarative UI tree produced by the UI Generator agent. Only whitelisted components are allowed. Depth <= 6 and <= 60 nodes are enforced by the Validator.
 */
export interface UILayout {
  schemaVersion: "1.1";
  id: string;
  screen: "hud" | "space-hud" | "omen" | "dialogue" | "event" | "inventory" | "reflection" | "menu";
  theme:
    | "spirit"
    | "organic"
    | "bone-and-ochre"
    | "parchment"
    | "ink-and-brass"
    | "steam-and-iron"
    | "flat-digital"
    | "neon-holo"
    | "luminous-minimal";
  accentOverride?: string;
  root: Node;
}
export interface Props {
  title?: Text;
  text?: Text;
  label?: string;
  placeholder?: string;
  bind?: Bind;
  format?: "int" | "percent" | "currency" | "clock" | "date";
  icon?: string;
  max?: number;
  warnBelow?: number;
  color?: "accent" | "danger" | "warning" | "success" | "muted" | "health" | "hunger" | "energy" | "spirit";
  anchor?: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
  width?: "xs" | "sm" | "md" | "lg" | "full";
  variant?: "default" | "subtle" | "ornate" | "alert";
  direction?: "row" | "column";
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  size?: "sm" | "md" | "lg" | "xl";
  style?: "body" | "title" | "whisper" | "mono";
  action?: Action;
  hotkey?: string;
  /**
   * @minItems 1
   * @maxItems 6
   */
  options?: {
    label: string;
    hint?: string;
    action: Action;
    disabled?: boolean;
  }[];
  speakerId?: string;
  portraitAssetId?: string;
  assetId?: string;
  columns?: number;
  kind?: "minimap" | "region" | "system";
  durationMs?: number;
  tone?: "info" | "good" | "bad" | "mystic";
}
export interface Action {
  verb:
    | "move"
    | "look"
    | "talk"
    | "give"
    | "take"
    | "use"
    | "buy"
    | "sell"
    | "work"
    | "rest"
    | "eat"
    | "attack"
    | "flee"
    | "hide"
    | "craft"
    | "learn"
    | "travel"
    | "incarnate.request"
    | "reflect.continue"
    | "travel.request"
    | "dialogue.say"
    | "ui.close"
    | "ui.open"
    | "ui.tab";
  params?: {
    [k: string]: string | number | boolean;
  };
}
