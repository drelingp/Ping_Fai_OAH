// Floor plan, straightened into an axis-aligned graybox (metres).
// x grows east, z grows south. Layout follows the reference plan:
// residential wing (Bedrooms 1–6, Living A/B, Single Rooms) in the north-west,
// staff/service rooms to the east, Living Area C, therapy and garden to the south.

export const WALL_H = 2.8;
export const WALL_T = 0.2;
const PI = Math.PI;

export const ROOMS = [
  { id: 'lift', name: 'Lift (out of service)', x: 0, z: 0, w: 9, d: 5, type: 'blocked' },
  { id: 'stairN', name: 'Stairs (locked)', x: 17, z: 0, w: 9, d: 5, type: 'blocked' },
  { id: 'livA', name: 'Living Area A', x: 9, z: 0, w: 8, d: 17, type: 'living' },
  { id: 'bed4', name: 'Bedroom 4', x: 0, z: 5, w: 9, d: 8, type: 'bedroom', beds: 8 },
  { id: 'bed5', name: 'Bedroom 5', x: 0, z: 13, w: 9, d: 8, type: 'bedroom', beds: 6 },
  { id: 'bed6', name: 'Bedroom 6', x: 0, z: 21, w: 9, d: 8, type: 'bedroom', beds: 8 },
  { id: 'single1', name: 'Single Room 1', x: 0, z: 29, w: 9, d: 5, type: 'single', beds: 2 },
  { id: 'single2', name: 'Single Room 2', x: 0, z: 34, w: 9, d: 5, type: 'single', beds: 2 },
  { id: 'bed3', name: 'Bedroom 3', x: 17, z: 5, w: 9, d: 8, type: 'bedroom', beds: 8 },
  { id: 'bed2', name: 'Bedroom 2', x: 17, z: 13, w: 9, d: 8, type: 'bedroom', beds: 6 },
  { id: 'bed1', name: 'Bedroom 1', x: 17, z: 21, w: 9, d: 8, type: 'bedroom', beds: 8 },
  { id: 'bath', name: 'Bathroom', x: 17, z: 29, w: 9, d: 4, type: 'care' },
  { id: 'wc1', name: 'Toilet', x: 9, z: 17, w: 3, d: 3, type: 'care' },
  { id: 'passage', name: '', x: 12, z: 17, w: 2, d: 3, type: 'hall' },
  { id: 'wc2', name: 'Toilet', x: 14, z: 17, w: 3, d: 3, type: 'care' },
  { id: 'livB', name: 'Living Area B', x: 9, z: 20, w: 8, d: 17, type: 'living' },
  { id: 'corr', name: 'Corridor', x: 17, z: 33, w: 27, d: 4, type: 'hall' },
  { id: 'consult', name: 'Consultation Room', x: 26, z: 25, w: 6, d: 8, type: 'staff' },
  { id: 'visit', name: 'Visiting Room', x: 32, z: 25, w: 6, d: 8, type: 'staff' },
  { id: 'elev', name: 'Elevators (locked)', x: 38, z: 25, w: 6, d: 8, type: 'blocked' },
  { id: 'treat', name: 'Treatment Room', x: 26, z: 37, w: 6, d: 6, type: 'staff' },
  { id: 'swc', name: 'Staff Toilet', x: 32, z: 37, w: 4, d: 6, type: 'care' },
  { id: 'office', name: 'Ward Manager Office', x: 36, z: 37, w: 8, d: 6, type: 'staff' },
  { id: 'therapy1', name: 'Therapy Room', x: 9, z: 37, w: 8, d: 7, type: 'therapy' },
  { id: 'corrC', name: 'Corridor', x: 17, z: 37, w: 9, d: 9, type: 'hall' },
  { id: 'med', name: 'Medicine Room', x: 13, z: 44, w: 4, d: 4, type: 'staff' },
  { id: 'livC', name: 'Living Area C', x: 17, z: 46, w: 9, d: 10, type: 'living' },
  { id: 'garden', name: 'Garden', x: 0, z: 48, w: 17, d: 20, type: 'outdoor' },
  { id: 'therapy2', name: 'Therapy Room', x: 17, z: 56, w: 9, d: 6, type: 'therapy' },
  { id: 'stairS', name: 'Stairs (locked)', x: 17, z: 62, w: 9, d: 5, type: 'blocked' },
];

