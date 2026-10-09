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
  isolation for a muscle the day has not worked yet. Whole kg (or lb).
- **Drop set** right after the last set of an exercise marked "+ drop set": no rest, about 30% lighter, to failure.
- **Each arm** (or **each leg**, for a one-sided leg exercise): the weaker one first, then the other does the same reps; the set
  counts the weaker side's reps.
- **Alternatives** (Options): the exercises named after "swap" have their own animation; one of them takes the step's place for
  the day (same sets, reps and rest; the best one is listed first, with how close it is). **Back** puts the original exercise back.
- **Other machines** (Options): text-only alternatives (no animation yet), listed after the program. The exercise's figure stays and
  so do its sets and rest; the machine's weights are kept apart (the first time it starts from the exercise's last weight: "start lighter").
- **Deload week**, when you choose it (the app suggests it after 6 weeks or when several lifts stall): half the sets, same
  weights, every set 3–4 reps short of failure.
- **No weight** (knee raise, leg raise, 45° back extension): reps first; once every set reaches the top, the knee raise moves on
  to the leg raise ("next"), and the others get harder (slower, then with a weight).

<!-- program:start -->
### Day 1 · Upper

1. Warm-up: 3 min easy bike, then 30 s leg and arm swings, pulse 105–125 bpm
2. Chest press: top set 6–8, then 3 × 8–12, rest 3 min after the top set, then 2 min; swap: Incline press
3. Lat pulldown: 3 × 8–12, rest 2 min; swap: Chest-supported row
4. Chest-supported row: 3 × 8–12, rest 2 min; swap: Lat pulldown
5. Cable lateral raise: 3 × 12–15 each arm + drop set, rest 1 min after both arms; swap: Shoulder press
6. Bayesian cable curl: 2 × 10–15 each arm + drop set, rest 1 min after both arms; swap: Machine preacher curl, Rope hammer curl
7. Overhead extension: 3 × 10–15 + drop set, rest 90 s; swap: Cable pushdown

### Day 2 · Lower

1. Warm-up: 5 min easy bike, then 30 s leg and arm swings, pulse 105–125 bpm
2. Hack squat: top set 6–8, then 3 × 8–12, rest 3 min after the top set, then 2 min; swap: Leg press
3. Leg extension: 3 × 10–15 + drop set, rest 90 s; swap: Hack squat
4. Seated leg curl: 3 × 10–12 + drop set, rest 90 s; swap: 45° back extension
5. 45° back extension: 3 × 10–15, rest 2 min; swap: Hip thrust
6. Seated hip adduction: 3 × 12–15 + drop set, rest 90 s; swap: Leg press
7. Standing calf raise: 4 × 10–15 + drop set, rest 90 s; swap: Seated calf raise

### Day 3 · Recovery

1. Bike intervals: 8 min easy, building up (up to 140), 4 × 4 min hard (160, then 170–179) with 3 min easy (115–130) between, 5 min easy (115–130)
2. Cable crunch: 3 × 10–12, every set to failure + drop set, rest 90 s; swap: Machine crunch
3. Knee raise: 3 × 10–20, every set to failure, rest 90 s; swap: Machine crunch, Cable crunch; next: Leg raise
4. Stretching (optional): 10 min

### Day 4 · Push

1. Warm-up: 3 min easy bike, then 30 s leg and arm swings, pulse 105–125 bpm
2. Incline press: top set 6–8, then 3 × 8–12, rest 3 min after the top set, then 2 min; swap: Chest press
3. Shoulder press: 3 × 8–12, rest 2 min; swap: Incline press
4. Pec deck: 3 × 10–15 + drop set, rest 90 s; swap: Chest press
5. Cable lateral raise: 4 × 12–15 each arm + drop set, rest 1 min after both arms; swap: Shoulder press
6. Cable pushdown: 4 × 10–15 + drop set, rest 90 s; swap: Overhead extension

### Day 5 · Pull

