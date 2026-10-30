# Night Ward — Halloween at Ping Fai Care Home

A grounded psychological-horror nursing-home simulator, playable in the browser. You are the shift in-charge (IC). Patrol one floor in third person, keep residents safe, manage your nurses, and investigate abuse. There is nothing supernatural in it; the horror comes from neglect.

> Content note: the game depicts elder neglect, restraint misuse and death.

## Run

```bash
npm install
npm run dev      # http://localhost:5173 (also exposed on LAN for phone testing)
npm run build    # production build in dist/
```

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | WASD / arrows (Shift = hurry) | Left-side virtual stick |
| Camera | Drag mouse, wheel zoom | Drag right side |
| Interact | **E** (tap), **hold E** for care tasks | Round **E** button (tap / hold) |
| Map | **M** or tap the minimap | Tap the minimap |
| Case file | **C** | Case button |
| Pause | Esc | ⏸ button |

## Prototype scope

- **Floor:** a graybox of the full floor plan. Bedrooms 1–6 hold 6–8 beds each. Also on the floor: Single Rooms 1–2, Living Areas A/B/C, the nurse station, Treatment, Medicine, Consultation, Visiting, the Ward Manager office, two therapy rooms, toilets, the bathroom and the garden. Stairs and lifts are blocked. The angled wing of the drawing is straightened into axis-aligned rooms that keep their relative positions.
- **Residents:** 30–42, each with a personality, a routine and support needs. Care-plan rules decide their beds. Each shift they are bed-bound, seated in living areas, or wandering. Only residents near you are fully simulated. The map shows each one's last known location.
- **Shifts:** AM 07–14 has 4 nurses, PM 14–21 has 4, Night 21–07 has 2; all counts include you. Sometimes a nurse calls in sick and you decide how to cover. 1 real second equals 1 game minute. Time slows while a panel is open, except during emergencies.
- **Staff:** most nurses are harmful; a few are overwhelmed or helpful. Trust is earned through what you do.
- **Call bells:** a ringing bell raises a banner. After 30 minutes it becomes urgent, and if left too long it causes an incident. Tap a banner to see the resident's profile and set a waypoint.
- **Case 1, Bed 4-2:** the night handover says Mr. Chan is fine, but you find him restrained and neglected. To work the case:
  1. Give care in three hold steps; the last one needs clean linen from the trolley.
  2. Confront Nurse Ko.
  3. Gather leads: the charts at the nurse station, the witness in Bed 4-5, a colleague you trust in private, and CCTV at the Ward Manager's desk.
  4. File a decision at the Ward Manager's desk.

  Your outcome depends on the evidence and the care you gave, and everything carries over to later shifts.
- **Shift report:** each shift is scored on wellbeing, call-bell care, investigation, trust and suspicion, with a penalty for deaths. The sandbox is open-ended.

## Code map

| File | Purpose |
|---|---|
| `src/data.js` | Floor plan (rooms, doors, seats), shifts, nurses, resident content |
| `src/map.js` | Builds walls/beds/furniture, colliders, room navigation |
| `src/people.js` | Low-poly characters and poses |
| `src/game.js` | Roster, routines, nurses, call bells, time, shifts, scoring |
| `src/case1.js` | The Bed 4-2 investigation |
| `src/ui.js` | HUD, banners, panels, dialogue, maps |
| `src/input.js` | Keyboard/mouse and touch controls |
| `src/main.js` | Renderer, lighting, camera, loop |

`window.__game` is exposed for debugging.
