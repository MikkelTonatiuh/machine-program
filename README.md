# Machine Program

A guided workout player for a 7-day, machines-only training program. The screen is the workout: a 3D figure performs
each exercise on its machine with the working muscles lit, and you follow the day from the warm-up to the last set.

The program is custom. It is not one of Jeff Nippard's programs (his published ones run 2 to 6 days a week); his free videos and
the research they cite are where the exercise choices, effort, tempo and rest come from. The exact list, in order, is in
[PROGRAM.md](PROGRAM.md).

Open it, and download it to your phone (the **Download app** button is on its first screen): https://mikkeltonatiuh.github.io/machine-program/

- The app opens on the seven days as squares, under the week you are in ("Week 3 · 2 of 7 days done"). Each square shows its
  exercise moving; the days you finished this week are ticked with the time they took; the one you are in the middle of says
  Resume. Tap a square to open that day (a finished day opens its workout card; "Do this day again" starts it over).
- Every screen has one button at the bottom: Go, Stop, Skip rest, Start, Next. The round button on its left is Undo.
- A set starts with **Go**: a 5 second countdown (big numbers, a beep and a buzz each second), then the figure starts at the
  bottom of its rep and the app counts your reps as you follow it (a rep counts once its lift is done, with a soft tick).
  Press **Stop** when you are done: the reps are logged with the weight shown and the rest starts. The figure, the card's
  "Press fast / Return slow" and the counter run on one clock. Forgot to press Go? The check button on the right logs the set
  with the numbers on the selectors.
- The reps and weight selectors (− and +) set the target and the weight before Go; during the rest they show the set you just
  logged and correct it. The weight moves by 1 kg (or 1 lb: the three dots switch the unit) and starts on what you lifted last
  time; tap it to type one ("52,5" or "52.5").
- **One arm at a time** (cable lateral raise, Bayesian curl): the weaker arm first (the left, then whichever did fewer reps),
  then "Switch sides" with no rest, and the other arm, mirrored on screen, does the same reps: the counter stops it there with
  a buzz. Both sides are logged; the lower one counts. 60 s rest after both arms.
- The first set of an exercise says how to beat last time: "Today: 52 kg (+2): you hit 12 on every set" or "Today: beat 12 · 11
  · 10 at 50 kg"; every later set shows last time's numbers ("Last time 11 × 50 kg"); after the last set, "Next time: …".
- Progression is double progression: when every set reached the top of the rep range, the next time is heavier: +2.5% for a top
  set and a 2-rep range, +4% for an upper-body compound, +5% for the rest, rounded down to a whole kg, at least 1 kg; the reps
  start 2 lower. A weight where 1 kg is more than 8% (a light cable) adds reps first (to 19 at 6 kg in 12–15), then 1 kg. Stuck 3
  times in a row: one more rep on set 1, then the swap, then 10% lighter to climb again.
- Before the first set of a machine compound you get its warm-up sets, worked out from that set's weight (for example
  20 kg × 8 · 30 kg × 4 · 34 kg × 2 before a 40 kg top set: every weight the app works out is a whole kg or lb). Do them, press
  **Warm-up done**; they are not logged. An isolation exercise for a muscle the day has not worked yet gets one light set.
- The first compound of a lifting day starts with a heavy **top set** (6–8 reps, then 3 min rest); the sets after it are
  **back-off sets** (8–12 reps, 2 min rest) that start at about 87.5% of what you lifted on the top set.
- After the last set of a machine or cable isolation comes a **drop set**: "No rest · go now at 35 kg", about 30% lighter, as
  many reps as you can. It is kept apart from the working sets (set the reps to 0 to skip it). The rest after it is the
  exercise's own (2 min when the next exercise works the same muscle).
- Abs: every set to failure. Exercises with no weight go up by reps. Once every set reaches the top, the knee raise makes way
  for the leg raise ("Next time: Leg raise"; Swap brings the knee raise back), and the 45° back extension says "Next time: lower
  slowly over 3 s", then "hold a plate to your chest".
