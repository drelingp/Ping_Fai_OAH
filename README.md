# 秉暉護老院 Ping Fai Nursing Home — Night Ward

A grounded psychological-horror nursing-home simulator, playable in the browser. You are the shift in-charge (IC). Patrol one floor in third person, keep residents safe, manage your nurses, and investigate abuse. There is nothing supernatural in it; the horror comes from neglect.

> Content note: the game depicts elder neglect, restraint misuse and death.

**▶ Play online:** https://drelingp.github.io/Ping_Fai_OAH/ (every push to `master` deploys automatically via GitHub Pages)

## Run

```bash
npm install
npm run dev      # http://localhost:5173 (also exposed on LAN for phone testing)
npm run build    # production build in dist/
npm test         # misconduct/consequence regression tests (Node's built-in runner)
```

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | WASD / arrows (Shift = hurry); fixed stick below 900 px | Fixed bottom-left stick (push fully to hurry) |
| Camera | Drag mouse, wheel zoom | Drag right side |
| Interact | **E** (tap), **hold E** for care tasks; Resident actions button | Round **E** button (tap / hold); Resident actions button |
| Map | **M** or tap the minimap | Tap the minimap |
| Case file | **C** | Case button |
| Pause | Esc | ⏸ button |

## Prototype scope

- **Floor:** a furnished version of the full floor plan. Bedrooms 1–6 hold 6–8 beds each. Also on the floor: Single Rooms 1–2, Living Areas A/B/C, the walk-in U-shaped nurse station, Treatment, Medicine, Consultation, Visiting, the Ward Manager office, two therapy rooms, toilets, the bathroom and the garden. Stairs and lifts are blocked. The angled wing of the drawing is straightened into axis-aligned rooms that keep their relative positions.
- **Graphics:** CC0 animated people and furniture, textured floors and walls, door frames, ceiling fixtures, garden paths and Halloween decorations. Higher quality tiers add shadows, ambient occlusion, bloom and shift-specific colour grading. This is a stylised browser prototype, not GTA-equivalent art.
- **Residents:** 30–42, each with a personality, a routine and support needs. Care-plan rules decide their beds. Each shift they are bed-bound, seated in living areas, or wandering. Only residents near you are fully simulated. The map shows each one's last known location.
- **Shifts:** AM 07–14 has 4 nurses, PM 14–21 has 4, Night 21–07 has 2; all counts include you. Sometimes a nurse calls in sick and you decide how to cover. 1 real second equals 1 game minute. Time slows while a panel is open, except during emergencies.
- **Staff:** most nurses are harmful; a few are overwhelmed or helpful. Trust is earned through what you do. All nurses, including you, wear hatless blue-purple scrubs.
- **Hygiene:** residents left in bed too long (especially restrained or sedated ones) can become soiled. Odour wisps and a stink icon mark them, and wellbeing slowly drops. Hold **Wash & change** beside them to clean them up.
- **Call bells:** a ringing bell raises a banner. After 30 minutes it becomes urgent, and if left too long it causes an incident. Tap a banner to see the resident's profile and set a waypoint. A banner blinks 3 times when it appears or turns urgent, then stays steady. On phones, banners are single lines: up to 2 are shown, plus a "+N more" line.
- **Difficulty:** choose it on the title screen (it is remembered), or add `?d=easy|normal|hard` to the URL. It changes only how often random call bells ring and how many can be open at once: Easy rings about every 60 min with up to 3 open, Normal (the default) about every 35 min with up to 4, and Hard about every 20 min with up to 6. Night shift rings 1.5× less often.
- **Case 1, Bed 4-2:** the night handover says Mr. Chan is fine, but you find him restrained and neglected. To work the case:
  1. Give care in three hold steps; the last one needs clean linen from the trolley.
  2. Confront Nurse Ko.
  3. Gather leads: the charts at the nurse station, the witness in Bed 4-5, a colleague you trust in private, and CCTV at the Ward Manager's desk.
  4. File a decision at the Ward Manager's desk.

  Your outcome depends on the evidence and the care you gave, and everything carries over to later shifts.
- **Your conduct:** use **Resident actions** beside a resident to see care and six clearly marked harmful choices together: unauthorised restraint, rough handling, shouting, silencing an active bell, withholding food/fluids and over-sedation. Restraint requires a 1.5-second hold (touch/mouse, or hold Space/Enter on its button) and can be released. A resident who is not in bed must be escorted there first: a free nurse joins you (or you go alone if short-staffed), and the resident may push back and pause the escort. The restraint is applied at the bed; you can let go to abandon the escort. Each action plays a visible reaction on the resident. Sedation is available at the station trolley or after taking the medicine-round trolley there. No real medication names or doses are provided.
- **Consequences:** each harmful act deducts 8 shift-score points and worsens safety. Restraint drains wellbeing until released; withholding lasts three hours; sedation lasts four. Silenced needs return as urgent bells. Staff/resident witnesses may report you; harmful staff gain trust. Harming a case resident undermines investigation accuracy. Ongoing effects and visitor reports carry across shifts.
- **Shift report:** each shift is scored on wellbeing, call-bell care, investigation, trust and suspicion, with penalties for deaths and harmful conduct. A **Your conduct** section lists acts, score deductions and witness reports. The sandbox is open-ended.

## Graphics quality and assets

The game starts at medium quality on touch/narrow screens and high quality on larger screens. Sustained low FPS automatically lowers the tier; that preference is remembered locally. Append `?q=low`, `?q=medium` or `?q=high` to override it. Low quality disables shadows and post-processing. Real-device frame rates depend on the GPU; a 60 FPS phone target is not yet verified on physical hardware.

Assets are about 2.2 MB in total. The human rig is trimmed and meshopt-compressed; static furniture is batched by material and spatial cell, and nearby visible people alone animate. See [asset credits](public/models/CREDITS.md) for the CC0 packs and sources.

## Code map

| File | Purpose |
|---|---|
| `src/data.js` | Floor plan (rooms, doors, seats), shifts, nurses, resident content |
| `src/map.js` | Builds walls/beds/furniture, colliders, room navigation |
| `src/people.js` | Low-poly characters and poses |
| `src/assets.js` | Asset preloading, rig cloning, clothing, animation |
| `src/textures.js` | Procedural surface and sign textures |
| `src/decor.js` | Room props, nurse station and spatial furniture batching |
| `src/game.js` | Roster, routines, nurses, call bells, time, shifts, scoring |
| `src/case1.js` | The Bed 4-2 investigation |
| `src/harm.js` | Fictional misconduct, ongoing effects and witnesses |
| `src/escort.js` | Two-nurse escort to bed, with resistance |
| `src/odour.js` | Hygiene state, odour wisps and stink icons |
| `src/body.js` | Smooth skinned body generated over the character rig |
| `src/ui.js` | HUD, banners, panels, dialogue, maps |
| `src/input.js` | Keyboard/mouse and touch controls |
| `src/main.js` | Renderer, lighting, camera, loop |

`window.__game` and `window.__gfx` are exposed for debugging.