// a: which coordinate is constant on the wall line; at: its value; c: gap centre; w: gap width
export const DOORS = [
  { a: 'x', at: 9, c: 9, w: 1.6 }, // Bedroom 4
  { a: 'x', at: 9, c: 14.5, w: 1.6 }, // Bedroom 5
  { a: 'x', at: 9, c: 25, w: 1.6 }, // Bedroom 6
  { a: 'x', at: 9, c: 31.5, w: 1.2 }, // Single 1
  { a: 'x', at: 9, c: 35.5, w: 1.2 }, // Single 2
  { a: 'x', at: 17, c: 9, w: 1.6 }, // Bedroom 3
  { a: 'x', at: 17, c: 15, w: 1.6 }, // Bedroom 2
  { a: 'x', at: 17, c: 25, w: 1.6 }, // Bedroom 1
  { a: 'x', at: 17, c: 31, w: 1.2 }, // Bathroom
  { a: 'z', at: 17, c: 13, w: 2 }, // passage north
  { a: 'z', at: 20, c: 13, w: 2 }, // passage south
  { a: 'x', at: 12, c: 18.5, w: 1.1 }, // toilet 1
  { a: 'x', at: 14, c: 18.5, w: 1.1 }, // toilet 2
  { a: 'x', at: 17, c: 35, w: 3.6 }, // Living B -> corridor
  { a: 'z', at: 33, c: 29, w: 1.2 }, // Consultation
  { a: 'z', at: 33, c: 35, w: 1.2 }, // Visiting
  { a: 'z', at: 37, c: 29, w: 1.2 }, // Treatment
  { a: 'z', at: 37, c: 34, w: 1.1 }, // Staff toilet
  { a: 'z', at: 37, c: 40, w: 1.2 }, // Office
  { a: 'z', at: 37, c: 21.5, w: 8.6 }, // corridor -> corridor C
  { a: 'x', at: 17, c: 40.5, w: 1.4 }, // Therapy 1
  { a: 'x', at: 17, c: 45.2, w: 1.1 }, // Medicine
  { a: 'z', at: 46, c: 21.5, w: 8.6 }, // corridor C -> Living C
  { a: 'x', at: 17, c: 51, w: 2 }, // Living C -> garden
  { a: 'z', at: 56, c: 21.5, w: 1.6 }, // Living C -> Therapy 2
];

// f = facing angle (rotation.y); forward = (sin f, cos f)
export const SEATS = {
  livA: [
    { x: 11, z: 4, f: PI }, { x: 12.3, z: 4, f: PI }, { x: 13.7, z: 4, f: PI }, { x: 15, z: 4, f: PI },
    { x: 11.6, z: 5.6, f: PI }, { x: 14.4, z: 5.6, f: PI },
  ],
  livB: [
    { x: 10.4, z: 23.7, f: PI / 2 }, { x: 10.4, z: 24.7, f: PI / 2 }, { x: 12, z: 23.7, f: -PI / 2 }, { x: 12, z: 24.7, f: -PI / 2 },
    { x: 10.4, z: 32.5, f: PI / 2 }, { x: 10.4, z: 33.5, f: PI / 2 }, { x: 12, z: 32.5, f: -PI / 2 }, { x: 12, z: 33.5, f: -PI / 2 },
  ],
  livC: [
    { x: 20.7, z: 49, f: PI / 2 }, { x: 20.7, z: 50, f: PI / 2 }, { x: 22.3, z: 49, f: -PI / 2 }, { x: 22.3, z: 50, f: -PI / 2 },
    { x: 17.6, z: 53, f: PI / 2 }, { x: 17.6, z: 54.3, f: PI / 2 }, { x: 25.4, z: 53, f: -PI / 2 }, { x: 25.4, z: 54.3, f: -PI / 2 },
  ],
  garden: [{ x: 4, z: 56, f: 0 }, { x: 10, z: 63, f: PI }],
};
export const TABLES = [
  { x: 11.2, z: 24.2, w: 0.9, d: 1.6 },
  { x: 11.2, z: 33, w: 0.9, d: 1.6 },
  { x: 21.5, z: 49.5, w: 0.9, d: 1.6 },
];