1. Warm-up: 3 min easy bike, then 30 s leg and arm swings, pulse 105–125 bpm
2. Lat pulldown: top set 6–8, then 3 × 8–12, rest 3 min after the top set, then 2 min; swap: Chest-supported row
3. Chest-supported row: 4 × 8–12, rest 2 min; swap: Lat pulldown
4. Reverse fly: 3 × 12–15 + drop set, rest 90 s; swap: Chest-supported row
5. Cable lateral raise: 2 × 12–15 each arm + drop set, rest 1 min after both arms; swap: Shoulder press
6. Bayesian cable curl: 3 × 10–15 each arm + drop set, rest 1 min after both arms; swap: Machine preacher curl, Rope hammer curl
7. Machine preacher curl: 2 × 10–15 + drop set, rest 90 s; swap: Bayesian cable curl, Rope hammer curl

### Day 6 · Legs

1. Warm-up: 5 min easy bike, then 30 s leg and arm swings, pulse 105–125 bpm
2. Seated leg curl: 3 × 10–12 + drop set, rest 90 s; swap: 45° back extension
3. Hip thrust: top set 6–8, then 3 × 8–12, rest 3 min after the top set, then 2 min; swap: 45° back extension
4. Leg press: 3 × 10–12, rest 2 min; swap: Hack squat
5. Seated hip abduction: 3 × 15–20 + drop set, rest 90 s
6. Seated hip adduction: 2 × 12–15 + drop set, rest 90 s; swap: Leg press
7. Standing calf raise: 4 × 10–15 + drop set, rest 90 s; swap: Seated calf raise

### Day 7 · Recovery

1. Bike: 40–45 min easy bike, pulse 120–140 bpm
2. Machine crunch: 3 × 10–12, every set to failure + drop set, rest 90 s; swap: Cable crunch
3. Knee raise: 3 × 10–20, every set to failure, rest 90 s; swap: Machine crunch, Cable crunch; next: Leg raise
4. Stretching (optional): 10 min

Other machines (Options; text only: the figure of the exercise stays, its weights are kept apart):

- 45° back extension: Smith Romanian deadlift, Cable pull-through
- Bayesian cable curl: Cable bar curl
- Standing calf raise: Leg-press calf raise, Smith calf raise on a step
- Chest press: Smith flat press, Assisted dip machine
- Chest-supported row: Seated cable row, Chest-supported T-bar row, Single-arm row
- Hack squat: Pendulum squat, Smith squat, feet forward, Belt or V-squat
- Rope hammer curl: Preacher hammer curl, Cable reverse-grip curl
- Seated hip abduction: Standing cable abduction, Cable or machine kickback
- Seated hip adduction: Standing cable adduction, Smith sumo squat
- Hip thrust: Smith hip thrust, Glute kickback
- Incline press: Machine incline press, Low-to-high cable fly
- Knee raise: Hanging knee raise
- Lat pulldown: Single-arm cable pulldown, Assisted pull-up machine, Machine or cable pullover
- Cable lateral raise: Machine lateral raise, Cable Y-raise, Wide-grip cable upright row
- Seated leg curl: Lying leg curl, Standing single-leg curl, Smith Romanian deadlift
- Leg extension: Cable knee extension, Pendulum squat
- Leg press: Pendulum squat, Smith squat, feet forward
- Leg raise: Hanging knee raise
- Overhead extension: Cross-body cable extension, Smith JM press
- Pec deck: Seated cable fly, Cable crossover
- Machine preacher curl: Cable preacher curl, Cable bar curl
- Cable pushdown: Cable triceps kickback, Smith JM press
- Reverse fly: Reverse cable crossover, Single-arm cable rear fly, Rope face pull
- Seated calf raise: Smith seated calf raise, Leg-press calf raise
- Shoulder press: Smith seated press

Working sets a day: day 1: 18, day 2: 20, day 3: 6, day 4: 18, day 5: 18, day 6: 19, day 7: 6. In a week: 105.

<!-- program:end -->

## Left out on purpose

- Bulgarian split squat, cable lat pullover and machine dip: the research found each one repeats what the program already trains.
- Cable shrug: the research recommends it (the program has no direct upper-trap sets), but it has no animation yet, so it is not
  in the program.
- Supersets: the app logs one exercise at a time and cannot pair two.