- The text that tells you how to do the rep is a card right above the figure: the phase the figure is in (Press fast,
  Return slow 2–3 s), when to breathe ("In as handles return, out as you press"; on a heavy top set: "Big breath and brace;
  breathe out past the hard part"), the set's rule (how close to failure) and one short cue. It never covers the figure. Turn
  the figure and it steps aside (it comes back by itself). On the bike it gives the phase and the pulse to hold instead.
- Rest runs by itself (the glow along the horizon is the timer) and shows what comes next: the next set and its weight, or the
  next exercise, its sets and weight, and its figure, so you can walk to it. Skip rest ends it early. It ends with a beep and a
  buzz; if you are in another app, with a notification (allow it once; "Test rest alert" in the three dots checks your phone
  lets it through: on a Xiaomi, set Chrome and the app to Battery saver "No restrictions").
- The screen stays on while the app is open.
- The clock at the top right times the workout, from your first action to the last set. The finished day shows its time.
- A finished day shows its **workout card**: the figure with every muscle the day worked lit, the day and date, the time, the
  weight lifted, the sets, each exercise's best set, the top set, what went up since last time and new bests (PB). **Share**
  opens the phone's share sheet (Strava, Instagram, Photos…) with the picture (1080 × 1350) and a short text for the
  description; the button beside it copies both, to paste.
- Made a mistake? Undo takes back the last step, and again for the one before. The three dots at the top right also hold
  Restart workout (it starts the day over, and Undo brings it back) and All workouts.
- A machine is taken? **Options** (top right) holds **Do it later** (the exercise moves to the end of the day) and **Swap**
  (another machine for the same muscles takes its place for today, best first, with the same sets and reps; its sets are
  logged to it). The three dots hold them too. **Other machines** below them lists text-only alternatives (a Smith flat press for the
  chest press, a single-arm cable pulldown for the lat pulldown...): the exercise's figure stays, with its sets, reps and rest, the
  title shows the machine ("Figure: Chest press" under it), and the machine keeps its own weights and history (its first time it
  starts from the exercise's last weight: "New machine: start lighter").
- **Week review**: "Start a new week" (or a workout chosen once all seven days are done) first shows what went up since the week
  before ("Chest press 61 → 62 kg", "Lat pulldown +1 rep"), what is stuck (3 sessions with no progress) and the next step of the
  stall ladder, and a deload when one is due. One button, "Start week 4", starts the week.
- **Deload week** (also in the three dots): half the sets, the same weights, every set 3–4 reps short of failure, for that
  week. The overview suggests one after 6 weeks of training, or when 3 lifts have not gone up in their last 3 workouts.
- Recovery days: Day 3 is a bike interval ride (8 min easy, 4 × 4 min hard with 3 min easy between, 5 min easy; a beep and a
  buzz at each change, the screen shows the phase, its time left and the pulse to reach), Day 7 a 40–45 min easy ride. The
  stretching after the abs is optional.
- The overview has a line on food (about 5–10% above maintenance and 1.6–2.2 g of protein per kg a day), one on steps
  (8,000–10,000 a day, some of it brisk) and one on breathing: with high blood pressure, heart or eye problems, breathe out on
  every rep.
- Drag sideways on the figure to turn it. Tap the day at the top left for the overview.

## Download it to your phone

Press **Download app** on the overview. On Android (Chrome, Edge, Samsung Internet) that installs it; on an iPhone or iPad
it shows the two taps (Share, then **Add to Home Screen**) because Safari lets no page start that itself. The button is not
shown in the installed app, nor once the app is installed. If your browser has no button, its own menu has **Install app**
or **Add to Home screen**.

After the first visit it also works without a connection.

## Your progress stays on your phone

Your sets and weights (drop sets apart), the day you are on, the time each workout took and your reps from last time are saved
in the browser's storage on that phone only. There is no account and nothing is uploaded, so each phone keeps its own progress.
Clearing the site's data in the browser starts it fresh. A finished week stays ticked until you begin the next workout (or
press Start a new week at the bottom of the overview); that is also when the week number goes up.

## Where the numbers come from

The app says little: each line is there because it changes what you do. Where the lines come from, and how sure they are:

- **Warm-up.** Easy cycling at about 55–65% of maximum heart rate: 105–125 bpm at age 28, 3 minutes before upper-body days and 5
  before leg days, then 30 s of leg and arm swings ([Jeff Nippard's warm-up video, 2019](https://www.youtube.com/watch?v=E81GN-3A8XM);
  Tanaka 2001 for the maximum). A general warm-up adds little once ramp sets are done
  ([Iversen 2021](https://doi.org/10.1007/s40279-021-01490-1)).
- **Warm-up sets.** In that video Jeff ramps up in a few sets with fewer reps each, to about 85% before the heavy set, and says
  most later exercises need no full ramp; on a machine "two maybe three quick warm-up sets"
  ([minimalist plan, 2022](https://www.youtube.com/watch?v=eMjyvIQbn9M)). The app's 50% × 8, 75% × 4 and 85% × 2 (75% × 4 alone
  once the muscles are warm, 50% × 10 before an isolation for a muscle not yet worked) are this program's round numbers, not his;
  a warm-up that includes a set near the working weight helped performance in
  [Ribeiro 2020](https://pubmed.ncbi.nlm.nih.gov/32971729/).
- **Top set and back-off sets.** One heavy set at about RPE 9, then lighter back-off sets for more reps
  ([Jeff's minimalist plan, 2022](https://www.youtube.com/watch?v=eMjyvIQbn9M); back-offs well under the top set in
  [his leg day, 2023](https://www.youtube.com/watch?v=H6mRkx1x77k)). The 6–8 reps at RPE 8–9 and the back-offs at about 85–90%
  of the top set are this program's choice for machines. A first top set after straight sets is worked out from your best set
  (Epley's formula), rounded down.
- **Recovery-day cardio.** Day 3: 4 × 4 min hard (start about 160, reach 170–179 bpm, about 90–95% of the maximum 188 at 28) with
  3 min easy between: 4 × 4 intervals raised VO2max where steady riding did not ([Helgerud 2007](https://doi.org/10.1249/mss.0b013e3180304570);
  intervals of 2 min or more work best, [Wen 2019](https://doi.org/10.1016/j.jsams.2019.01.013)); a hard minute is worth more than an easy
  one ([Ahmadi 2022](https://doi.org/10.1093/eurheartj/ehac572), observational). Day 7: 40–45 min easy, 120–140 bpm. Cycling on the
  days away from lifting is the low-interference choice ([Schumann 2022](https://doi.org/10.1007/s40279-021-01587-7);
  [Wilson 2012](https://doi.org/10.1519/JSC.0b013e31823a3e2d)). Steps: risk kept falling up to 8,000–10,000 a day
  ([Paluch 2022](https://doi.org/10.1016/S2468-2667(21)00302-9)). If you cannot speak in full sentences on an easy ride, slow down
  (the talk test: Reed and Pipe 2014). Stretching is optional: training through a full range improves flexibility as much
  ([Afonso 2021](https://doi.org/10.3390/healthcare9040427)).
- **Effort.** Most sets stop 1–2 reps short of failure and the last set goes to failure (Jeff, 2024–25; his only exceptions are
  free-weight squats and deadlifts). Hack squat and leg press stop 0–1 reps short instead, which grows the same
  ([Refalo 2024](https://pubmed.ncbi.nlm.nih.gov/38393985/)). A top set stops 1–2 reps short (RPE 8–9); every ab set and every
  drop set goes to failure. Set the Smith machine's safety stops before a set to failure.
- **Tempo.** Lift in about 1 s, lower in 2–3 s, 2–8 s per rep in all, with the muscle stretched at the bottom
  ([the 2024 review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10801605/) Jeff co-wrote). Tempo matters little (Enes 2025), so
  control the lowering and lift with intent. A timed pause has no evidence behind it, except on the calf raise, where Jeff pauses 1–2 s.
- **Rest.** 3 minutes after a top set, 2 between back-off sets and after other compounds, 90 seconds after isolation work, 60 s
  after both arms of a one-arm exercise (each arm rests while the other works). Past about 90 s there is no clear extra growth
  ([Singer 2024](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full)).
  These, with fewer sets on Day 1 and Day 6, keep a lifting day at about 65–75 minutes.
- **Progression.** Double progression, as above; adding reps grows muscle as well as adding weight
  ([Plotkin 2022](https://doi.org/10.7717/peerj.14142)). The step sizes come from the rep math: each 2.5–4% of load costs about
  one rep (Epley; [Nuzzo 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212/) on how much that varies), so +5% lands about 2
  reps lower; ACSM's 2–10% ([Ratamess 2009](https://doi.org/10.1249/MSS.0b013e3181915670)). A top-set exercise moves up when its
  top set reaches 8 reps; its back-off sets keep their share of it and move up when all of them reach 12. "Stuck" (3 sessions
  with no extra rep or kg) is coaching convention, not a study. Deloads: lifters take one about every 5.6 weeks
  ([Rogerson 2024](https://doi.org/10.1186/s40798-024-00691-y)).
- **One arm at a time.** Weaker side first and the same reps on the other: coaching practice (Jeff starts with the weaker side in
  [his 2021 routine](https://www.youtube.com/watch?v=qVek72z3F1U)); no study tested the order. Tiring one limb costs the other a
  little endurance ([meta-analysis](https://pubmed.ncbi.nlm.nih.gov/33818751/)), so that loss falls on the stronger side.
- **Breathing.** Out on the effort, in on the return; on a heavy set a big breath and a brace, out past the hard part. Holding the
  breath drives blood pressure very high ([MacDougall 1985](https://doi.org/10.1152/jappl.1985.58.3.785)); breathing out slowly
  cut it ([Narloch 1995](https://pubmed.ncbi.nlm.nih.gov/7741618/)); bracing or breathing out did not cost strength, breathing in
  while lifting did ([Blazek 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8329978/)). The AHA's advice on who should not hold
  their breath: [Williams 2007](https://doi.org/10.1161/CIRCULATIONAHA.107.185214).
- **Drop sets.** On the last set only: after failure, no rest, drop the weight by about 30% and go to failure again
  ([Jeff, 2021](https://www.youtube.com/watch?v=qVek72z3F1U); 25–50% in
  [his minimalist video, 2022](https://www.youtube.com/watch?v=xc4OtzAnVMI); studies mostly dropped 20–25%). Drop sets grow about as much as normal sets in less
  time ([Coleman 2022](https://doi.org/10.47206/ijsc.v2i1.135); [Sødal 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10390395/)).
  On exercises that load the stretched muscle, the drop set ends with half reps in the stretch: Jeff's lengthened partials after
  failure ([2023](https://www.youtube.com/watch?v=ftpH4-xFGQI); [Pedrosa 2022](https://doi.org/10.1080/17461391.2021.1927199),
  [Kassiano 2023](https://pubmed.ncbi.nlm.nih.gov/37015016/); about equal to full reps in
  [Wolf 2025](https://doi.org/10.7717/peerj.18904)).
- **Abs.** A weighted crunch (cable on day 3, machine on day 7), 3 × 10–12, and a leg raise, 3 × 10–20, with bent knees (the knee
  raise) until straight legs are possible (the leg raise), then slower, then with ankle weights: progress by reps, then by a harder
  version ([Jeff's "Get Abs In 60 Days", 2024](https://www.youtube.com/watch?v=Tn-XvYG9x7w)). He takes the last set to failure; this
  program takes every ab set to failure, and the crunch's last set ends with a drop set.
- **The exercises added last.** The 45° back extension, which works the glutes, hamstrings and lower back: Jeff ranks it S tier for
  the glutes and adds reps, then a plate held to the chest
  ([2025](https://www.youtube.com/watch?v=3ryh7PNhz3E)); it worked the glutes as hard as a Romanian deadlift and the hamstrings
  71–174% harder ([Andersen 2021](https://doi.org/10.52082/jssm.2021.181)). The seated calf raise on day 6 (day 2 keeps the
  standing one): with the knee bent it trains mostly the soleus, which grew as much as with standing calf raises while the
  gastrocnemius hardly grew ([Kinoshita 2023](https://doi.org/10.3389/fphys.2023.1272106)). The rope hammer curl: the neutral grip
  works the brachialis and the brachioradialis (Jeff ranks hammer curls A tier,
  [2024](https://www.youtube.com/watch?v=GNO4OtYoCYk); [Boland 2008](https://doi.org/10.1016/j.jhsa.2008.07.019)). The machine crunch
  is the cable crunch's loaded spinal curl on a machine.
- **Busy machines.** A swap is another machine for the same muscles (as in [Jeff's 25 exercises, 2026](https://www.youtube.com/watch?v=S6rqpxVGKZ4)),
  best first. The standing calf raise is on Day 6 too: standing raises grew the whole calf more than seated ones
  ([Kinoshita 2023](https://doi.org/10.3389/fphys.2023.1272106)); the seated one is its swap.
  Doing an exercise later in the workout changes how much it grows little ([Nunes 2021](https://doi.org/10.1080/17461391.2020.1733672)).
- **Deload week.** General practice, not a rule of Jeff's programs: about one easier week every 4–8 weeks, with fewer sets and
  more reps in reserve ([Jeff, 2022](https://www.youtube.com/watch?v=LT_aBQatj5s);
  [Bell 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/), an expert consensus that keeps the load). A week off did not
  cost growth in [Coleman 2024](https://doi.org/10.7717/peerj.16777). "Several lifts stall" is 3 exercises whose last 3 workouts
  on the same day never beat the first (more weight, or more reps at it).
- **Food.** A calorie surplus of 5–10% ([Jeff's bulking video, 2024](https://www.youtube.com/watch?v=OqRvmJ2eyBA)) and 1.6–2.2 g
  protein per kg body weight a day ([his protein video, 2022](https://www.youtube.com/watch?v=Pok0Jg2JAkE);
  [Morton 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5867436/)).
- **Cues.** One short line from Jeff's tier-list and technique videos. The cues of the pec deck, hip thrust, hip adduction, leg
  press, leg extension and incline press come from the 2026 science audit: the leg press goes to about 90–100° of knee bend,
  deeper added no quad growth ([Larsen 2025](https://pubmed.ncbi.nlm.nih.gov/40113586/)); a reclined leg extension grew the rectus
  femoris more ([Larsen 2025](https://doi.org/10.1080/02640414.2024.2444713)). The cues of the leg raise, back extension, machine
  crunch and hammer curl come from the technique notes their animations were built from (ExRx and the sources above); the seated
  calf raise takes the standing one's.

Jeff's videos were read from transcripts, mostly on mirror sites rather than YouTube itself, so check anything you plan to rely on
against the source. Nothing here comes from his paid programs.

The animations show the ranges the research supports: the leg press bends the knees to about 95° on a back pad reclined to 15°
([Larsen 2025](https://pubmed.ncbi.nlm.nih.gov/40113586/)), the leg extension leans back to a 50° hip
([Larsen 2025](https://doi.org/10.1080/02640414.2024.2444713)), the cable lateral raise and the Bayesian curl pull from a pulley
at hand height so the stretch is loaded, and the incline press grips about 1.5× shoulder width.

## Credits

A custom program, built on ideas from Jeff Nippard's free videos and published research. The 7-day routine is not his. Not
affiliated.

The 3D engine uses [three.js](https://threejs.org) (MIT license), loaded from cdn.jsdelivr.net, and the Newsreader and
Instrument Sans typefaces come from Google Fonts. Both are loaded from their CDNs on the first visit and then kept on
the phone for offline use.

## Updates

A new version downloads in the background and is used the next time the app is opened.

## For the maintainer

Three small tools keep the files in step (Node 18+; the first needs `playwright` and its Chromium). The program data also
takes: `"off": true` on a step (taken out of the program: it keeps its place so saved progress keeps its step numbers, the day's
`order` leaves it at the end, nothing shows it; add a new step at the end of its day and place it with `order`), `restTop` (the
rest after a top set), `phases` on a timed step (`[{ sec, name, verb, pulse, cue, hard }]`: a beep and a buzz at each change),
`optional` (a timed step that can be skipped), and on an exercise `breath` (its breathing cue), `brace` (its own line for a heavy
top set; the program's is `breath.brace`), `inc` (its step up in percent, instead of the rule above) and `alts` (other machines for the
same movement, text only, best first: `[{ "id": "smith_flat_press", "n": "Smith flat press", "cue": "..." }]`; `id` names the machine's
own record, so keep it once chosen; Options lists them under "Other machines", so adding one is a change to this data only).

- `node tools/covers.mjs` draws the overview's pictures (`covers/`) from the app's own figure engine: an animation and a
  still frame for each day's cover exercise (`cover` in the program inside `index.html`). Run it when an exercise's
  animation or the cover choice changes. `--only 1,3` redraws just those days.
- `node tools/pwa.mjs` writes the service worker's file list and hashes (the first line of `sw.js`). The worker refuses a
  file that does not match, so run it after changing **any** file the app ships, before committing.
  `node tools/pwa.mjs --check` fails when the list is out of date.
- `node tools/program.mjs` writes [PROGRAM.md](PROGRAM.md), the exact list of days, exercises and their order, from the program
  inside `index.html`. Run it after **any** change to the program, so the change shows up as a change to that list.
  `node tools/program.mjs --check` fails when the list is stale, when a step names an exercise that has no entry or animation
  file, when a swap or harder variant names one that is not ready, or when an entry is not used by any step, swap or variant.

Adding an exercise as a swap or as a harder variant is a change to data only: put its animation in `exercises/<id>.json`, add
its entry to `ex` in the program inside `index.html` (`"ready": true`; `compound`, `drop`, `partials` and `failAll` as for the
exercises like it; an exercise with no weight has `"kg0": 0` and its own rep range, `"reps": [10, 15]`), then name it in the
other exercise's entry: `"swap": ["seated_calf_raise"]` on `calf_raise` (and `"swap": ["calf_raise"]` on the new one, to swap
back), or `"next": "leg_raise"` on `knee_raise` (a bodyweight exercise moves on to its `next` once every set reaches the top of
the range; until then `harder` says what to change). Run the two tools.
