# The program

The exact program the app runs: each day, each exercise in the order it comes, with its sets, reps and rest. The list below is
written by `node tools/program.mjs` from the program inside `index.html`, so it cannot drift from what the app does; when it is
out of date, `node tools/program.mjs --check` fails.

The routine is custom, not one of Jeff Nippard's programs. The exercise choices, effort, tempo and rest come from his free videos
and the research they cite; how they were checked is in the README.

Around the list, the app adds what is not a working set (the counts below leave it out):

- **Top set** on a step marked "top set" (the first compound of a lifting day): one heavy set first, 1–2 reps short of
  failure; the sets after it are about 85–90% of its weight.
- **Warm-up sets** before the first set of each compound: about 50% × 8 and 75% × 4 of the first set's weight (and 85% × 2
  before a top set; 75% × 4 alone when an earlier exercise has worked its muscles); one light set (about 50% × 10) before an
  isolation for a muscle the day has not worked yet.
- **Drop set** right after the last set of an exercise marked "+ drop set": about half the weight, to failure.
- **Swap** for a busy machine: the exercise named after "swap" takes the step's place for the day (same sets, reps and rest).
- **Deload week**, when you choose it (the app suggests it after 8 weeks or when several lifts stall): half the sets, same
  weights, every set 3–4 reps short of failure.

<!-- program:start -->
### Day 1 · Upper

1. Warm-up: 5 min easy bike, then leg and arm swings, pulse 105–125 bpm
2. Chest press: top set 6–8, then 3 × 8–12, rest 3 min; swap: Incline press
3. Lat pulldown: 4 × 8–12, rest 2 min
4. Chest-supported row: 3 × 8–12, rest 2 min
5. Cable lateral raise: 3 × 12–15 each arm + drop set, rest 90 s
6. Reverse fly: 3 × 12–15 + drop set, rest 90 s
7. Bayesian cable curl: 3 × 10–15 each arm + drop set, rest 90 s; swap: Machine preacher curl
8. Overhead extension: 3 × 10–15 + drop set, rest 90 s; swap: Cable pushdown

### Day 2 · Lower

1. Warm-up: 5 min easy bike, then leg and arm swings, pulse 105–125 bpm
2. Hack squat: top set 6–8, then 3 × 8–12, rest 3 min; swap: Leg press
3. Leg extension: 3 × 10–15 + drop set, rest 90 s
4. Seated leg curl: 3 × 10–12 + drop set, rest 90 s
5. Seated hip adduction: 3 × 12–15 + drop set, rest 90 s
6. Standing calf raise: 4 × 10–15 + drop set, rest 90 s

### Day 3 · Recovery

1. Bike: 20–40 min easy bike, pulse 115–140 bpm
2. Cable crunch: 3 × 10–12, every set to failure + drop set, rest 90 s
3. Knee raise: 3 × 10–20, every set to failure, rest 90 s
4. Stretching: 10 min

### Day 4 · Push

1. Warm-up: 5 min easy bike, then leg and arm swings, pulse 105–125 bpm
2. Incline press: top set 6–8, then 3 × 8–12, rest 3 min; swap: Chest press
3. Shoulder press: 3 × 8–10, rest 2 min
4. Pec deck: 3 × 10–15 + drop set, rest 90 s
5. Cable lateral raise: 4 × 12–15 each arm + drop set, rest 90 s
6. Cable pushdown: 3 × 10–15 + drop set, rest 90 s; swap: Overhead extension

### Day 5 · Pull

1. Warm-up: 5 min easy bike, then leg and arm swings, pulse 105–125 bpm
2. Lat pulldown: top set 6–8, then 3 × 8–12, rest 3 min
3. Chest-supported row: 4 × 8–12, rest 2 min
4. Reverse fly: 3 × 12–15 + drop set, rest 90 s
5. Bayesian cable curl: 3 × 10–15 each arm + drop set, rest 90 s; swap: Machine preacher curl
6. Machine preacher curl: 2 × 10–15 + drop set, rest 90 s; swap: Bayesian cable curl

### Day 6 · Legs

1. Warm-up: 5 min easy bike, then leg and arm swings, pulse 105–125 bpm
2. Seated leg curl: 4 × 10–12 + drop set, rest 90 s
3. Hip thrust: top set 6–8, then 3 × 8–12, rest 3 min
4. Leg press: 3 × 10–12, rest 3 min; swap: Hack squat
5. Seated hip abduction: 3 × 15–20 + drop set, rest 90 s
6. Seated hip adduction: 3 × 12–15 + drop set, rest 90 s
7. Standing calf raise: 4 × 10–15 + drop set, rest 90 s

### Day 7 · Recovery

1. Bike: 20–40 min easy bike, pulse 115–140 bpm
2. Cable crunch: 3 × 10–12, every set to failure + drop set, rest 90 s
3. Knee raise: 3 × 10–20, every set to failure, rest 90 s
4. Stretching: 10 min

Working sets a day: day 1: 23, day 2: 17, day 3: 6, day 4: 17, day 5: 16, day 6: 21, day 7: 6. In a week: 106.

<!-- program:end -->

## Left out on purpose

- Bulgarian split squat, cable lat pullover and machine dip: the research found each one repeats what the program already trains.
- 45° back extension and cable shrug: the research recommends both (the program has no direct lower-back or upper-trap sets),
  but they have no animation yet, so they are not in the program.
- Supersets: the app logs one exercise at a time and cannot pair two.
