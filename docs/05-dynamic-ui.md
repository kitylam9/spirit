# 05 — Dynamic UI

The UI is generated at runtime by the **UI Generator** agent so that every planet feels
different: a feudal world shows parchment scrolls and wax seals, a cyber world shows
holographic overlays. To stay safe and performant, the agent never produces HTML, CSS or
JavaScript. It produces a **UI layout tree** in JSON (`schemas/ui-layout.schema.json`)
that the client renders with a fixed library of components.

## 1. Principles

1. **Declarative only.** The layout is data. No scripts, no URLs except asset ids, no raw
   styles.
2. **Whitelisted components.** Unknown component types are rejected by the Validator.
3. **Data binding, not data copying.** Values like health come from `bind` paths into
   `player-state`, so the UI stays live without regenerating.
4. **Actions map to verbs.** Buttons and choices emit verb actions the rules engine
   validates; the UI cannot change state by itself.
5. **Themes from tier.** Visual style comes from theme tokens chosen by tier and tinted by
   the civilization palette.
6. **Always a fallback.** Every screen kind has a hand-written default layout.

## 2. Screen kinds

| Screen | When | Typical components |
| --- | --- | --- |
| `hud` | Always on planet | Bar (health, hunger, energy), Stat (wealth, time), Toast area, Minimap |
| `space-hud` | Space phase | Bar (Spirit Energy), Text (system name), planet markers |
| `omen` | Approaching a planet | Panel, Text, Stat (tier, danger), Choice (Incarnate modes) |
| `dialogue` | Talking to an NPC | Portrait, Text (stream), TextInput, Choice |
| `event` | Event triggers | Panel, Text, Image, Choice |
| `inventory` | Player opens it | Inventory grid, Text, Button |
| `reflection` | After death | Text (epitaph), Stat (SE delta, SE remaining), Button (return to space, or start a new run when SE is 0) |
| `menu` | Pause/system | List, Button (fixed actions only) |

## 3. Component library (v1)

| Component | Key props | Children |
| --- | --- | --- |
| `Panel` | `title`, `anchor`, `width`, `variant` | yes |
| `Stack` | `direction` (`row`/`column`), `gap`, `align` | yes |
| `Text` | `text` or `bind`, `size`, `style` (`body`, `title`, `whisper`, `mono`) | no |
| `Stat` | `label`, `bind`, `format`, `icon` | no |
| `Bar` | `label`, `bind`, `max`, `color` (theme token), `warnBelow` | no |
| `Button` | `label`, `action`, `hotkey` | no |
| `Choice` | `options[]` (`label`, `action`, `hint`, `disabled`) | no |
| `Dialog` | `speakerId`, `portraitAssetId` | yes |
| `TextInput` | `placeholder`, `action` (`dialogue.say`) | no |
| `Inventory` | `bind` (items path), `columns` | no |
| `Map` | `kind` (`minimap`/`region`/`system`), `bind` | no |
| `Image` | `assetId` (2D asset from manifest) | no |
| `Toast` | `text`, `durationMs`, `tone` | no |
| `Divider` | `variant` | no |

Limits: max depth 6, max 60 nodes per layout, text ≤ 600 chars per node.

## 4. Actions

An action is a verb plus parameters, identical to what the player could send manually:

```json
{ "verb": "buy", "params": { "itemId": "item-rye-bread", "from": "npc-hilde-baker" } }
```

Allowed UI-only actions: `ui.close`, `ui.open` (screen kind), `ui.tab`.
Everything else must be a verb from `01-game-design.md` §5 or a system message
(`incarnate.request`, `reflect.continue`, `travel.request`).

## 5. Data binding

`bind` is a JSON-pointer-like path into the client's state store. Paths under `/player`
mirror `schemas/player-state.schema.json`:

- `/player/incarnation/stats/health`
- `/player/spirit/energy`
- `/player/incarnation/inventory`
- `/world/time/clock`
- `/scene/npcs/npc-hilde-baker/opinion`

Formats: `int`, `percent`, `currency` (uses civilization currency), `clock`, `date`
(civilization calendar).

## 6. Themes

Theme tokens (`--surface`, `--ink`, `--accent`, `--danger`, `--font-display`,
`--font-body`, `--border-style`, `--panel-texture`, `--motion`) are defined per tier in
the client. The civilization `aesthetic.palette` can override `accent` and `surface`
within contrast limits (WCAG AA is enforced by the client; failing overrides are ignored).

| Tier | Theme id | Feel |
| --- | --- | --- |
| T0 | `organic` | Minimal, leaf/water motifs, no text-heavy panels |
| T1 | `bone-and-ochre` | Painted glyphs, rough edges |
| T2 | `parchment` | Scrolls, serif fonts, wax seals |
| T3 | `ink-and-brass` | Engraved frames, copperplate |
| T4 | `steam-and-iron` | Riveted plates, gauges for bars |
| T5 | `flat-digital` | Clean flat UI, notifications |
| T6 | `neon-holo` | Translucent holograms, scanlines, glitch motion |
| T7 | `luminous-minimal` | Floating light glyphs, near-invisible chrome |
| space | `spirit` | Soft glow, particles |

## 7. Example (T2 event screen)

```json
{
  "schemaVersion": "1.1",
  "id": "ui-event-plague-rumor",
  "screen": "event",
  "theme": "parchment",
  "root": {
    "type": "Panel",
    "props": { "title": "Whispers at the Well", "anchor": "center", "width": "md" },
    "children": [
      { "type": "Text", "props": { "text": "The miller's wife swears the river folk are coughing blood. The reeve says it is nonsense.", "style": "body" } },
      { "type": "Choice", "props": { "options": [
        { "label": "Warn your family", "action": { "verb": "talk", "params": { "npcId": "npc-mother-agnes", "topic": "plague-rumor" } } },
        { "label": "Ask the reeve", "action": { "verb": "travel", "params": { "sceneId": "scene-millford-reeve-house" } } },
        { "label": "Ignore it", "action": { "verb": "ui.close", "params": {} } }
      ] } }
    ]
  }
}
```

## 8. Rendering rules (client)

- Unknown props are dropped; unknown components fail validation server-side and are
  replaced by the fallback layout client-side as a second line of defense.
- Text is rendered as text (no HTML interpretation).
- Layout changes animate with the theme's `--motion` token; HUD layouts are cached per
  planet and only regenerated when the screen's needs change.