export const WANDER_AREAS = ['livA', 'livB', 'livC', 'corrC', 'garden'];

export const SHIFTS = [
  { id: 'AM', name: 'AM shift', start: 7 * 60, end: 14 * 60, staffTotal: 4 },
  { id: 'PM', name: 'PM shift', start: 14 * 60, end: 21 * 60, staffTotal: 4 },
  { id: 'NIGHT', name: 'Night shift', start: 21 * 60, end: 31 * 60, staffTotal: 2 },
];

export const NURSES = [
  { id: 'ko', name: 'Nurse Ko Mei-ling', shift: 'AM', color: 0x5aa6b8 },
  { id: 'wong', name: 'Nurse Wong Siu-fong', shift: 'AM', color: 0x6fae8f },
  { id: 'leung', name: 'Nurse Leung Ka-yan', shift: 'AM', color: 0x8a86c4 },
  { id: 'tsang', name: 'Nurse Tsang Wai-man', shift: 'PM', color: 0x5aa6b8 },
  { id: 'ho', name: 'Nurse Ho Lai-ching', shift: 'PM', color: 0x6fae8f },
  { id: 'cheung', name: 'Nurse Cheung Pui-yee', shift: 'PM', color: 0x8a86c4 },
  { id: 'yip', name: 'Nurse Yip Suk-han', shift: 'NIGHT', color: 0x5aa6b8 },
];

export const SURNAMES = ['Chan', 'Wong', 'Lee', 'Cheung', 'Lau', 'Ng', 'Ho', 'Yeung', 'Leung', 'Tsang', 'Lam', 'Chow', 'Fung', 'Tang', 'Kwok', 'Mak', 'Siu', 'Choi', 'Lo', 'Poon', 'Tam', 'Lui'];
export const MALE = ['Tai-man', 'Wing-kei', 'Sai-kit', 'Kam-fai', 'Yiu-chung', 'Hon-ming', 'Shu-tak', 'Pak-lam', 'Chun-kit', 'Ka-lok', 'Man-hon', 'Kwok-keung'];
export const FEMALE = ['Mei-lan', 'Siu-ying', 'Yuk-lin', 'Wai-han', 'Lai-kuen', 'So-fong', 'Kit-ying', 'Shuk-fan', 'Oi-lin', 'Fung-yee', 'Sau-ching', 'Yin-ping'];

export const PERSONALITIES = [
  'Gentle; hums Cantonese opera to herself',
  'Stubborn and proud; hates asking for help',
  'Anxious after dark; calls out for family',
  'Cheerful; chats with anyone who passes',
  'Withdrawn since spouse died last year',
  'Former teacher; notices everything',
  'Suspicious of new faces',
  'Quiet; watches the corridor all day',
  'Polite, apologises for "being a bother"',
  'Easily startled by loud voices',
];
export const ROUTINES = [
  'Morning tea at 08:00; naps after lunch',
  'Walks Living Area C after meals',
  'Watches TV in Living Area A until late',
  'Sits by the garden door in the afternoon',
  'Wakes around 03:00 asking for the toilet',
  'Prays quietly before every meal',
  'Waits at the visiting room for a son who rarely comes',
  'Folds and refolds the same towel',
];
export const NEEDS = {
  bedbound: ['2-hourly repositioning', 'Pressure-injury risk (sacrum)', 'Urinary catheter care', 'Full assistance with feeding', 'Thickened fluids'],
  wheelchair: ['Transfer with 1 assist', 'High fall risk', 'Assisted toileting', 'Hearing aid (left)'],
  walking: ['Supervision when walking', 'Dementia — may wander', 'Diabetic diet', 'Reading glasses', 'Night-time confusion'],
};
export const BELL_NEEDS = [
  { need: 'Needs the toilet', urgent: false },
  { need: 'Wants repositioning — in pain', urgent: false },
  { need: 'Thirsty, asking for water', urgent: false },
  { need: 'Wet bedding', urgent: false },
  { need: 'Trying to climb out of bed', urgent: true },
  { need: 'Chest discomfort', urgent: true },
  { need: 'Choking on secretions', urgent: true },
];
